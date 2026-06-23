"""Idempotent SQLite migrations — run once on startup before create_all."""
import logging
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

logger = logging.getLogger(__name__)


async def run_migrations(conn: AsyncConnection) -> None:
    # ── strategy_config: recreate with (name, user_id) unique + cascade ──────
    result = await conn.execute(text(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='strategy_config'"
    ))
    if result.scalar_one_or_none():
        result = await conn.execute(text("PRAGMA table_info(strategy_config)"))
        cols = {row[1] for row in result.fetchall()}
        if "user_id" not in cols:
            logger.info("Migrating strategy_config → per-user")
            await conn.execute(text("""
                CREATE TABLE strategy_config_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER REFERENCES trader_user(id) ON DELETE CASCADE,
                    name VARCHAR(128) NOT NULL,
                    yaml_content TEXT NOT NULL,
                    enabled BOOLEAN NOT NULL DEFAULT 0,
                    is_builtin BOOLEAN NOT NULL DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(name, user_id)
                )
            """))
            await conn.execute(text("""
                INSERT INTO strategy_config_new
                    (id, user_id, name, yaml_content, enabled, is_builtin, created_at)
                SELECT sc.id,
                       (SELECT id FROM trader_user ORDER BY id LIMIT 1),
                       sc.name, sc.yaml_content, sc.enabled, sc.is_builtin, sc.created_at
                FROM strategy_config sc
            """))
            await conn.execute(text("DROP TABLE strategy_config"))
            await conn.execute(text("ALTER TABLE strategy_config_new RENAME TO strategy_config"))

    # ── simple ADD COLUMN migrations for other tables ─────────────────────────
    _add_cols = [
        ("llm_config",    "user_id INTEGER REFERENCES trader_user(id)"),
        ("trade_log",     "user_id INTEGER REFERENCES trader_user(id)"),
        ("agent_run",     "user_id INTEGER REFERENCES trader_user(id)"),
        ("paper_settings","user_id INTEGER REFERENCES trader_user(id)"),
    ]
    for table, col_def in _add_cols:
        tbl = await conn.execute(text(
            f"SELECT name FROM sqlite_master WHERE type='table' AND name='{table}'"
        ))
        if not tbl.scalar_one_or_none():
            continue  # table doesn't exist yet — create_all will handle it
        result = await conn.execute(text(f"PRAGMA table_info({table})"))
        cols = {row[1] for row in result.fetchall()}
        col_name = col_def.split()[0]
        if col_name not in cols:
            logger.info("Adding %s.%s", table, col_name)
            await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col_def}"))

    # Assign existing orphan rows to the first user
    _assign = ["trade_log", "agent_run", "llm_config", "paper_settings"]
    for table in _assign:
        tbl = await conn.execute(text(
            f"SELECT name FROM sqlite_master WHERE type='table' AND name='{table}'"
        ))
        if tbl.scalar_one_or_none():
            await conn.execute(text(
                f"UPDATE {table} SET user_id = (SELECT id FROM trader_user ORDER BY id LIMIT 1) "
                f"WHERE user_id IS NULL"
            ))
