#!/usr/bin/env python3
"""Migration script to allow additional scheduled message types."""

from __future__ import annotations

import os
import shutil
import sqlite3
import sys
from datetime import datetime
from typing import Optional

LEGACY_COMMENT_MARKER = "-- text, image, audio, video"
DEFAULT_DB_PATH = os.environ.get("WHATSFLOW_DB_PATH", "whatsflow.db")


def _create_backup(db_path: str) -> Optional[str]:
    """Create a timestamped backup of the database file."""

    if not os.path.exists(db_path):
        print(f"⚠️ Banco de dados '{db_path}' não encontrado. Nenhum backup criado.")
        return None

    base_dir = os.path.dirname(db_path) or "."
    base_name = os.path.splitext(os.path.basename(db_path))[0]
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_name = f"{base_name}-backup-scheduled-messages-{timestamp}.db"
    backup_path = os.path.join(base_dir, backup_name)

    shutil.copy2(db_path, backup_path)
    print(f"📦 Backup criado em: {backup_path}")
    return backup_path


def _fetch_table_sql(cursor: sqlite3.Cursor, table: str) -> Optional[str]:
    cursor.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)
    )
    row = cursor.fetchone()
    return row[0] if row and row[0] else None


def _normalize_existing_rows(cursor: sqlite3.Cursor) -> None:
    """Normalize stored values to avoid blank or uppercase message types."""

    cursor.execute(
        """
        UPDATE scheduled_messages
        SET message_type = LOWER(TRIM(message_type))
        WHERE message_type IS NOT NULL
        """
    )
    cursor.execute(
        """
        UPDATE scheduled_messages
        SET message_type = 'text'
        WHERE message_type IS NULL OR TRIM(message_type) = ''
        """
    )
    cursor.execute(
        """
        UPDATE scheduled_messages
        SET media_url = NULL
        WHERE media_url IS NOT NULL AND TRIM(media_url) = ''
        """
    )


def migrate(db_path: str = DEFAULT_DB_PATH) -> bool:
    """Run migration to allow additional scheduled message types."""

    backup_created = _create_backup(db_path)
    if backup_created is None and not os.path.exists(db_path):
        # Database missing and no backup created, nothing to do.
        return True

    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")

        schema_sql = _fetch_table_sql(cursor, "scheduled_messages")
        if not schema_sql:
            print("ℹ️ Tabela 'scheduled_messages' não encontrada. Nenhuma alteração necessária.")
            return True

        needs_rebuild = LEGACY_COMMENT_MARKER in schema_sql or "CHECK" in schema_sql

        if needs_rebuild:
            print("🔄 Atualizando estrutura da tabela 'scheduled_messages'...")
            cursor.execute("PRAGMA foreign_keys=OFF")
            cursor.execute("ALTER TABLE scheduled_messages RENAME TO scheduled_messages_old")
            cursor.execute(
                """
                CREATE TABLE scheduled_messages (
                    id TEXT PRIMARY KEY,
                    campaign_id TEXT NOT NULL,
                    message_text TEXT,
                    message_type TEXT DEFAULT 'text', -- tipo da mensagem (texto, mídia ou outros formatos compatíveis)
                    media_url TEXT,
                    schedule_type TEXT NOT NULL,
                    schedule_time TEXT NOT NULL,
                    schedule_days TEXT,
                    schedule_date TEXT,
                    is_active INTEGER DEFAULT 1,
                    next_run TEXT,
                    created_at TEXT
                )
                """
            )
            cursor.execute(
                """
                INSERT INTO scheduled_messages (
                    id, campaign_id, message_text, message_type, media_url,
                    schedule_type, schedule_time, schedule_days, schedule_date,
                    is_active, next_run, created_at
                )
                SELECT
                    id,
                    campaign_id,
                    message_text,
                    LOWER(COALESCE(NULLIF(TRIM(message_type), ''), 'text')),
                    CASE
                        WHEN media_url IS NULL OR TRIM(media_url) = '' THEN NULL
                        ELSE TRIM(media_url)
                    END,
                    schedule_type,
                    schedule_time,
                    schedule_days,
                    schedule_date,
                    is_active,
                    next_run,
                    created_at
                FROM scheduled_messages_old
                """
            )
            cursor.execute("DROP TABLE scheduled_messages_old")
            cursor.execute("PRAGMA foreign_keys=ON")
        else:
            print("ℹ️ Estrutura da tabela 'scheduled_messages' já está atualizada. Normalizando dados...")

        _normalize_existing_rows(cursor)
        conn.commit()
        print("✅ Migração concluída com sucesso!")
        return True
    except sqlite3.Error as exc:
        if 'conn' in locals():
            conn.rollback()
        print(f"❌ Erro durante migração: {exc}")
        return False
    finally:
        if 'conn' in locals():
            conn.close()


if __name__ == "__main__":
    database_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_DB_PATH
    success = migrate(database_path)
    sys.exit(0 if success else 1)
