"""Robinhood MCP connection helper.

Connects to https://agent.robinhood.com/mcp/trading using the MCP Python
client and yields the session + tools in OpenAI-compatible format so LiteLLM
can route them to any provider.
"""
import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

logger = logging.getLogger(__name__)

ROBINHOOD_MCP_URL = "https://agent.robinhood.com/mcp/trading"


def _mcp_tool_to_openai(tool) -> dict:
    """Convert an MCP Tool object to the OpenAI function-calling schema."""
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
    Async context manager that opens a connection to the Robinhood MCP server.

    Yields:
        (session, tools) where tools is a list of OpenAI-format tool dicts.

    Usage::

        async with robinhood_mcp(token) as (session, tools):
            result = await session.call_tool("get_portfolio", {})
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
    except Exception as exc:
        logger.error("Robinhood MCP connection failed: %s", exc)
        raise
