"""Local FastAPI server using the existing persistent demo.sqlite database."""

import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace

import uvicorn
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))

from app import create_app
from database import SQLiteDatabase
from transport import LocalTransport


def local_app():
    values = {**dotenv_values(ROOT / ".dev.vars"), **os.environ}
    values["DEMO_PASSWORD"] = values.get("DEMO_PASSWORD") or "demo12345"
    folder = ROOT / ".local"
    folder.mkdir(exist_ok=True)
    database = SQLiteDatabase(folder / "demo.sqlite", (ROOT / "schema.sql").read_text(encoding="utf-8"))
    app = create_app(SimpleNamespace(**values), database, transport=LocalTransport())

    @asynccontextmanager
    async def lifespan(app):
        try:
            yield
        finally:
            database.close()

    app.router.lifespan_context = lifespan
    return app


if __name__ == "__main__":
    uvicorn.run(local_app(), host="127.0.0.1", port=int(os.environ.get("DEMO_PORT", "8787")))
