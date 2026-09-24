"""In-memory exact-match cache for non-streaming proxy responses."""

from __future__ import annotations

import hashlib
import threading
import time


class ResponseCache:
    def __init__(self, *, ttl_seconds: float = 60.0, max_entries: int = 256) -> None:
        self._ttl = max(ttl_seconds, 1.0)
        self._max = max(max_entries, 8)
        self._lock = threading.Lock()
        self._store: dict[str, tuple[float, bytes, int, dict[str, str]]] = {}

    def make_key(self, model: str, body: bytes) -> str:
        digest = hashlib.sha256(model.encode() + b"\0" + body).hexdigest()
        return digest

    def get(self, key: str) -> tuple[bytes, int, dict[str, str]] | None:
        now = time.monotonic()
        with self._lock:
            item = self._store.get(key)
            if not item:
                return None
            expires, content, status, headers = item
            if expires < now:
                self._store.pop(key, None)
                return None
            return content, status, headers

    def set(self, key: str, content: bytes, status: int, headers: dict[str, str]) -> None:
        if status < 200 or status >= 300:
            return
        expires = time.monotonic() + self._ttl
        with self._lock:
            self._store[key] = (expires, content, status, dict(headers))
            if len(self._store) > self._max:
                oldest = sorted(self._store.items(), key=lambda kv: kv[1][0])[: max(1, self._max // 8)]
                for k, _ in oldest:
                    self._store.pop(k, None)
