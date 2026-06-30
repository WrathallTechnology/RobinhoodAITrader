"""Robinhood MCP connection helper."""
import asyncio
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


def _http_client(oauth_token: str) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        headers={"Authorization": f"Bearer {oauth_token}"},
        # No read timeout: the GET SSE stream is long-lived; individual calls
        # are gated by the 30s connect/write timeouts.
        timeout=httpx.Timeout(connect=10.0, read=None, write=30.0, pool=None),
    )


@asynccontextmanager
async def robinhood_mcp(oauth_token: str) -> AsyncIterator[tuple[ClientSession, list[dict]]]:
    """
    Async context manager for the Robinhood MCP server.

    Yields (session, tools) where tools is a list of OpenAI-format tool dicts.

    The Robinhood MCP server immediately drops the SSE GET stream and the
    client reconnects after ~1000ms. During that window tool calls sent via
    POST can't receive their response (the server sends it over the stream
    that's reconnecting). We wait for the reconnect before yielding, so
    callers always have a stable session.
    """
    client = _http_client(oauth_token)
    user_code_raised = False
    try:
        async with streamable_http_client(
            url=ROBINHOOD_MCP_URL,
            http_client=client,
            terminate_on_close=False,  # Robinhood returns 400 on DELETE; skip it
        ) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                tools_result = await session.list_tools()
                tools = [_mcp_tool_to_openai(t) for t in tools_result.tools]
                logger.info("Connected to Robinhood MCP — %d tools available", len(tools))

                # The Robinhood MCP server drops the SSE GET stream ~100ms after
                # connection and the mcp library reconnects after a 1000ms back-off.
                # Tool call responses are delivered via that stream, so any call
                # made during the reconnect window fails immediately.  Wait for the
                # reconnect before handing the session to the caller.
                await asyncio.sleep(1.2)

                try:
                    yield session, tools
                except BaseException:
                    user_code_raised = True
                    raise
    except BaseException as exc:
        sub = getattr(exc, "exceptions", None)  # ExceptionGroup has .exceptions
        if sub is not None:
            # Log every sub-exception so we can see the real cause.
            for i, e in enumerate(sub):
                logger.error("MCP sub-exception[%d]: %s: %s", i, type(e).__name__, e)
            if user_code_raised:
                # Raise the first meaningful error, not the ExceptionGroup wrapper.
                raise sub[0] from exc
            else:
                # Only background/cleanup tasks raised; user code succeeded.
                logger.debug("Suppressed MCP background ExceptionGroup: %s", exc)
        else:
            logger.error("Robinhood MCP connection failed: %s: %s", type(exc).__name__, exc)
            raise
    finally:
        await client.aclose()
