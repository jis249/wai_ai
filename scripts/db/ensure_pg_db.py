"""Create the wai PostgreSQL database if it does not exist."""
from __future__ import annotations

import asyncio
import os
from pathlib import Path

import asyncpg


def _load_local_env() -> None:
    env_path = Path(__file__).resolve().parents[2] / ".env.local"
    if not env_path.is_file():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        name, value = name.strip(), value.strip()
        if name:
            os.environ[name] = value


async def main() -> None:
    _load_local_env()
    password = os.environ.get("POSTGRES_PASSWORD", "postgres")
    db_name = os.environ.get("WAI_DATABASE_NAME", "wai")
    host = os.environ.get("POSTGRES_HOST", "127.0.0.1")
    port = int(os.environ.get("POSTGRES_PORT", "5432"))
    conn = await asyncpg.connect(
        host=host,
        port=port,
        user="postgres",
        password=password,
        database="postgres",
        ssl=False,
    )
    try:
        exists = await conn.fetchval(
            "SELECT 1 FROM pg_database WHERE datname = $1", db_name
        )
        if not exists:
            await conn.execute(f'CREATE DATABASE "{db_name}"')
            print(f"Created database {db_name}")
        else:
            print(f"Database {db_name} already exists")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
