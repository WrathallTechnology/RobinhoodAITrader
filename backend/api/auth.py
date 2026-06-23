"""Robinhood MCP OAuth 2.0 + PKCE + Dynamic Client Registration.

Robinhood's MCP server uses the MCP protocol's OAuth support (RFC 6749 + RFC 7636 + RFC 7591).
The flow:
  1. Probe the MCP endpoint → get 401 with WWW-Authenticate pointing to OAuth server
  2. Fetch OAuth server metadata (RFC 8414) to discover endpoints
  3. Dynamically register our client (RFC 7591) to receive a client_id — no pre-registration needed
  4. Redirect user through Robinhood's login with PKCE
  5. Exchange code for tokens and store them
"""
import base64
import hashlib
import json
import logging
import secrets
from datetime import datetime, timedelta
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from crypto import encrypt, decrypt
from models.database import AsyncSessionLocal, OAuthClientReg, OAuthToken, User, get_db
from api.session import require_auth

router = APIRouter()
logger = logging.getLogger(__name__)

MCP_SERVER_URL = "https://agent.robinhood.com/mcp/trading"

# In-process cache — populated from DB on first use
_registered_client: dict | None = None  # {client_id, token_url, auth_url, redirect_uri}

# Scopes discovered from the protected resource metadata
_resource_scopes: list[str] = []


# ── OAuth metadata discovery ───────────────────────────────────────────────────

async def _discover_oauth_metadata() -> dict:
    """
    Discover OAuth 2.0 server metadata by probing the MCP endpoint.

    Priority order:
      1. 401 WWW-Authenticate header from MCP endpoint → follow to metadata URL
      2. Standard well-known URL derived from MCP server base
      3. Hardcoded fallback
    """
    async with httpx.AsyncClient(follow_redirects=True, timeout=15) as client:

        # Step 1 — probe MCP endpoint, expect a 401 with auth server info
        try:
            probe = await client.post(MCP_SERVER_URL, content=json.dumps({
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": "2024-11-05", "capabilities": {},
                           "clientInfo": {"name": "robinhood-ai-trader", "version": "1.0"}},
            }), headers={"Content-Type": "application/json"})

            if probe.status_code == 401:
                www_auth = probe.headers.get("WWW-Authenticate", "")
                logger.info("MCP 401 WWW-Authenticate: %s", www_auth)

                # WWW-Authenticate format: "Bearer resource_metadata="<url>""
                # Strip the scheme prefix then parse key=value pairs
                header_body = www_auth.removeprefix("Bearer").strip()
                kv: dict[str, str] = {}
                for token in header_body.split(","):
                    token = token.strip()
                    if "=" in token:
                        k, _, v = token.partition("=")
                        kv[k.strip().lower()] = v.strip().strip('"')

                resource_meta_url = kv.get("resource_metadata") or kv.get("realm")
                if resource_meta_url and resource_meta_url.startswith("http"):
                    # Fetch the protected resource metadata document
                    res_meta = await client.get(resource_meta_url)
                    if res_meta.status_code == 200:
                        res_doc = res_meta.json()
                        logger.info("Protected resource metadata: %s", res_doc)
                        # Extract supported scopes for later use
                        global _resource_scopes
                        _resource_scopes = res_doc.get("scopes_supported", [])

                        # authorization_servers contains the auth server identifier URL.
                        # Per RFC 8414, derive the metadata URL from the BASE (scheme+host only).
                        from urllib.parse import urlparse
                        for auth_server in res_doc.get("authorization_servers", []):
                            parsed = urlparse(auth_server)
                            base = f"{parsed.scheme}://{parsed.netloc}"
                            for meta_path in (
                                "/.well-known/oauth-authorization-server",
                                "/.well-known/openid-configuration",
                            ):
                                as_meta = await client.get(base + meta_path)
                                if as_meta.status_code == 200:
                                    logger.info("OAuth auth-server metadata from: %s%s", base, meta_path)
                                    return as_meta.json()
        except Exception as exc:
            logger.debug("MCP probe error: %s", exc)

        # Step 2 — try standard well-known locations
        base = "https://agent.robinhood.com"
        for path in (
            "/.well-known/oauth-authorization-server",
            "/.well-known/oauth-authorization-server/mcp/trading",
            "/.well-known/openid-configuration",
        ):
            try:
                meta = await client.get(f"{base}{path}")
                if meta.status_code == 200:
                    logger.info("OAuth metadata from %s%s", base, path)
                    return meta.json()
            except Exception:
                pass

    # Step 3 — fallback
    logger.warning("Could not discover OAuth metadata — using fallback endpoints")
    return {
        "authorization_endpoint": "https://robinhood.com/oauth2/authorize/",
        "token_endpoint": "https://api.robinhood.com/oauth2/token/",
        "registration_endpoint": "https://api.robinhood.com/oauth2/client-register/",
    }


# ── Dynamic client registration (RFC 7591) ────────────────────────────────────

async def _get_or_register_client(metadata: dict, redirect_uri: str) -> dict:
    """
    Register our app with Robinhood's OAuth server, persisting the registration in the DB.
    If redirect_uri has changed since last registration, re-registers to get a fresh client_id.
    """
    global _registered_client

    # In-process cache — only valid if redirect_uri matches
    if _registered_client and _registered_client.get("redirect_uri") == redirect_uri:
        return _registered_client

    auth_url = metadata.get("authorization_endpoint", "")
    token_url = metadata.get("token_endpoint", "")
    reg_url = metadata.get("registration_endpoint")

    # Check DB for a persisted registration with matching redirect_uri
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(OAuthClientReg).where(OAuthClientReg.provider == "robinhood")
        )
        row = result.scalar_one_or_none()
        if row and row.redirect_uri == redirect_uri:
            logger.info("Using persisted client_id %s for redirect_uri %s", row.client_id, redirect_uri)
            _registered_client = {
                "client_id": row.client_id,
                "auth_url": row.auth_url,
                "token_url": row.token_url,
                "redirect_uri": row.redirect_uri,
            }
            return _registered_client

        # redirect_uri changed (or no record) — register fresh
        client_id = secrets.token_urlsafe(16)  # unique fallback; overwritten if server assigns one
        if reg_url:
            logger.info("Registering new client at %s with redirect_uri=%s", reg_url, redirect_uri)
            async with httpx.AsyncClient(timeout=15) as http:
                try:
                    resp = await http.post(reg_url, json={
                        "client_name": "RobinHood AI Trader",
                        "redirect_uris": [redirect_uri],
                        "grant_types": ["authorization_code", "refresh_token"],
                        "response_types": ["code"],
                        "token_endpoint_auth_method": "none",
                    })
                    if resp.status_code in (200, 201):
                        data = resp.json()
                        client_id = data.get("client_id", client_id)
                        logger.info("Registered as client_id: %s", client_id)
                    else:
                        logger.warning("Registration returned %d: %s", resp.status_code, resp.text[:200])
                except Exception as exc:
                    logger.warning("Dynamic registration failed: %s", exc)
        else:
            logger.warning("No registration_endpoint in OAuth metadata — using generated client_id")

        # Persist (upsert)
        if row:
            row.client_id = client_id
            row.auth_url = auth_url
            row.token_url = token_url
            row.redirect_uri = redirect_uri
        else:
            db.add(OAuthClientReg(
                provider="robinhood",
                client_id=client_id,
                auth_url=auth_url,
                token_url=token_url,
                redirect_uri=redirect_uri,
            ))
        await db.commit()

    _registered_client = {
        "client_id": client_id,
        "auth_url": auth_url,
        "token_url": token_url,
        "redirect_uri": redirect_uri,
    }
    return _registered_client


# ── PKCE helpers ──────────────────────────────────────────────────────────────

def _pkce_pair() -> tuple[str, str]:
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(64)).rstrip(b"=").decode()
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()
    ).rstrip(b"=").decode()
    return verifier, challenge


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/robinhood/start")
async def robinhood_start(current_user: User = Depends(require_auth)):
    """
    Kick off the Robinhood MCP OAuth flow for the logged-in user.
    Discovers endpoints, registers client if needed, then redirects to Robinhood login.
    """
    redirect_uri = settings.robinhood_redirect_uri
    try:
        metadata = await _discover_oauth_metadata()
        reg = await _get_or_register_client(metadata, redirect_uri)
    except Exception as exc:
        logger.exception("OAuth setup failed")
        raise HTTPException(502, f"Could not connect to Robinhood OAuth: {exc}")

    verifier, challenge = _pkce_pair()
    # Encode all PKCE state + user_id into an encrypted token so a server restart
    # between redirect and callback doesn't invalidate the flow.
    state_payload = json.dumps({
        "user_id": current_user.id,
        "verifier": verifier,
        "client_id": reg["client_id"],
        "token_url": reg["token_url"],
        "expiry": (datetime.utcnow() + timedelta(minutes=10)).isoformat(),
    })
    state = encrypt(state_payload)

    # Use scopes discovered from resource metadata; fall back to 'internal'
    # which is the only scope Robinhood's MCP server advertises
    scope = " ".join(_resource_scopes) if _resource_scopes else "internal"

    params = {
        "client_id": reg["client_id"],
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": scope,
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    logger.info("Auth request scope: %s", scope)
    auth_url = f"{reg['auth_url']}?{urlencode(params)}"
    logger.info("Redirecting to OAuth: %s", reg["auth_url"])
    return RedirectResponse(auth_url)


@router.get("/robinhood/callback")
async def robinhood_callback(
    state: str,
    code: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Exchange authorization code for tokens using PKCE verifier."""
    # OAuth error response (e.g. invalid_scope, access_denied)
    if error:
        logger.error("Robinhood OAuth error: %s — %s", error, error_description)
        return RedirectResponse(f"/settings?auth_error={error}&desc={error_description or ''}")

    if not code:
        raise HTTPException(400, "Missing authorization code in callback")

    try:
        entry = json.loads(decrypt(state))
        expiry = datetime.fromisoformat(entry["expiry"])
        if datetime.utcnow() > expiry:
            raise ValueError("expired")
    except Exception:
        raise HTTPException(400, "Invalid or expired OAuth state — please try connecting again")

    user_id: int = entry["user_id"]

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            entry["token_url"],
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": settings.robinhood_redirect_uri,
                "client_id": entry["client_id"],
                "code_verifier": entry["verifier"],
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

    if resp.status_code != 200:
        logger.error("Token exchange failed %d: %s", resp.status_code, resp.text[:500])
        raise HTTPException(502, f"Robinhood token exchange failed ({resp.status_code}): {resp.text[:200]}")

    data = resp.json()
    expires_at = datetime.utcnow() + timedelta(seconds=data.get("expires_in", 86400))

    result = await db.execute(
        select(OAuthToken).where(OAuthToken.provider == "robinhood", OAuthToken.user_id == user_id)
    )
    row = result.scalar_one_or_none()

    if row:
        row.access_token = encrypt(data["access_token"])
        row.refresh_token = encrypt(data.get("refresh_token", ""))
        row.expires_at = expires_at
        row.token_type = data.get("token_type", "Bearer")
    else:
        db.add(OAuthToken(
            user_id=user_id,
            provider="robinhood",
            access_token=encrypt(data["access_token"]),
            refresh_token=encrypt(data.get("refresh_token", "")),
            expires_at=expires_at,
            token_type=data.get("token_type", "Bearer"),
        ))

    await db.commit()
    logger.info("Robinhood OAuth token stored for user_id=%d, expires %s", user_id, expires_at)
    return RedirectResponse("/?auth=success")


@router.get("/status")
async def auth_status(
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(OAuthToken).where(
            OAuthToken.provider == "robinhood",
            OAuthToken.user_id == current_user.id,
        )
    )
    token = result.scalar_one_or_none()
    if token is None:
        return {"authenticated": False}
    expired = token.expires_at and datetime.utcnow() > token.expires_at
    return {
        "authenticated": not expired,
        "expires_at": token.expires_at.isoformat() if token.expires_at else None,
    }


async def get_robinhood_token(db: AsyncSession, user_id: int) -> str:
    """Return a valid decrypted Robinhood access token for the given user."""
    result = await db.execute(
        select(OAuthToken).where(
            OAuthToken.provider == "robinhood",
            OAuthToken.user_id == user_id,
        )
    )
    token = result.scalar_one_or_none()
    if token is None:
        raise HTTPException(401, "Not authenticated with Robinhood — click 'Connect Robinhood' in Settings")

    if token.expires_at and datetime.utcnow() > token.expires_at:
        await _refresh_token(token, db)

    return decrypt(token.access_token)


async def _refresh_token(token: OAuthToken, db: AsyncSession) -> None:
    if not token.refresh_token or not decrypt(token.refresh_token):
        raise HTTPException(401, "Robinhood session expired — please re-authenticate in Settings")

    global _registered_client
    if not _registered_client:
        metadata = await _discover_oauth_metadata()
        _registered_client = await _get_or_register_client(metadata, settings.robinhood_redirect_uri)

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            _registered_client["token_url"],
            data={
                "grant_type": "refresh_token",
                "refresh_token": decrypt(token.refresh_token),
                "client_id": _registered_client["client_id"],
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

    if resp.status_code != 200:
        raise HTTPException(502, f"Token refresh failed: {resp.text[:200]}")

    data = resp.json()
    token.access_token = encrypt(data["access_token"])
    if data.get("refresh_token"):
        token.refresh_token = encrypt(data["refresh_token"])
    token.expires_at = datetime.utcnow() + timedelta(seconds=data.get("expires_in", 86400))
    await db.commit()
    logger.info("Robinhood token refreshed")
