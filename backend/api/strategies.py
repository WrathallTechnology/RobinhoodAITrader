"""Strategy CRUD endpoints — per-user isolation."""
import yaml
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agent.scheduler import reschedule, stop_scheduler
from models.database import StrategyConfig, User, get_db
from api.session import require_auth

router = APIRouter()


class StrategyCreate(BaseModel):
    yaml_content: str


class StrategyUpdate(BaseModel):
    yaml_content: str


def _parse_yaml(content: str) -> dict:
    try:
        return yaml.safe_load(content)
    except yaml.YAMLError as exc:
        raise HTTPException(400, f"Invalid YAML: {exc}")


def _serialize(s: StrategyConfig) -> dict:
    parsed = yaml.safe_load(s.yaml_content) or {}
    return {
        "id": s.id,
        "name": s.name,
        "description": parsed.get("description", ""),
        "schedule": parsed.get("schedule", ""),
        "enabled": s.enabled,
        "is_builtin": s.is_builtin,
        "created_at": s.created_at.isoformat(),
        "yaml_content": s.yaml_content,
    }


@router.get("/strategies")
async def list_strategies(
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(StrategyConfig)
        .where(StrategyConfig.user_id == current_user.id)
        .order_by(StrategyConfig.is_builtin.desc())
    )
    return [_serialize(s) for s in result.scalars().all()]


@router.post("/strategies", status_code=201)
async def create_strategy(
    body: StrategyCreate,
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    parsed = _parse_yaml(body.yaml_content)
    name = parsed.get("name")
    if not name:
        raise HTTPException(400, "Strategy YAML must include a 'name' field")

    existing = await db.execute(
        select(StrategyConfig).where(
            StrategyConfig.user_id == current_user.id,
            StrategyConfig.name == name,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(409, f"Strategy '{name}' already exists")

    strategy = StrategyConfig(
        user_id=current_user.id, name=name,
        yaml_content=body.yaml_content, is_builtin=False,
    )
    db.add(strategy)
    await db.commit()
    await db.refresh(strategy)
    return _serialize(strategy)


@router.put("/strategies/{strategy_id}")
async def update_strategy(
    strategy_id: int,
    body: StrategyUpdate,
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(StrategyConfig).where(
            StrategyConfig.id == strategy_id,
            StrategyConfig.user_id == current_user.id,
        )
    )
    strategy = result.scalar_one_or_none()
    if strategy is None:
        raise HTTPException(404, "Strategy not found")

    parsed = _parse_yaml(body.yaml_content)
    strategy.yaml_content = body.yaml_content
    strategy.name = parsed.get("name", strategy.name)
    strategy.is_builtin = False
    await db.commit()
    await db.refresh(strategy)

    if strategy.enabled:
        await reschedule(parsed.get("schedule", "*/30 * * * *"), current_user.id)

    return _serialize(strategy)


@router.delete("/strategies/{strategy_id}", status_code=204)
async def delete_strategy(
    strategy_id: int,
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(StrategyConfig).where(
            StrategyConfig.id == strategy_id,
            StrategyConfig.user_id == current_user.id,
        )
    )
    strategy = result.scalar_one_or_none()
    if strategy is None:
        raise HTTPException(404, "Strategy not found")
    if strategy.is_builtin:
        raise HTTPException(403, "Cannot delete a built-in strategy — edit it first")
    await db.delete(strategy)
    await db.commit()


@router.post("/strategies/{strategy_id}/enable")
async def enable_strategy(
    strategy_id: int,
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(StrategyConfig).where(
            StrategyConfig.id == strategy_id,
            StrategyConfig.user_id == current_user.id,
        )
    )
    strategy = result.scalar_one_or_none()
    if strategy is None:
        raise HTTPException(404, "Strategy not found")

    all_result = await db.execute(
        select(StrategyConfig).where(StrategyConfig.user_id == current_user.id)
    )
    for s in all_result.scalars().all():
        s.enabled = False

    strategy.enabled = True
    await db.commit()

    parsed = yaml.safe_load(strategy.yaml_content) or {}
    cron = parsed.get("schedule", "*/30 * * * *")
    await reschedule(cron, current_user.id)

    return {"message": f"Strategy '{strategy.name}' enabled", "schedule": cron}


@router.post("/strategies/{strategy_id}/disable")
async def disable_strategy(
    strategy_id: int,
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(StrategyConfig).where(
            StrategyConfig.id == strategy_id,
            StrategyConfig.user_id == current_user.id,
        )
    )
    strategy = result.scalar_one_or_none()
    if strategy is None:
        raise HTTPException(404, "Strategy not found")
    strategy.enabled = False
    await db.commit()
    await stop_scheduler(current_user.id)
    return {"message": f"Strategy '{strategy.name}' disabled"}
