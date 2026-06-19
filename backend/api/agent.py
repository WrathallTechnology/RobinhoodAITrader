"""Agent control endpoints — start, stop, run-now, status."""
import asyncio
import logging

from fastapi import APIRouter, HTTPException

from agent.scheduler import start_scheduler, stop_scheduler, trigger_now, scheduler, _current_job_id

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/agent/status")
async def agent_status():
    job = scheduler.get_job(_current_job_id)
    return {
        "scheduled": job is not None,
        "next_run": job.next_run_time.isoformat() if job and job.next_run_time else None,
    }


@router.post("/agent/start")
async def start_agent():
    await start_scheduler()
    return {"message": "Agent scheduler started"}


@router.post("/agent/stop")
async def stop_agent():
    await stop_scheduler()
    return {"message": "Agent scheduler stopped"}


@router.post("/agent/run-now")
async def run_now():
    """Trigger an immediate agent run outside the schedule."""
    try:
        asyncio.create_task(trigger_now())
        return {"message": "Agent run triggered"}
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        logger.exception("Failed to trigger agent run")
        raise HTTPException(500, str(exc))
