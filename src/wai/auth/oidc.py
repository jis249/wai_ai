"""OpenID Connect authorization-code client (tested against Microsoft Entra ID)."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlencode

import httpx
import jwt

from wai.config.models import SSOConfig

_JWKS_TTL_SECONDS = 3600
_ALLOWED_ALGS = ("RS256", "RS384", "RS512", "ES256", "ES384", "ES512")


@dataclass
class OIDCClaims:
    subject: str
    email: str
    name: str
    email_verified: Any = None
    raw: dict[str, Any] = field(default_factory=dict)


class OIDCError(Exception):
    pass


class OIDCProvider:
    """Discovery, authorize URL, code exchange and ID-token verification for one issuer."""

    def __init__(self, cfg: SSOConfig, metadata: dict[str, Any], *, timeout: float = 10.0) -> None:
        self.cfg = cfg
        self.issuer = str(metadata["issuer"])
        self.authorization_endpoint = str(metadata["authorization_endpoint"])
        self.token_endpoint = str(metadata["token_endpoint"])
        self.jwks_uri = str(metadata["jwks_uri"])
        self._timeout = timeout
        self._jwks: dict[str, Any] = {}
        self._jwks_fetched_at = 0.0
        self._jwks_lock = asyncio.Lock()

    @classmethod
    async def discover(cls, cfg: SSOConfig, *, timeout: float = 10.0) -> "OIDCProvider":
        url = cfg.issuer.rstrip("/") + "/.well-known/openid-configuration"
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(url)
        if resp.status_code != 200:
            raise OIDCError(f"discovery failed: HTTP {resp.status_code} from {url}")
        metadata = resp.json()
        for key in ("issuer", "authorization_endpoint", "token_endpoint", "jwks_uri"):
            if not metadata.get(key):
                raise OIDCError(f"discovery document missing {key}")
        return cls(cfg, metadata, timeout=timeout)

    def auth_url(self, state: str, nonce: str) -> str:
        params = {
            "client_id": self.cfg.client_id,
            "response_type": "code",
            "redirect_uri": self.cfg.redirect_url,
            "response_mode": "query",
            "scope": " ".join(self.cfg.scopes or ["openid", "profile", "email"]),
            "state": state,
            "nonce": nonce,
            "prompt": "select_account",
        }
        return f"{self.authorization_endpoint}?{urlencode(params)}"

    async def exchange(self, code: str, nonce: str) -> OIDCClaims:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(
                self.token_endpoint,
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": self.cfg.redirect_url,
                    "client_id": self.cfg.client_id,
                    "client_secret": self.cfg.client_secret,
                    "scope": " ".join(self.cfg.scopes or ["openid", "profile", "email"]),
                },
                headers={"Accept": "application/json"},
            )
        if resp.status_code != 200:
            raise OIDCError(f"token endpoint returned HTTP {resp.status_code}: {resp.text[:300]}")
        id_token = resp.json().get("id_token")
        if not id_token:
            raise OIDCError("token response has no id_token")
        claims = await self._verify(id_token)
        if not nonce or claims.get("nonce") != nonce:
            raise OIDCError("id_token nonce mismatch")
        subject = str(claims.get("sub") or "")
        if not subject:
            raise OIDCError("id_token has no sub claim")
        # Entra ID often omits `email`; preferred_username is the tenant-controlled UPN.
        email = str(claims.get("email") or claims.get("preferred_username") or claims.get("upn") or "").strip().lower()
        if not email:
            raise OIDCError("id_token has no email or preferred_username claim")
        return OIDCClaims(
            subject=subject,
            email=email,
            name=str(claims.get("name") or "").strip(),
            email_verified=claims.get("email_verified"),
            raw=claims,
        )

    async def _verify(self, id_token: str) -> dict[str, Any]:
        try:
            header = jwt.get_unverified_header(id_token)
        except jwt.PyJWTError as exc:
            raise OIDCError(f"malformed id_token: {exc}") from exc
        alg = header.get("alg", "")
        if alg not in _ALLOWED_ALGS:
            raise OIDCError(f"unsupported id_token alg {alg!r}")
        key = await self._signing_key(header.get("kid", ""))
        try:
            return jwt.decode(
                id_token,
                key=key,
                algorithms=[alg],
                audience=self.cfg.client_id,
                issuer=self.issuer,
                leeway=60,
                options={"require": ["exp", "iat", "sub", "aud", "iss"]},
            )
        except jwt.PyJWTError as exc:
            raise OIDCError(f"id_token verification failed: {exc}") from exc

    async def _signing_key(self, kid: str) -> Any:
        key = self._jwks.get(kid)
        stale = time.monotonic() - self._jwks_fetched_at > _JWKS_TTL_SECONDS
        if key is None or stale:
            async with self._jwks_lock:
                if kid not in self._jwks or time.monotonic() - self._jwks_fetched_at > _JWKS_TTL_SECONDS:
                    await self._refresh_jwks()
            key = self._jwks.get(kid)
        if key is None:
            raise OIDCError(f"no signing key found for kid {kid!r}")
        return key

    async def _refresh_jwks(self) -> None:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.get(self.jwks_uri)
        if resp.status_code != 200:
            raise OIDCError(f"jwks fetch failed: HTTP {resp.status_code}")
        keys: dict[str, Any] = {}
        for jwk in resp.json().get("keys", []):
            if jwk.get("use", "sig") != "sig" or not jwk.get("kid"):
                continue
            try:
                keys[jwk["kid"]] = jwt.PyJWK.from_json(json.dumps(jwk)).key
            except jwt.PyJWTError:
                continue
        self._jwks = keys
        self._jwks_fetched_at = time.monotonic()


async def build_sso_provider(cfg: SSOConfig, log: logging.Logger) -> OIDCProvider | None:
    """Return a ready provider, or None (logged) when SSO is disabled or misconfigured."""
    if not cfg.enabled:
        return None
    missing = [
        name for name, value in (
            ("issuer", cfg.issuer), ("client_id", cfg.client_id),
            ("client_secret", cfg.client_secret), ("redirect_url", cfg.redirect_url),
        ) if not value
    ]
    # An unset tenant id interpolates to ".../microsoftonline.com//v2.0".
    if "//v2.0" in cfg.issuer:
        missing.append("issuer tenant id")
    if missing:
        log.error("sso.enabled is true but %s not set; SSO login disabled", ", ".join(missing))
        return None
    try:
        provider = await OIDCProvider.discover(cfg)
    except Exception as exc:
        log.error("SSO discovery failed for %s: %s; SSO login disabled", cfg.issuer, exc)
        return None
    log.info("SSO enabled via %s", provider.issuer)
    return provider
