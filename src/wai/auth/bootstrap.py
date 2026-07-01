"""First-run bootstrap when WAI_ADMIN_KEY is set and no users exist."""

from __future__ import annotations

import logging
import os
import secrets
import string
from dataclasses import dataclass

import bcrypt

from wai.api.admin.common import (
    ROLE_ORG_ADMIN,
    new_uuid,
)
from wai.config.models import SettingsConfig
from wai.db.connection import Database


@dataclass
class BootstrapResult:
    email: str
    password: str


def _generate_password(length: int = 16) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


async def bootstrap(
    db: Database,
    settings: SettingsConfig,
    hmac_secret: bytes,
    key_cache: object | None = None,
    log: logging.Logger | None = None,
) -> BootstrapResult | None:
    """Create org and admin user on first run. Returns credentials or None."""
    _ = hmac_secret, key_cache
    logger = log or logging.getLogger("wai.bootstrap")
    admin_key = settings.admin_key
    if not admin_key:
        return None
    if len(admin_key) < 32:
        raise ValueError("admin key must be at least 32 characters")

    row = await db.fetchone(
        "SELECT COUNT(*) AS cnt FROM users WHERE deleted_at IS NULL"
    )
    if row and row["cnt"] > 0:
        logger.warning("WAI_ADMIN_KEY is set but database already has users, ignoring")
        return None

    org_name = settings.bootstrap.org_name
    org_slug = settings.bootstrap.org_slug
    admin_email = settings.bootstrap.admin_email
    password = _generate_password()
    password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

    org_id = new_uuid()
    user_id = new_uuid()
    membership_id = new_uuid()

    async with db.transaction() as conn:
        await conn.execute(
            "INSERT INTO organizations (id, name, slug, created_at, updated_at) "
            "VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
            (org_id, org_name, org_slug),
        )
        await conn.execute(
            """INSERT INTO users (id, email, display_name, password_hash, auth_provider,
                                  is_system_admin, created_at, updated_at)
               VALUES (?, ?, ?, ?, 'local', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)""",
            (user_id, admin_email, "Admin", password_hash),
        )
        await conn.execute(
            "INSERT INTO org_memberships (id, org_id, user_id, role, created_at) "
            "VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)",
            (membership_id, org_id, user_id, ROLE_ORG_ADMIN),
        )
        model_rows = await db.fetchall("SELECT name FROM models WHERE deleted_at IS NULL")
        for model_row in model_rows:
            await conn.execute(
                "INSERT INTO org_model_access (id, org_id, model_name) VALUES (?, ?, ?)",
                (new_uuid(), org_id, model_row["name"]),
            )

    os.environ.pop("WAI_ADMIN_KEY", None)
    logger.warning("bootstrap complete, default organization and system admin created")

    return BootstrapResult(email=admin_email, password=password)


def print_bootstrap_credentials(result: BootstrapResult | None) -> None:
    if result is None:
        return
    import sys

    print("", file=sys.stderr)
    print("========================================", file=sys.stderr)
    print(" BOOTSTRAP COMPLETE — COPY THESE NOW", file=sys.stderr)
    print("========================================", file=sys.stderr)
    print(f"  Email:      {result.email}", file=sys.stderr)
    print(f"  Password:   {result.password}", file=sys.stderr)
    print("========================================", file=sys.stderr)
    print("", file=sys.stderr)
