"""APScheduler setup — per-user jobs, each running on the user's active strategy + LLM."""
import logging
from pathlib import Path

import yaml
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import select

from config import settings
from models.database import AsyncSessionLocal, LLMConfig, StrategyConfig, User
from crypto import decrypt

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler(timezone="UTC")

BUILTIN_STRATEGY_FILES = [
    "momentum.yaml",
    "news_sentiment.yaml",
    "value_investing.yaml",
    "custom_template.yaml",
]


def _job_id(user_id: int) -> str:
    return f"trading_agent_{user_id}"


# ── Built-in strategy seeding ─────────────────────────────────────────────────

async def seed_builtin_strategies_for_user(user_id: int) -> None:
    """Create built-in strategy copies for a specific user if they have none."""
    async with AsyncSessionLocal() as db:
        existing = await db.execute(
            select(StrategyConfig).where(StrategyConfig.user_id == user_id)
        )
        if existing.scalars().first() is not None:
            return  # user already has strategies

        for filename in BUILTIN_STRATEGY_FILES:
            path = settings.strategies_dir / filename
            if not path.exists():
                logger.warning("Built-in strategy file not found: %s", path)
                continue
            content = path.read_text()
            parsed = yaml.safe_load(content)
            name = parsed.get("name", filename)
            db.add(StrategyConfig(
                user_id=user_id, name=name,
                yaml_content=content, is_builtin=True,
            ))
        await db.commit()
        logger.info("Seeded built-in strategies for user_id=%d", user_id)


async def seed_builtin_strategies() -> None:
    """Seed built-in strategies for every existing user that has none."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User))
        users = result.scalars().all()
    for user in users:
        await seed_builtin_strategies_for_user(user.id)


# ── Active strategy / LLM lookup ──────────────────────────────────────────────

async def _get_active_strategy(user_id: int) -> StrategyConfig | None:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(StrategyConfig).where(
                StrategyConfig.user_id == user_id,
                StrategyConfig.enabled == True,
            )
        )
        return result.scalar_one_or_none()


async def _get_active_llm(user_id: int) -> tuple[str, str] | None:
    from api.llm import _model_string
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(LLMConfig).where(
                LLMConfig.user_id == user_id,
                LLMConfig.is_active == True,
            )
        )
        cfg = result.scalar_one_or_none()
        if cfg is None:
            return None
        return _model_string(cfg.provider, cfg.model_name), decrypt(cfg.api_key_encrypted)


# ── Scheduled job ─────────────────────────────────────────────────────────────

async def _run_scheduled_agent(user_id: int) -> None:
    from api.auth import get_robinhood_token
    from agent.runner import run_agent

    strategy = await _get_active_strategy(user_id)
    if strategy is None:
        logger.info("user_id=%d: no active strategy — skipping scheduled run", user_id)
        return

    try:
        llm = await _get_active_llm(user_id)
    except Exception as exc:
        logger.warning("user_id=%d: LLM config error (%s: %s) — skipping run",
                       user_id, type(exc).__name__, exc)
        return

    if llm is None:
        logger.warning("user_id=%d: no active LLM — skipping run", user_id)
        return

    model, api_key = llm

    dry_run = not settings.trading_enabled
    try:
        async with AsyncSessionLocal() as db:
            oauth_token = await get_robinhood_token(db, user_id)
    except Exception as exc:
        logger.warning("user_id=%d: Robinhood not authenticated: %s — skipping", user_id, exc)
        return

    logger.info("Scheduled run — user=%d strategy=%s model=%s dry_run=%s",
                user_id, strategy.name, model, dry_run)
    await run_agent(strategy.yaml_content, model, api_key, oauth_token, dry_run, user_id=user_id)


# ── Public scheduler API ──────────────────────────────────────────────────────

async def reschedule(cron: str, user_id: int) -> None:
    try:
        trigger = CronTrigger.from_crontab(cron)
    except ValueError as exc:
        from fastapi import HTTPException
        raise HTTPException(400, f"Invalid cron expression '{cron}': {exc}") from exc

    job_id = _job_id(user_id)
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)
    scheduler.add_job(
        _run_scheduled_agent,
        trigger,
        args=[user_id],
        id=job_id,
        replace_existing=True,
        max_instances=1,
        misfire_grace_time=60,
    )
    logger.info("Scheduled user_id=%d: %s", user_id, cron)


async def start_scheduler() -> None:
    """Start scheduled jobs for all users that have an enabled strategy."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(StrategyConfig).where(StrategyConfig.enabled == True))
        active = result.scalars().all()
    for s in active:
        if s.user_id is None:
            continue
        parsed = yaml.safe_load(s.yaml_content)
        cron = parsed.get("schedule", "*/30 * * * *")
        await reschedule(cron, s.user_id)


async def stop_scheduler(user_id: int) -> None:
    job_id = _job_id(user_id)
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)
        logger.info("Scheduler job removed for user_id=%d", user_id)


async def trigger_now(user_id: int) -> int:
    from api.auth import get_robinhood_token
    from agent.runner import run_agent

    strategy = await _get_active_strategy(user_id)
    if strategy is None:
        raise ValueError("No active strategy configured")

    try:
        llm = await _get_active_llm(user_id)
    except Exception as exc:
        raise ValueError(f"LLM config error ({type(exc).__name__}: {exc}) — re-enter your API key in Settings") from exc

    if llm is None:
        raise ValueError("No active LLM configured — add one in Settings")

    model, api_key = llm
    async with AsyncSessionLocal() as db:
        oauth_token = await get_robinhood_token(db, user_id)

    dry_run = not settings.trading_enabled
    return await run_agent(strategy.yaml_content, model, api_key, oauth_token, dry_run, user_id=user_id)
