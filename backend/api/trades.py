"""Trade history endpoints."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import TradeLog, AgentRun, get_db

router = APIRouter()


@router.get("/trades")
async def list_trades(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    strategy: str | None = None,
    dry_run: bool | None = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(TradeLog).order_by(desc(TradeLog.timestamp))
    if strategy:
        query = query.where(TradeLog.strategy == strategy)
    if dry_run is not None:
        query = query.where(TradeLog.dry_run == dry_run)

    total_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = total_result.scalar_one()

    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    rows = result.scalars().all()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [
            {
                "id": r.id,
                "timestamp": r.timestamp.isoformat(),
                "symbol": r.symbol,
                "action": r.action,
                "quantity": r.quantity,
                "price": r.price,
                "reasoning": r.reasoning,
                "strategy": r.strategy,
                "model": r.model,
                "dry_run": r.dry_run,
                "run_id": r.run_id,
            }
            for r in rows
        ],
    }


@router.get("/trades/{trade_id}")
async def get_trade(trade_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(TradeLog).where(TradeLog.id == trade_id))
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "Trade not found")
    return {
        "id": row.id,
        "timestamp": row.timestamp.isoformat(),
        "symbol": row.symbol,
        "action": row.action,
        "quantity": row.quantity,
        "price": row.price,
        "reasoning": row.reasoning,
        "strategy": row.strategy,
        "model": row.model,
        "dry_run": row.dry_run,
        "run_id": row.run_id,
    }


@router.get("/runs")
async def list_runs(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    query = select(AgentRun).order_by(desc(AgentRun.started_at))
    total_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = total_result.scalar_one()

    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    rows = result.scalars().all()

    return {
        "total": total,
        "items": [
            {
                "id": r.id,
                "started_at": r.started_at.isoformat(),
                "finished_at": r.finished_at.isoformat() if r.finished_at else None,
                "strategy": r.strategy,
                "model": r.model,
                "status": r.status,
                "summary": r.summary,
                "dry_run": r.dry_run,
            }
            for r in rows
        ],
    }
