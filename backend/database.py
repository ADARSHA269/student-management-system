import os
from pathlib import Path

from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import event
from sqlalchemy.engine import Engine

db = SQLAlchemy()


@event.listens_for(Engine, "connect")
def enable_sqlite_foreign_keys(connection, connection_record):
    if connection.__class__.__module__.startswith("sqlite3"):
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


def database_uri():
    database_url = os.environ.get("DATABASE_URL")

    if database_url:
        if os.environ.get("VERCEL") and not database_url.lower().startswith(
            ("postgres://", "postgresql://", "postgresql+psycopg2://")
        ):
            raise RuntimeError("Vercel requires DATABASE_URL to be a PostgreSQL connection string.")
        if database_url.startswith("postgres://"):
            database_url = database_url.replace("postgres://", "postgresql://", 1)
        if database_url.startswith("postgresql://"):
            database_url = database_url.replace(
                "postgresql://", "postgresql+psycopg2://", 1
            )
        return database_url

    if os.environ.get("VERCEL"):
        raise RuntimeError("DATABASE_URL must be set on Vercel.")

    local_database = Path(__file__).resolve().parent.parent / "students.db"
    return "sqlite:///" + str(local_database).replace("\\", "/")
