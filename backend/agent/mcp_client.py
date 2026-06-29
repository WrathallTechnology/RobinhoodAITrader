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


@asynccontextmanager
async def robinhood_mcp(oauth_token: str) -> AsyncIterator[tuple[ClientSession, list[dict]]]:
    """
    Async context manager for the Robinhood MCP server.

    Yields (session, tools) where tools is a list of OpenAI-format tool dicts.

    The mcp library runs a background SSE GET stream inside an asyncio.TaskGroup.
    Robinhood frequently drops and re-establishes that stream, and returns 400 on
    session DELETE. When those background-task errors coincide with the context
    exiting they get wrapped in an ExceptionGroup that would otherwise mask a
    successful tool call result. We track whether user code raised and suppress
    ExceptionGroups that come purely from background/cleanup tasks.
    """
    http_client = httpx.AsyncClient(
        headers={"Authorization": f"Bearer {oauth_token}"},
        timeout=30,
    )
    user_code_raised = False
    try:
        async with streamable_http_client(url=ROBINHOOD_MCP_URL, http_client=http_client) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                tools_result = await session.list_tools()
                tools = [_mcp_tool_to_openai(t) for t in tools_result.tools]
                logger.info("Connected to Robinhood MCP — %d tools available", len(tools))
                try:
                    yield session, tools
                except BaseException:
                    # Record that the exception came from our caller, not from cleanup.
                    user_code_raised = True
                    raise
    except BaseException as exc:
        sub = getattr(exc, "exceptions", None)  # ExceptionGroup has .exceptions
        if sub is not None:
            if user_code_raised:
                # Both user code and background tasks raised — let it propagate.
                logger.error("Robinhood MCP failed: %s", exc)
                raise
            else:
                # Only background/cleanup tasks raised (e.g. 400 on session DELETE,
                # dropped SSE stream). User code succeeded; suppress the noise.
                logger.debug("Suppressed MCP background ExceptionGroup on exit: %s", exc)
        else:
            logger.error("Robinhood MCP connection failed: %s", exc)
            raise
    finally:
        await http_client.aclose()
