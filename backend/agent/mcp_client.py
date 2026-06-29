"""Robinhood MCP connection helper."""
import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

logger = logging.getLogger(__name__)

ROBINHOOD_MCP_URL = "https://agent.robinhood.com/mcp/trading"


def _mcp_tool_to_openai(tool) -> dict:
    schema = tool.inputSchema if tool.inputSchema else {"type": "object", "properties": {}}
    return {
        "type": "function",
        "function": {
            "name": tool.name,
            "description": (tool.description or "").strip(),
            "parameters": schema,
        },
    }


def _is_cleanup_noise(exc: BaseException) -> bool:
    """Return True for expected MCP teardown errors that aren't real failures."""
    msg = str(exc).lower()
    return (
        "session termination" in msg
        or "terminate" in msg
        or (isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code in (400, 404))
    )


@asynccontextmanager
async def robinhood_mcp(oauth_token: str) -> AsyncIterator[tuple[ClientSession, list[dict]]]:
    """
    Async context manager for the Robinhood MCP server.

    Yields (session, tools) where tools is a list of OpenAI-format tool dicts.
    Suppresses session-termination cleanup errors (400/404 on DELETE) that the
    mcp library wraps in an asyncio TaskGroup ExceptionGroup.
    """
    http_client = httpx.AsyncClient(
        headers={"Authorization": f"Bearer {oauth_token}"},
        timeout=30,
    )
    try:
        async with streamable_http_client(url=ROBINHOOD_MCP_URL, http_client=http_client) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                tools_result = await session.list_tools()
                tools = [_mcp_tool_to_openai(t) for t in tools_result.tools]
                logger.info("Connected to Robinhood MCP — %d tools available", len(tools))
                yield session, tools
    except BaseException as exc:
        # asyncio.TaskGroup wraps sub-exceptions in an ExceptionGroup.
        # The mcp library uses TaskGroup internally, so a 400 on session DELETE
        # becomes ExceptionGroup("unhandled errors in a TaskGroup", [...]).
        # Unwrap it: if every sub-exception is cleanup noise, suppress the whole
        # thing; otherwise re-raise only the real errors.
        sub = getattr(exc, "exceptions", None)
        if sub is not None:
            real = [e for e in sub if not _is_cleanup_noise(e)]
            if real:
                # Raise the first real error (not the ExceptionGroup wrapper)
                logger.error("Robinhood MCP failed: %s", real[0])
                raise real[0] from exc
            else:
                logger.debug("Suppressed MCP teardown ExceptionGroup: %s", exc)
        else:
            logger.error("Robinhood MCP connection failed: %s", exc)
            raise
    finally:
        await http_client.aclose()
