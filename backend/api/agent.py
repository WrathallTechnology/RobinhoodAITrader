"""Agent control endpoints — start, stop, run-now, status."""
import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException

from agent.scheduler import start_scheduler, stop_scheduler, trigger_now, scheduler, _job_id
from models.database import User
from api.session import require_auth

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/agent/status")
async def agent_status(current_user: User = Depends(require_auth)):
    job = scheduler.get_job(_job_id(current_user.id))
    return {
        "scheduled": job is not None,
        "next_run": job.next_run_time.isoformat() if job and job.next_run_time else None,
    }


@router.post("/agent/start")
async def start_agent(current_user: User = Depends(require_auth)):
    await start_scheduler()
    return {"message": "Agent scheduler started"}


@router.post("/agent/stop")
async def stop_agent(current_user: User = Depends(require_auth)):
    await stop_scheduler(current_user.id)
    return {"message": "Agent scheduler stopped"}


@router.post("/agent/run-now")
async def run_now(current_user: User = Depends(require_auth)):
    """Trigger an immediate agent run for the current user."""
    try:
        asyncio.create_task(trigger_now(current_user.id))
        return {"message": "Agent run triggered"}
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        logger.exception("Failed to trigger agent run")
        raise HTTPException(500, str(exc))
