"""APScheduler setup — loads the active strategy and runs the agent on its cron schedule."""
import logging
from pathlib import Path

import yaml
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import select

from config import settings
from models.database import AsyncSessionLocal, LLMConfig, StrategyConfig
from crypto import decrypt

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler(timezone="UTC")
_current_job_id = "trading_agent"

BUILTIN_STRATEGY_FILES = [
    "momentum.yaml",
    "news_sentiment.yaml",
    "value_investing.yaml",
    "custom_template.yaml",
]


async def seed_builtin_strategies() -> None:
    """Load built-in strategy YAMLs into the database on first run."""
    async with AsyncSessionLocal() as db:
        for filename in BUILTIN_STRATEGY_FILES:
            path = settings.strategies_dir / filename
            if not path.exists():
                logger.warning("Built-in strategy file not found: %s", path)
                continue
            content = path.read_text()
            parsed = yaml.safe_load(content)
            name = parsed.get("name", filename)

            existing = await db.execute(select(StrategyConfig).where(StrategyConfig.name == name))
            if existing.scalar_one_or_none() is None:
                db.add(StrategyConfig(name=name, yaml_content=content, is_builtin=True))
        await db.commit()


async def _get_active_strategy() -> StrategyConfig | None:
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(StrategyConfig).where(StrategyConfig.enabled == True))
        return result.scalar_one_or_none()


async def _get_active_llm() -> tuple[str, str] | None:
    """Return (litellm_model_string, api_key) or None."""
    from api.llm import _model_string
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(LLMConfig).where(LLMConfig.is_active == True))
        cfg = result.scalar_one_or_none()
        if cfg is None:
            return None
        model = _model_string(cfg.provider, cfg.model_name)
        api_key = decrypt(cfg.api_key_encrypted)
        return model, api_key


async def _run_scheduled_agent() -> None:
    from api.auth import get_robinhood_token
    from agent.runner import run_agent

    strategy = await _get_active_strategy()
    if strategy is None:
        logger.info("No active strategy — skipping scheduled run")
        return

    llm = await _get_active_llm()
    if llm is None:
        logger.warning("No active LLM config — skipping scheduled run")
        return

    model, api_key = llm

    try:
        async with AsyncSessionLocal() as db:
            oauth_token = await get_robinhood_token(db)
    except Exception as exc:
        logger.warning("Robinhood not authenticated: %s — skipping run", exc)
        return

    dry_run = not settings.trading_enabled
    logger.info("Scheduled run — strategy=%s model=%s dry_run=%s", strategy.name, model, dry_run)
    await run_agent(strategy.yaml_content, model, api_key, oauth_token, dry_run)


async def reschedule(cron: str) -> None:
    """Update the scheduler job to use a new cron expression."""
    if scheduler.get_job(_current_job_id):
        scheduler.remove_job(_current_job_id)
    scheduler.add_job(
        _run_scheduled_agent,
        CronTrigger.from_crontab(cron),
        id=_current_job_id,
        replace_existing=True,
        max_instances=1,
        misfire_grace_time=60,
    )
    logger.info("Scheduler rescheduled: %s", cron)


async def start_scheduler() -> None:
    strategy = await _get_active_strategy()
    if strategy:
        parsed = yaml.safe_load(strategy.yaml_content)
        cron = parsed.get("schedule", "*/30 * * * *")
        await reschedule(cron)


async def stop_scheduler() -> None:
    if scheduler.get_job(_current_job_id):
        scheduler.remove_job(_current_job_id)
        logger.info("Scheduler job removed (kill switch)")


async def trigger_now() -> int:
    """Trigger an immediate agent run outside the schedule. Returns run_id."""
    from api.auth import get_robinhood_token
    from agent.runner import run_agent

    strategy = await _get_active_strategy()
    if strategy is None:
        raise ValueError("No active strategy configured")

    llm = await _get_active_llm()
    if llm is None:
        raise ValueError("No active LLM configured — add one in Settings")

    model, api_key = llm
    async with AsyncSessionLocal() as db:
        oauth_token = await get_robinhood_token(db)

    dry_run = not settings.trading_enabled
    return await run_agent(strategy.yaml_content, model, api_key, oauth_token, dry_run)
