"""WebSocket endpoint for live agent event streaming."""
import json
import logging
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

logger = logging.getLogger(__name__)
router = APIRouter()

_connections: set[WebSocket] = set()


async def broadcast(payload: dict[str, Any]) -> None:
    """Send a JSON message to all connected WebSocket clients."""
    if not _connections:
        return
    text = json.dumps(payload)
    dead: set[WebSocket] = set()
    for ws in _connections:
        try:
            await ws.send_text(text)
        except Exception:
            dead.add(ws)
    _connections.difference_update(dead)


@router.websocket("/ws/live")
async def ws_live(websocket: WebSocket, token: str | None = Query(None)):
    from api.session import validate_ws_token
    if not await validate_ws_token(token):
        await websocket.close(code=4401, reason="Unauthorized")
        return

    await websocket.accept()
    _connections.add(websocket)
    logger.info("WebSocket client connected — total: %d", len(_connections))
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        _connections.discard(websocket)
        logger.info("WebSocket client disconnected — total: %d", len(_connections))
