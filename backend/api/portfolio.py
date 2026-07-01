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
            # Log which tools have required params — helps diagnose account_number issues.
            tool_reqs = {t["function"]["name"]: t["function"].get("parameters", {}).get("required", []) for t in tools}
            no_req_account = [n for n, r in tool_reqs.items() if not r and "account" in n.lower()]
            logger.info("MCP tools with required params: %s", {k: v for k, v in tool_reqs.items() if v})
            logger.info("Account-related tools with no required params: %s", no_req_account)

            # get_portfolio requires account_number — fetch it from get_accounts first
            logger.info("Calling get_accounts — required params: %s", tool_reqs.get("get_accounts", []))
            acct_result = await session.call_tool("get_accounts", {})
            acct_raw = "\n".join(c.text for c in acct_result.content if hasattr(c, "text"))
            logger.info("get_accounts response: %s", acct_raw[:400])
            logger.info("get_accounts raw response: %s", acct_raw[:500])
            account_number: str | None = None
            try:
                acct_data = json.loads(acct_raw)
                # Response shape: {"data": {"accounts": [{"account_number": "...", ...}]}}
                # Also try flat list or single dict as fallback.
                candidates = (
                    acct_data.get("data", {}).get("accounts", [])
                    if isinstance(acct_data, dict) else []
                )
                if not candidates:
                    candidates = acct_data if isinstance(acct_data, list) else [acct_data]
                for item in candidates:
                    if isinstance(item, dict):
                        account_number = item.get("account_number") or item.get("accountNumber")
                        if account_number:
                            break
            except (json.JSONDecodeError, Exception):
                pass

            if not account_number:
                raise HTTPException(502, f"Could not determine account_number from get_accounts: {acct_raw[:300]}")

            result = await session.call_tool("get_portfolio", {"account_number": account_number})
            raw = "\n".join(c.text for c in result.content if hasattr(c, "text"))
            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                return {"raw": raw}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Portfolio fetch failed: %s", exc)
        raise HTTPException(502, f"Failed to fetch portfolio: {exc}")
