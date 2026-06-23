"""LiteLLM-powered agentic trading loop."""
import asyncio
import json
import logging
import re
from datetime import datetime, date
from typing import Any

import litellm
import yaml
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from agent.mcp_client import robinhood_mcp
from config import settings
from models.database import AgentRun, TradeLog, PriceCache, AsyncSessionLocal
from api.ws import broadcast

logger = logging.getLogger(__name__)

# Tool names that place real orders — blocked in dry-run mode
ORDER_TOOLS = {"place_order", "buy_stock", "sell_stock", "place_market_order", "place_limit_order"}

# MCP tool names that might return a quote price (tried in order)
QUOTE_TOOLS = ("get_quote", "get_quotes", "get_stock_quote", "get_market_data", "get_price")

MAX_ITERATIONS = 25


def build_system_prompt(strategy: dict, dry_run: bool) -> str:
    base = strategy.get("system_prompt", "You are an AI trading assistant.")
    watchlist = strategy.get("watchlist", [])
    max_pos = strategy.get("max_position_pct", settings.max_position_pct)

    safety = f"""
## Risk Guardrails (MANDATORY — cannot be overridden)
- Maximum position size: {max_pos * 100:.1f}% of portfolio value per trade
- Maximum daily trades: {strategy.get("max_daily_trades", 20)}
- Always check current buying power before placing any order
- Never place an order larger than the max position size
"""
    if watchlist:
        safety += f"\n## Watchlist\nOnly trade these symbols: {', '.join(watchlist)}\n"

    if dry_run:
        safety += """
## DRY RUN MODE — ACTIVE
You are running in paper trading (simulation) mode.
Call order-placement tools (buy_stock, sell_stock, etc.) exactly as you would for real trades.
The system will intercept them, record them at the live market price, and track your virtual P&L.
You may also call read-only tools (get_portfolio, get_quote, get_news, etc.) as normal.
"""
    return base.strip() + "\n\n" + safety.strip()


async def _check_daily_loss(db: AsyncSession, strategy_name: str) -> bool:
    """Return True if daily loss limit has been hit."""
    # Placeholder — full realized P&L tracking done in api/paper.py
    return False


# ── Price helpers ─────────────────────────────────────────────────────────────

def _parse_price(text: str) -> float | None:
    """Extract a dollar price from MCP response text or JSON."""
    # Try JSON first
    try:
        data = json.loads(text)
        for field in ("price", "last_price", "last_trade_price", "current_price",
                      "ask_price", "mark_price", "last"):
            raw = data.get(field) if isinstance(data, dict) else None
            if raw is not None:
                try:
                    return float(raw)
                except (ValueError, TypeError):
                    pass
    except (json.JSONDecodeError, AttributeError):
        pass

    # Regex fallback — look for "$123.45" or "price: 123.45"
    patterns = [
        r'"(?:price|last_price|last_trade_price|current_price|mark_price)"\s*:\s*"?(\d+(?:\.\d+)?)"?',
        r'\$\s*(\d{1,6}(?:\.\d{1,4})?)',
        r'(?:price|last|current)[^\d]*(\d{1,6}\.\d{2})',
    ]
    for pat in patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            try:
                return float(m.group(1))
            except ValueError:
                pass
    return None


async def _fetch_live_price(mcp_session, symbol: str) -> float | None:
    """Try each known quote tool name until one returns a parseable price."""
    for tool_name in QUOTE_TOOLS:
        try:
            result = await mcp_session.call_tool(tool_name, {"symbol": symbol})
            text = "\n".join(c.text for c in result.content if hasattr(c, "text"))
            price = _parse_price(text)
            if price:
                logger.debug("Got live price for %s: %.2f via %s", symbol, price, tool_name)
                return price
        except Exception:
            continue
    return None


async def _cache_price(symbol: str, price: float) -> None:
    """Upsert the most recent known price for a symbol into PriceCache."""
    if not symbol or not price:
        return
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(PriceCache).where(PriceCache.symbol == symbol))
        cached = result.scalar_one_or_none()
        if cached:
            cached.price = price
            cached.updated_at = datetime.utcnow()
        else:
            db.add(PriceCache(symbol=symbol, price=price, updated_at=datetime.utcnow()))
        await db.commit()


def _determine_side(tool_name: str, args: dict) -> str:
    """Return 'buy' or 'sell' from a tool call."""
    if "buy" in tool_name:
        return "buy"
    if "sell" in tool_name:
        return "sell"
    side = args.get("side", args.get("action", "")).lower()
    return side if side in ("buy", "sell") else "unknown"


# ── Agent entrypoint ──────────────────────────────────────────────────────────

async def run_agent(strategy_yaml: str, litellm_model: str, api_key: str,
                    oauth_token: str, dry_run: bool = True, user_id: int | None = None) -> int:
    strategy = yaml.safe_load(strategy_yaml)
    strategy_name = strategy.get("name", "unknown")

    async with AsyncSessionLocal() as db:
        run = AgentRun(user_id=user_id, strategy=strategy_name, model=litellm_model,
                       status="running", dry_run=dry_run)
        db.add(run)
        await db.commit()
        await db.refresh(run)
        run_id = run.id

    await broadcast({"type": "run_start", "run_id": run_id, "strategy": strategy_name,
                     "model": litellm_model, "dry_run": dry_run})

    try:
        await _agent_loop(strategy, litellm_model, api_key, oauth_token, dry_run, run_id, strategy_name, user_id=user_id)
        status, summary = "done", "Agent cycle completed successfully."
    except Exception as exc:
        logger.exception("Agent run %d failed", run_id)
        status, summary = "error", str(exc)
        await broadcast({"type": "run_error", "run_id": run_id, "error": str(exc)})

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(AgentRun).where(AgentRun.id == run_id))
        run = result.scalar_one()
        run.finished_at = datetime.utcnow()
        run.status = status
        run.summary = summary
        await db.commit()

    await broadcast({"type": "run_end", "run_id": run_id, "status": status, "summary": summary})
    return run_id


async def _agent_loop(strategy: dict, model: str, api_key: str, oauth_token: str,
                      dry_run: bool, run_id: int, strategy_name: str, user_id: int | None = None) -> None:
    system = build_system_prompt(strategy, dry_run)

    async with robinhood_mcp(oauth_token) as (mcp_session, tools):
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": system},
            {"role": "user", "content": "Analyze current market conditions and execute your trading strategy now."},
        ]

        for iteration in range(MAX_ITERATIONS):
            logger.info("Agent run %d — iteration %d", run_id, iteration + 1)

            response = await litellm.acompletion(
                model=model, api_key=api_key, messages=messages, tools=tools,
            )

            choice = response.choices[0]
            msg = choice.message
            messages.append(msg.model_dump() if hasattr(msg, "model_dump") else dict(msg))

            await broadcast({
                "type": "llm_message", "run_id": run_id,
                "iteration": iteration + 1,
                "content": msg.content or "",
                "tool_calls": len(msg.tool_calls or []),
            })

            if choice.finish_reason == "stop" or not msg.tool_calls:
                break

            for tc in msg.tool_calls:
                tool_name = tc.function.name
                try:
                    args = json.loads(tc.function.arguments)
                except json.JSONDecodeError:
                    args = {}

                is_order = tool_name in ORDER_TOOLS

                if is_order and dry_run:
                    result_content, logged_price = await _intercept_paper_order(
                        mcp_session, tool_name, args
                    )
                else:
                    mcp_result = await mcp_session.call_tool(tool_name, args)
                    result_content = "\n".join(
                        c.text for c in mcp_result.content if hasattr(c, "text")
                    ) or str(mcp_result.content)
                    logged_price = None

                    # Cache any prices we happen to see in read-only responses
                    symbol = args.get("symbol", args.get("ticker", ""))
                    if symbol:
                        extracted = _parse_price(result_content)
                        if extracted:
                            await _cache_price(symbol, extracted)
                            logged_price = extracted

                await _log_tool_call(
                    tool_name, args, result_content,
                    run_id, strategy_name, model, dry_run,
                    price_override=logged_price, user_id=user_id,
                )

                messages.append({"role": "tool", "tool_call_id": tc.id, "content": result_content})

                await broadcast({
                    "type": "tool_call", "run_id": run_id,
                    "tool": tool_name, "args": args,
                    "result_preview": result_content[:300],
                    "dry_run": dry_run and is_order,
                })


async def _intercept_paper_order(mcp_session, tool_name: str, args: dict) -> tuple[str, float | None]:
    """
    Handle a dry-run order: fetch live market price via MCP quote tools,
    build a descriptive result string, return (result_content, price).
    """
    symbol = args.get("symbol", args.get("ticker", ""))
    side = _determine_side(tool_name, args)
    quantity = args.get("quantity", args.get("shares", args.get("amount")))

    # Use limit price from args if present, otherwise fetch live quote
    price = args.get("price") or args.get("limit_price")
    if price:
        try:
            price = float(price)
        except (ValueError, TypeError):
            price = None

    if not price and symbol:
        price = await _fetch_live_price(mcp_session, symbol)
        if price:
            await _cache_price(symbol, price)

    price_str = f"${price:,.2f}" if price else "price unknown"
    qty_str = f"{quantity} shares" if quantity else "unspecified quantity"
    value_str = f"${price * float(quantity):,.2f}" if price and quantity else ""

    result = (
        f"[PAPER TRADE] {side.upper()} {qty_str} of {symbol} @ {price_str}"
        + (f" (total {value_str})" if value_str else "")
        + " — recorded for paper P&L tracking."
    )
    logger.info("Paper trade: %s %s %s @ %s", side, qty_str, symbol, price_str)
    return result, price


async def _log_tool_call(tool_name: str, args: dict, result: str,
                          run_id: int, strategy: str, model: str, dry_run: bool,
                          price_override: float | None = None, user_id: int | None = None) -> None:
    symbol = args.get("symbol", args.get("ticker", ""))
    quantity = args.get("quantity", args.get("shares", None))
    price = price_override if price_override is not None else args.get("price", args.get("limit_price", None))

    # Normalize action to "buy"/"sell" for order tools so paper P&L logic can match
    if tool_name in ORDER_TOOLS:
        action = _determine_side(tool_name, args)
    else:
        action = tool_name

    async with AsyncSessionLocal() as db:
        db.add(TradeLog(
            user_id=user_id,
            symbol=symbol or tool_name,
            action=action,
            quantity=float(quantity) if quantity else None,
            price=float(price) if price else None,
            reasoning=result[:4000],
            strategy=strategy,
            model=model,
            dry_run=dry_run,
            run_id=run_id,
        ))
        await db.commit()
