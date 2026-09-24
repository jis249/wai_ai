"""LiteLLM community price list: parsing and fetching.

The source document (``model_prices_and_context_window.json`` in BerriAI/litellm) maps a
model key such as ``gpt-4o`` or ``azure/gpt-4o-mini`` to a dict of fields. We only read the
handful we need, convert per-token costs to per-1M, and skip anything malformed.
"""

from __future__ import annotations

import asyncio
import json
import math
import time
from datetime import datetime, timezone
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import httpx

from wai.config.models import DEFAULT_PRICING_SOURCE_URL
from wai.security.url import validate_http_url

DEFAULT_TIMEOUT_SECONDS = 15.0
DEFAULT_MAX_BYTES = 10 * 1024 * 1024
# Serve the in-memory catalog without a conditional GET when it is younger than this.
DEFAULT_FRESH_SECONDS = 600.0


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")


class CatalogError(Exception):
    """The catalog could not be fetched or parsed."""


@dataclass(frozen=True)
class CatalogEntry:
    key: str
    input_per_1m: float | None = None
    output_per_1m: float | None = None
    max_input_tokens: int = 0
    max_output_tokens: int = 0
    max_tokens: int = 0
    provider: str = ""
    mode: str = ""

    @property
    def has_price(self) -> bool:
        """True when the catalog lists a non-zero price (zero = free/local, treated as no price)."""
        return bool(self.input_per_1m) or bool(self.output_per_1m)

    @property
    def context_window(self) -> int:
        return self.max_input_tokens or self.max_tokens or 0


@dataclass
class Catalog:
    entries: dict[str, CatalogEntry] = field(default_factory=dict)
    source: str = ""
    fetched_at: str = ""
    etag: str = ""
    skipped: int = 0
    _lower: dict[str, str] = field(default_factory=dict, repr=False)

    def __post_init__(self) -> None:
        self._lower = {k.lower(): k for k in self.entries}

    def __len__(self) -> int:
        return len(self.entries)

    def get(self, key: str) -> CatalogEntry | None:
        """Case-insensitive lookup."""
        if not key:
            return None
        exact = self.entries.get(key)
        if exact is not None:
            return exact
        real = self._lower.get(key.lower())
        return self.entries.get(real) if real else None


def _cost_per_1m(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(num) or num < 0:
        return None
    # Round away float noise (2.5e-06 * 1e6 = 2.4999999999999996).
    return round(num * 1_000_000, 6)


def _int_field(value: Any) -> int:
    if value is None or isinstance(value, bool):
        return 0
    try:
        num = float(value)
    except (TypeError, ValueError):
        return 0
    if not math.isfinite(num) or num <= 0:
        return 0
    return int(num)


def parse_entry(key: str, raw: Any) -> CatalogEntry | None:
    """Parse one catalog entry, or None when it is unusable."""
    if not isinstance(key, str) or not key.strip() or not isinstance(raw, dict):
        return None
    key = key.strip()
    if key == "sample_spec":
        return None
    inp = _cost_per_1m(raw.get("input_cost_per_token"))
    out = _cost_per_1m(raw.get("output_cost_per_token"))
    provider = raw.get("litellm_provider")
    mode = raw.get("mode")
    return CatalogEntry(
        key=key,
        input_per_1m=inp,
        output_per_1m=out,
        max_input_tokens=_int_field(raw.get("max_input_tokens")),
        max_output_tokens=_int_field(raw.get("max_output_tokens")),
        max_tokens=_int_field(raw.get("max_tokens")),
        provider=provider.strip() if isinstance(provider, str) else "",
        mode=mode.strip() if isinstance(mode, str) else "",
    )


def parse_catalog(data: Any, *, source: str = "", etag: str = "") -> Catalog:
    """Parse the decoded JSON document. Raises CatalogError if it is not an object."""
    if not isinstance(data, dict):
        raise CatalogError("price list must be a JSON object")
    entries: dict[str, CatalogEntry] = {}
    skipped = 0
    for key, raw in data.items():
        entry = parse_entry(key, raw)
        if entry is None:
            if key != "sample_spec":
                skipped += 1
            continue
        entries[entry.key] = entry
    if not entries:
        raise CatalogError("price list contains no usable entries")
    return Catalog(entries=entries, source=source, fetched_at=utc_now_iso(), etag=etag, skipped=skipped)


def parse_catalog_bytes(body: bytes, *, source: str = "", etag: str = "") -> Catalog:
    try:
        data = json.loads(body.decode("utf-8-sig"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise CatalogError(f"price list is not valid JSON: {exc}") from None
    return parse_catalog(data, source=source, etag=etag)


class CatalogFetcher:
    """Fetch the price list (URL or local file) and cache the last good copy in memory.

    Remote fetches send ``If-None-Match`` with the cached ETag; a 304 keeps the cached catalog.
    A failed fetch raises CatalogError and leaves the cached catalog untouched.
    """

    def __init__(
        self,
        source_url: str = DEFAULT_PRICING_SOURCE_URL,
        local_path: str = "",
        *,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        max_bytes: int = DEFAULT_MAX_BYTES,
        transport: httpx.AsyncBaseTransport | None = None,
        url_validator: Callable[[str], str] | None = None,
        fresh_seconds: float = DEFAULT_FRESH_SECONDS,
    ) -> None:
        self.source_url = (source_url or DEFAULT_PRICING_SOURCE_URL).strip()
        self.local_path = (local_path or "").strip()
        self.timeout = timeout
        self.max_bytes = max_bytes
        self._transport = transport
        self._validate = url_validator or validate_http_url
        self._fresh_seconds = fresh_seconds
        self._cached: Catalog | None = None
        self._cached_at = 0.0
        self._lock = asyncio.Lock()

    @property
    def source(self) -> str:
        return f"file:{self.local_path}" if self.local_path else self.source_url

    @property
    def cached(self) -> Catalog | None:
        return self._cached

    def configure(self, source_url: str, local_path: str, timeout: float, max_bytes: int) -> None:
        """Apply new settings; drops the cache if the source changed."""
        source_url = (source_url or DEFAULT_PRICING_SOURCE_URL).strip()
        local_path = (local_path or "").strip()
        if source_url != self.source_url or local_path != self.local_path:
            self._cached = None
            self._cached_at = 0.0
        self.source_url, self.local_path = source_url, local_path
        self.timeout, self.max_bytes = timeout, max_bytes

    async def get(self, *, refresh: bool = False) -> Catalog:
        async with self._lock:
            if (
                not refresh
                and self._cached is not None
                and time.monotonic() - self._cached_at < self._fresh_seconds
            ):
                return self._cached
            catalog = await (self._load_file() if self.local_path else self._fetch_url())
            self._cached = catalog
            self._cached_at = time.monotonic()
            return catalog

    async def _load_file(self) -> Catalog:
        path = Path(self.local_path)
        try:
            size = path.stat().st_size
            if size > self.max_bytes:
                raise CatalogError(f"price list file is larger than {self.max_bytes} bytes")
            body = await asyncio.to_thread(path.read_bytes)
        except OSError as exc:
            raise CatalogError(f"cannot read price list file: {exc.strerror or exc}") from None
        return await asyncio.to_thread(parse_catalog_bytes, body, source=self.source)

    async def _fetch_url(self) -> Catalog:
        try:
            url = await asyncio.to_thread(self._validate, self.source_url)
        except ValueError as exc:
            raise CatalogError(f"invalid pricing source_url: {exc}") from None
        headers = {"Accept": "application/json"}
        cached = self._cached
        if cached is not None and cached.etag and cached.source == self.source:
            headers["If-None-Match"] = cached.etag
        try:
            async with httpx.AsyncClient(
                timeout=self.timeout, follow_redirects=False, transport=self._transport
            ) as client:
                async with client.stream("GET", url, headers=headers) as resp:
                    if resp.status_code == 304 and cached is not None:
                        return cached
                    if resp.status_code != 200:
                        raise CatalogError(f"price list fetch returned HTTP {resp.status_code}")
                    declared = resp.headers.get("content-length")
                    if declared and declared.isdigit() and int(declared) > self.max_bytes:
                        raise CatalogError(f"price list is larger than {self.max_bytes} bytes")
                    chunks: list[bytes] = []
                    total = 0
                    async for chunk in resp.aiter_bytes():
                        total += len(chunk)
                        if total > self.max_bytes:
                            raise CatalogError(f"price list is larger than {self.max_bytes} bytes")
                        chunks.append(chunk)
                    etag = resp.headers.get("etag", "")
        except httpx.HTTPError as exc:
            raise CatalogError(f"price list fetch failed: {type(exc).__name__}: {exc}") from None
        return await asyncio.to_thread(parse_catalog_bytes, b"".join(chunks), source=self.source, etag=etag)
