"""Portfolio endpoint — proxies Robinhood MCP portfolio data."""
import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from agent.mcp_client import robinhood_mcp
from api.auth import get_robinhood_token
from api.session import require_auth
from models.database import User, get_db

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/portfolio")
async def get_portfolio(
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    token = await get_robinhood_token(db, current_user.id)
    try:
        async with robinhood_mcp(token) as (session, tools):
            tool_names = {t["function"]["name"] for t in tools}

            # get_portfolio requires account_number — fetch it first
            account_number: str | None = None
            accounts_tool = next(
                (n for n in tool_names if "account" in n.lower()),
                None,
            )
            if accounts_tool:
                logger.info("Fetching accounts via %s", accounts_tool)
                acct_result = await session.call_tool(accounts_tool, {})
                acct_raw = "\n".join(c.text for c in acct_result.content if hasattr(c, "text"))
                try:
                    acct_data = json.loads(acct_raw)
                    # Accept list or dict — pull first account_number found
                    items = acct_data if isinstance(acct_data, list) else [acct_data]
                    for item in items:
                        if isinstance(item, dict):
                            account_number = (
                                item.get("account_number")
                                or item.get("accountNumber")
                                or item.get("id")
                            )
                            if account_number:
                                break
                except (json.JSONDecodeError, Exception):
                    pass

            args = {} if account_number is None else {"account_number": account_number}
            result = await session.call_tool("get_portfolio", args)
            raw = "\n".join(c.text for c in result.content if hasattr(c, "text"))
            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                return {"raw": raw}
    except Exception as exc:
        logger.error("Portfolio fetch failed: %s", exc)
        raise HTTPException(502, f"Failed to fetch portfolio: {exc}")
