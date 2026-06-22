"""LLM configuration endpoints — provider, model, API key management."""
import litellm
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from crypto import encrypt, decrypt
from models.database import LLMConfig, get_db

router = APIRouter()

PROVIDER_DEFAULTS: dict[str, str] = {
    "anthropic": "claude-opus-4-8",
    "openai": "gpt-4o",
    "google": "gemini-2.0-flash",
    "groq": "llama-3.3-70b-versatile",
    "mistral": "mistral-large-latest",
    "cohere": "command-r-plus",
}

# LiteLLM uses different routing prefixes from our display names
_LITELLM_PREFIX: dict[str, str] = {
    "google": "gemini",   # AI Studio: gemini/gemini-2.0-flash
}


def _model_string(provider: str, model_name: str) -> str:
    prefix = _LITELLM_PREFIX.get(provider, provider)
    return f"{prefix}/{model_name}"


class LLMConfigCreate(BaseModel):
    provider: str
    model_name: str
    api_key: str


class LLMTestRequest(BaseModel):
    provider: str
    model_name: str
    api_key: str


def _serialize(cfg: LLMConfig) -> dict:
    return {
        "id": cfg.id,
        "provider": cfg.provider,
        "model_name": cfg.model_name,
        "model_string": _model_string(cfg.provider, cfg.model_name),
        "is_active": cfg.is_active,
        "created_at": cfg.created_at.isoformat(),
        "api_key_set": bool(cfg.api_key_encrypted),
    }


@router.get("/llm/providers")
async def list_providers():
    """Return supported providers and their default models."""
    return [{"provider": k, "default_model": v} for k, v in PROVIDER_DEFAULTS.items()]


@router.get("/llm/config")
async def get_llm_configs(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(LLMConfig))
    return [_serialize(c) for c in result.scalars().all()]


@router.post("/llm/config", status_code=201)
async def create_llm_config(body: LLMConfigCreate, db: AsyncSession = Depends(get_db)):
    cfg = LLMConfig(
        provider=body.provider,
        model_name=body.model_name,
        api_key_encrypted=encrypt(body.api_key),
        is_active=False,
    )
    db.add(cfg)
    await db.commit()
    await db.refresh(cfg)
    return _serialize(cfg)


@router.post("/llm/config/{config_id}/activate")
async def activate_llm(config_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(LLMConfig).where(LLMConfig.id == config_id))
    cfg = result.scalar_one_or_none()
    if cfg is None:
        raise HTTPException(404, "LLM config not found")

    all_result = await db.execute(select(LLMConfig))
    for c in all_result.scalars().all():
        c.is_active = False
    cfg.is_active = True
    await db.commit()
    return {"message": f"Activated {cfg.provider}/{cfg.model_name}"}


@router.delete("/llm/config/{config_id}", status_code=204)
async def delete_llm_config(config_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(LLMConfig).where(LLMConfig.id == config_id))
    cfg = result.scalar_one_or_none()
    if cfg is None:
        raise HTTPException(404, "LLM config not found")
    await db.delete(cfg)
    await db.commit()


@router.post("/llm/test")
async def test_llm(body: LLMTestRequest):
    """Send a minimal test request to verify the API key + model work."""
    model_string = _model_string(body.provider, body.model_name)
    try:
        response = await litellm.acompletion(
            model=model_string,
            api_key=body.api_key,
            messages=[{"role": "user", "content": "Reply with only: OK"}],
            max_tokens=10,
        )
        reply = response.choices[0].message.content or ""
        return {"success": True, "model": model_string, "reply": reply.strip()}
    except Exception as exc:
        raise HTTPException(400, f"LLM test failed: {exc}")
