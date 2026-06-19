"""Portfolio endpoint — proxies Robinhood MCP portfolio data."""
import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from agent.mcp_client import robinhood_mcp
from api.auth import get_robinhood_token
from models.database import get_db

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/portfolio")
async def get_portfolio(db: AsyncSession = Depends(get_db)):
    token = await get_robinhood_token(db)
    try:
        async with robinhood_mcp(token) as (session, _tools):
            result = await session.call_tool("get_portfolio", {})
            raw = "\n".join(c.text for c in result.content if hasattr(c, "text"))
            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                return {"raw": raw}
    except Exception as exc:
        logger.error("Portfolio fetch failed: %s", exc)
        raise HTTPException(502, f"Failed to fetch portfolio: {exc}")
