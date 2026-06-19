from contextlib import asynccontextmanager
import logging
from pathlib import Path

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from config import settings
from models.database import init_db
from agent.scheduler import scheduler, seed_builtin_strategies
from api.auth import router as auth_router
from api.portfolio import router as portfolio_router
from api.trades import router as trades_router
from api.strategies import router as strategies_router
from api.agent import router as agent_router
from api.llm import router as llm_router
from api.ws import router as ws_router
from api.session import router as session_router, require_auth
from api.users import router as users_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await seed_builtin_strategies()
    scheduler.start()
    logger.info("Scheduler started")
    yield
    scheduler.shutdown(wait=False)
    logger.info("Scheduler stopped")


app = FastAPI(
    title="RobinHood AI Trader",
    description="Autonomous AI trading bot powered by Robinhood MCP + LiteLLM",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS: allow only the configured callback base URL (same origin in production).
# In dev, Vite runs on a different port so we add it explicitly.
_allowed_origins = [settings.callback_base_url.rstrip("/")]
if "localhost" in settings.callback_base_url:
    _allowed_origins.append("http://localhost:5173")  # Vite dev server

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,   # required for cookies
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Public routes (no auth required) ─────────────────────────────────────────

# Session: login / logout / me
app.include_router(session_router, prefix="/auth", tags=["session"])

# Robinhood OAuth flow (callback must be reachable without a session)
app.include_router(auth_router, prefix="/auth", tags=["auth"])


# ── Protected routes (require valid session cookie) ───────────────────────────

_auth = [Depends(require_auth)]

app.include_router(portfolio_router, prefix="/api", tags=["portfolio"], dependencies=_auth)
app.include_router(trades_router,    prefix="/api", tags=["trades"],    dependencies=_auth)
app.include_router(strategies_router,prefix="/api", tags=["strategies"],dependencies=_auth)
app.include_router(agent_router,     prefix="/api", tags=["agent"],     dependencies=_auth)
app.include_router(llm_router,       prefix="/api", tags=["llm"],       dependencies=_auth)
app.include_router(users_router,     prefix="/api/users", tags=["users"], dependencies=_auth)

# WebSocket auth handled inside the handler via query-param token
app.include_router(ws_router, tags=["websocket"])


@app.get("/health")
async def health():
    return {"status": "ok"}


# ── Serve pre-built React frontend (no Docker / no separate server needed) ────

_static = Path(__file__).parent / "static"
if _static.exists():
    app.mount("/assets", StaticFiles(directory=_static / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        return FileResponse(_static / "index.html")
