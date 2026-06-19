"""Paper trading portfolio — computed from dry-run trade history."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import TradeLog, PaperSettings, PriceCache, get_db
from api.session import require_auth

router = APIRouter()

BUY_ACTIONS = {"buy", "buy_stock"}
SELL_ACTIONS = {"sell", "sell_stock"}


async def _get_or_create_settings(db: AsyncSession) -> PaperSettings:
    result = await db.execute(select(PaperSettings).limit(1))
    s = result.scalar_one_or_none()
    if not s:
        s = PaperSettings(initial_balance=10_000.0, reset_at=datetime.utcnow())
        db.add(s)
        await db.commit()
        await db.refresh(s)
    return s


@router.get("/summary")
async def paper_summary(db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    s = await _get_or_create_settings(db)

    # All dry-run order trades since the last reset, oldest first
    result = await db.execute(
        select(TradeLog)
        .where(
            TradeLog.dry_run == True,
            TradeLog.action.in_(BUY_ACTIONS | SELL_ACTIONS),
            TradeLog.quantity.isnot(None),
            TradeLog.price.isnot(None),
            TradeLog.timestamp >= s.reset_at,
        )
        .order_by(TradeLog.timestamp)
    )
    trades = result.scalars().all()

    # Replay trades to build virtual portfolio
    cash = s.initial_balance
    positions: dict[str, dict] = {}  # symbol → {qty, avg_cost, total_cost}
    realized_pnl = 0.0

    for t in trades:
        qty = float(t.quantity)
        price = float(t.price)
        cost = qty * price

        if t.action in BUY_ACTIONS:
            cash -= cost
            if t.symbol in positions:
                pos = positions[t.symbol]
                new_qty = pos["qty"] + qty
                new_cost = pos["total_cost"] + cost
                positions[t.symbol] = {"qty": new_qty, "avg_cost": new_cost / new_qty, "total_cost": new_cost}
            else:
                positions[t.symbol] = {"qty": qty, "avg_cost": price, "total_cost": cost}

        elif t.action in SELL_ACTIONS and t.symbol in positions:
            pos = positions[t.symbol]
            realized_pnl += (price - pos["avg_cost"]) * qty
            cash += cost
            remaining = pos["qty"] - qty
            if remaining <= 0.0001:
                del positions[t.symbol]
            else:
                positions[t.symbol] = {
                    "qty": remaining,
                    "avg_cost": pos["avg_cost"],
                    "total_cost": remaining * pos["avg_cost"],
                }

    # Enrich open positions with latest cached price
    price_cache_result = await db.execute(select(PriceCache))
    price_cache = {r.symbol: r.price for r in price_cache_result.scalars().all()}

    position_rows = []
    unrealized_pnl = 0.0
    positions_value = 0.0

    for symbol, pos in positions.items():
        last_price = price_cache.get(symbol, pos["avg_cost"])
        market_value = pos["qty"] * last_price
        unreal = (last_price - pos["avg_cost"]) * pos["qty"]
        unrealized_pnl += unreal
        positions_value += market_value
        position_rows.append({
            "symbol": symbol,
            "quantity": pos["qty"],
            "avg_cost": pos["avg_cost"],
            "last_price": last_price,
            "market_value": market_value,
            "unrealized_pnl": unreal,
            "unrealized_pnl_pct": (last_price / pos["avg_cost"] - 1) * 100 if pos["avg_cost"] else 0,
        })

    total_value = cash + positions_value
    total_pnl = total_value - s.initial_balance
    total_pnl_pct = (total_pnl / s.initial_balance) * 100 if s.initial_balance else 0

    return {
        "initial_balance": s.initial_balance,
        "cash": cash,
        "positions_value": positions_value,
        "total_value": total_value,
        "realized_pnl": realized_pnl,
        "unrealized_pnl": unrealized_pnl,
        "total_pnl": total_pnl,
        "total_pnl_pct": total_pnl_pct,
        "trade_count": len(trades),
        "positions": sorted(position_rows, key=lambda p: abs(p["market_value"]), reverse=True),
        "reset_at": s.reset_at.isoformat(),
    }


class SettingsUpdate(BaseModel):
    initial_balance: float


@router.put("/settings")
async def update_settings(body: SettingsUpdate, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    if body.initial_balance <= 0:
        raise HTTPException(422, "initial_balance must be positive")
    s = await _get_or_create_settings(db)
    s.initial_balance = body.initial_balance
    await db.commit()
    return {"initial_balance": s.initial_balance}


@router.post("/reset")
async def reset_portfolio(db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    """Start fresh — moves the reset_at timestamp to now without deleting history."""
    s = await _get_or_create_settings(db)
    s.reset_at = datetime.utcnow()
    await db.commit()
    return {"reset_at": s.reset_at.isoformat(), "message": "Paper portfolio reset. History preserved."}
