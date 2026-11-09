import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path


def data_dir():
    path = Path(os.getenv("DATA_DIR", "data"))
    path.mkdir(parents=True, exist_ok=True)
    return path


@contextmanager
def connection():
    db = sqlite3.connect(data_dir() / "workspace.db", timeout=20)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def init():
    with connection() as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript("""
        CREATE TABLE IF NOT EXISTS documents (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, hash TEXT UNIQUE NOT NULL,
          size INTEGER NOT NULL, pages INTEGER NOT NULL, created TEXT NOT NULL,
          fields TEXT NOT NULL, sample INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS chunks (
          id TEXT PRIMARY KEY, document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
          page INTEGER NOT NULL, text TEXT NOT NULL, vector TEXT NOT NULL, model TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY, question TEXT NOT NULL, answer TEXT NOT NULL,
          sources TEXT NOT NULL, created TEXT NOT NULL, mode TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS audit (
          id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, detail TEXT NOT NULL,
          created TEXT NOT NULL);
        """)
