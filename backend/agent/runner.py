"""LiteLLM-powered agentic trading loop."""
import asyncio
import json
import logging
from datetime import datetime, date
from typing import Any

import litellm
import yaml
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from agent.mcp_client import robinhood_mcp
from config import settings
from models.database import AgentRun, TradeLog, AsyncSessionLocal
from api.ws import broadcast

logger = logging.getLogger(__name__)

# Tool names that place real orders — blocked in dry-run mode
ORDER_TOOLS = {"place_order", "buy_stock", "sell_stock", "place_market_order", "place_limit_order"}

MAX_ITERATIONS = 25  # safety cap on agentic loop


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
You are running in dry-run (simulation) mode.
DO NOT call any order-placement tools (buy, sell, place_order, etc.).
Instead, describe each trade you WOULD make and explain your reasoning.
You may still call read-only tools (get_portfolio, get_quote, get_news, etc.).
"""
    return base.strip() + "\n\n" + safety.strip()


async def _check_daily_loss(db: AsyncSession, strategy_name: str) -> bool:
    """Return True if daily loss limit has been hit."""
    today = date.today()
    result = await db.execute(
        select(func.sum(TradeLog.price * TradeLog.quantity)).where(
            func.date(TradeLog.timestamp) == today,
            TradeLog.strategy == strategy_name,
            TradeLog.action == "sell",
            TradeLog.dry_run == False,
        )
    )
    # Simplified — a real impl would compute realized P&L per position
    return False  # placeholder; full P&L tracking is a future enhancement


async def run_agent(strategy_yaml: str, litellm_model: str, api_key: str,
                    oauth_token: str, dry_run: bool = True) -> int:
    """
    Run one agent cycle. Returns the AgentRun.id.

    Args:
        strategy_yaml: raw YAML string of the strategy config
        litellm_model: e.g. "anthropic/claude-opus-4-8" or "openai/gpt-4o"
        api_key: provider API key
        oauth_token: Robinhood OAuth Bearer token
        dry_run: if True, order tools are blocked
    """
    strategy = yaml.safe_load(strategy_yaml)
    strategy_name = strategy.get("name", "unknown")

    async with AsyncSessionLocal() as db:
        run = AgentRun(
            strategy=strategy_name,
            model=litellm_model,
            status="running",
            dry_run=dry_run,
        )
        db.add(run)
        await db.commit()
        await db.refresh(run)
        run_id = run.id

    await broadcast({"type": "run_start", "run_id": run_id, "strategy": strategy_name,
                     "model": litellm_model, "dry_run": dry_run})

    try:
        await _agent_loop(strategy, litellm_model, api_key, oauth_token, dry_run, run_id, strategy_name)
        status = "done"
        summary = "Agent cycle completed successfully."
    except Exception as exc:
        logger.exception("Agent run %d failed", run_id)
        status = "error"
        summary = str(exc)
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
                      dry_run: bool, run_id: int, strategy_name: str) -> None:
    system = build_system_prompt(strategy, dry_run)

    async with robinhood_mcp(oauth_token) as (mcp_session, tools):
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": system},
            {"role": "user", "content": "Analyze current market conditions and execute your trading strategy now."},
        ]

        for iteration in range(MAX_ITERATIONS):
            logger.info("Agent run %d — iteration %d", run_id, iteration + 1)

            response = await litellm.acompletion(
                model=model,
                api_key=api_key,
                messages=messages,
                tools=tools,
            )

            choice = response.choices[0]
            msg = choice.message
            messages.append(msg.model_dump() if hasattr(msg, "model_dump") else dict(msg))

            await broadcast({
                "type": "llm_message",
                "run_id": run_id,
                "iteration": iteration + 1,
                "content": msg.content or "",
                "tool_calls": len(msg.tool_calls or []),
            })

            if choice.finish_reason == "stop" or not msg.tool_calls:
                logger.info("Agent run %d — finished after %d iterations", run_id, iteration + 1)
                break

            for tc in msg.tool_calls:
                tool_name = tc.function.name
                try:
                    args = json.loads(tc.function.arguments)
                except json.JSONDecodeError:
                    args = {}

                # Block order tools in dry-run mode
                if dry_run and tool_name in ORDER_TOOLS:
                    result_content = (
                        f"[DRY RUN] Would have called {tool_name} with args {args}. "
                        "Order not placed — dry-run mode is active."
                    )
                    logger.info("Dry-run blocked: %s(%s)", tool_name, args)
                else:
                    mcp_result = await mcp_session.call_tool(tool_name, args)
                    result_content = "\n".join(
                        c.text for c in mcp_result.content if hasattr(c, "text")
                    ) or str(mcp_result.content)

                await _log_tool_call(tool_name, args, result_content, run_id, strategy_name, model, dry_run)

                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": result_content,
                })

                await broadcast({
                    "type": "tool_call",
                    "run_id": run_id,
                    "tool": tool_name,
                    "args": args,
                    "result_preview": result_content[:300],
                    "dry_run": dry_run,
                })


async def _log_tool_call(tool_name: str, args: dict, result: str,
                          run_id: int, strategy: str, model: str, dry_run: bool) -> None:
    action = tool_name
    symbol = args.get("symbol", args.get("ticker", ""))
    quantity = args.get("quantity", args.get("shares", None))
    price = args.get("price", None)

    async with AsyncSessionLocal() as db:
        db.add(TradeLog(
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
