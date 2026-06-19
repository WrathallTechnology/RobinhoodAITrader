"""User management — admin-only CRUD for accounts."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import User, get_db
from api.session import require_admin, require_auth, _make_hash

router = APIRouter()


@router.get("")
async def list_users(
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).order_by(User.created_at))
    users = result.scalars().all()
    return [
        {
            "id": u.id,
            "username": u.username,
            "is_admin": u.is_admin,
            "created_at": u.created_at,
        }
        for u in users
    ]


class CreateUserRequest(BaseModel):
    username: str
    password: str
    is_admin: bool = False


@router.post("")
async def create_user(
    body: CreateUserRequest,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if len(body.username) < 2:
        raise HTTPException(422, "Username must be at least 2 characters")
    if len(body.password) < 8:
        raise HTTPException(422, "Password must be at least 8 characters")
    existing = await db.execute(select(User).where(User.username == body.username))
    if existing.scalar_one_or_none():
        raise HTTPException(409, f"Username '{body.username}' already exists")
    user = User(
        username=body.username,
        password_hash=_make_hash(body.password),
        is_admin=body.is_admin,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return {"id": user.id, "username": user.username, "is_admin": user.is_admin}


@router.delete("/{user_id}")
async def delete_user(
    user_id: int,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if user_id == current_user.id:
        raise HTTPException(400, "You cannot delete your own account")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found")
    await db.delete(user)
    await db.commit()
    return {"ok": True}


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@router.post("/me/password")
async def change_own_password(
    body: ChangePasswordRequest,
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    from api.session import _verify_hash
    if not _verify_hash(body.current_password, current_user.password_hash):
        raise HTTPException(401, "Current password is incorrect")
    if len(body.new_password) < 8:
        raise HTTPException(422, "New password must be at least 8 characters")
    current_user.password_hash = _make_hash(body.new_password)
    await db.commit()
    return {"ok": True}


class AdminSetPasswordRequest(BaseModel):
    new_password: str


@router.post("/{user_id}/password")
async def admin_set_password(
    user_id: int,
    body: AdminSetPasswordRequest,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if len(body.new_password) < 8:
        raise HTTPException(422, "Password must be at least 8 characters")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found")
    user.password_hash = _make_hash(body.new_password)
    await db.commit()
    return {"ok": True}
