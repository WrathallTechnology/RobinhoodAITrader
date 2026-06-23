"""Multi-user session authentication.

First-run: call GET /auth/setup-required → POST /auth/setup to create the first admin.
Subsequent logins: POST /auth/login with {username, password}.
All protected routes use the require_auth dependency which returns the current User.
"""
import hashlib
import hmac
import logging
import secrets
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import select, delete, func
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

from config import settings
from models.database import User, UserSession, AsyncSessionLocal, get_db

router = APIRouter()

SESSION_DAYS = 7
COOKIE_NAME = "session_token"


# ── Password hashing (PBKDF2-SHA256, per-user random salt) ───────────────────

def _make_hash(password: str) -> str:
    salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac(
        "sha256", password.encode(), (salt + settings.secret_key).encode(), 260_000
    ).hex()
    return f"{salt}:{h}"


def _verify_hash(password: str, stored: str) -> bool:
    try:
        salt, expected = stored.split(":", 1)
    except ValueError:
        return False
    actual = hashlib.pbkdf2_hmac(
        "sha256", password.encode(), (salt + settings.secret_key).encode(), 260_000
    ).hex()
    return hmac.compare_digest(expected, actual)


# ── Public: first-run setup ───────────────────────────────────────────────────

def _registration_flag() -> Path:
    return settings.data_dir / "registration_open"


@router.get("/can-register")
async def can_register():
    """Returns {open: true} when an admin has enabled registration (or REGISTRATION_OPEN=true in .env)."""
    return {"open": _registration_flag().exists() or settings.registration_open}


class RegisterRequest(BaseModel):
    username: str
    password: str


@router.post("/register")
async def register(body: RegisterRequest, response: Response, db: AsyncSession = Depends(get_db)):
    """Self-registration. Only works when REGISTRATION_OPEN=true."""
    if not settings.registration_open:
        raise HTTPException(403, "Registration is not open. Ask an admin to create your account.")
    if len(body.username) < 2:
        raise HTTPException(422, "Username must be at least 2 characters")
    if len(body.password) < 8:
        raise HTTPException(422, "Password must be at least 8 characters")
    existing = await db.execute(
        select(User).where(func.lower(User.username) == body.username.lower())
    )
    if existing.scalar_one_or_none():
        raise HTTPException(409, f"Username '{body.username}' is already taken")
    user = User(username=body.username, password_hash=_make_hash(body.password), is_admin=False)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    logger.info("New user registered: %s", user.username)
    return await _create_session(user, response, db)


@router.get("/setup-required")
async def setup_required(db: AsyncSession = Depends(get_db)):
    """Returns {required: true} when no users exist yet."""
    count = await db.scalar(select(func.count()).select_from(User))
    return {"required": count == 0}


class SetupRequest(BaseModel):
    username: str
    password: str


@router.post("/setup")
async def setup(body: SetupRequest, response: Response, db: AsyncSession = Depends(get_db)):
    """Create the first admin user. Fails if any user already exists."""
    count = await db.scalar(select(func.count()).select_from(User))
    if count > 0:
        raise HTTPException(409, "Setup already complete — use Settings to manage users")
    if len(body.username) < 2:
        raise HTTPException(422, "Username must be at least 2 characters")
    if len(body.password) < 8:
        raise HTTPException(422, "Password must be at least 8 characters")
    user = User(username=body.username, password_hash=_make_hash(body.password), is_admin=True)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return await _create_session(user, response, db)


# ── Public: login / logout / me ───────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str


@router.post("/login")
async def login(body: LoginRequest, response: Response, db: AsyncSession = Depends(get_db)):
    # Case-insensitive username lookup so "Friend" and "friend" both work
    result = await db.execute(
        select(User).where(func.lower(User.username) == body.username.lower())
    )
    user = result.scalar_one_or_none()
    if user is None:
        logger.warning("Login failed: username '%s' not found", body.username)
        raise HTTPException(401, "Incorrect username or password")
    if not _verify_hash(body.password, user.password_hash):
        logger.warning("Login failed: wrong password for user '%s'", user.username)
        raise HTTPException(401, "Incorrect username or password")
    return await _create_session(user, response, db)


@router.post("/logout")
async def logout(
    response: Response,
    session_token: str | None = Cookie(None),
    db: AsyncSession = Depends(get_db),
):
    if session_token:
        await db.execute(delete(UserSession).where(UserSession.token == session_token))
        await db.commit()
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/me")
async def me(session_token: str | None = Cookie(None), db: AsyncSession = Depends(get_db)):
    """Returns the current user's info + raw token (for WebSocket auth)."""
    user, session = await _get_user_session(session_token, db)
    if user is None:
        raise HTTPException(401, "Not authenticated")
    return {
        "authenticated": True,
        "token": session.token,
        "username": user.username,
        "is_admin": user.is_admin,
        "user_id": user.id,
    }


# ── Dependency used by all protected routes ───────────────────────────────────

async def require_auth(
    session_token: str | None = Cookie(None),
    db: AsyncSession = Depends(get_db),
) -> User:
    user, _ = await _get_user_session(session_token, db)
    if user is None:
        raise HTTPException(401, "Authentication required")
    return user


async def require_admin(current_user: User = Depends(require_auth)) -> User:
    if not current_user.is_admin:
        raise HTTPException(403, "Admin access required")
    return current_user


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_user_session(
    token: str | None, db: AsyncSession
) -> tuple[User | None, UserSession | None]:
    if not token:
        return None, None
    result = await db.execute(select(UserSession).where(UserSession.token == token))
    session = result.scalar_one_or_none()
    if session is None or datetime.utcnow() > session.expires_at:
        return None, None
    user_result = await db.execute(select(User).where(User.id == session.user_id))
    user = user_result.scalar_one_or_none()
    return user, session


async def _create_session(user: User, response: Response, db: AsyncSession) -> dict:
    # Evict expired sessions for this user
    await db.execute(
        delete(UserSession).where(
            UserSession.user_id == user.id,
            UserSession.expires_at < datetime.utcnow(),
        )
    )
    token = secrets.token_hex(32)
    expires = datetime.utcnow() + timedelta(days=SESSION_DAYS)
    db.add(UserSession(user_id=user.id, token=token, expires_at=expires))
    await db.commit()

    response.set_cookie(
        COOKIE_NAME, token,
        httponly=True, samesite="strict", secure=False,
        max_age=SESSION_DAYS * 86_400, path="/",
    )
    return {"ok": True}


# ── WS token validator (used by ws.py) ────────────────────────────────────────

async def validate_ws_token(token: str | None) -> bool:
    """Used by the WebSocket endpoint to validate the query-param token."""
    if not token:
        return False
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(UserSession).where(UserSession.token == token))
        session = result.scalar_one_or_none()
        return session is not None and datetime.utcnow() <= session.expires_at
