"""Local update-check stub — reports the packaged version without a remote call."""

from __future__ import annotations

from typing import Any

from wai import __version__


class UpdateChecker:
    def get_info(self) -> dict[str, Any]:
        return {
            "current_version": __version__,
            "available_version": __version__,
            "needs_update": False,
            "release_url": "",
        }
