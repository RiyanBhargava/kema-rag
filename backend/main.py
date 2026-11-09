import csv
import hashlib
import io
import json
import logging
import os
import secrets
import sqlite3
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import load_dotenv

load_dotenv()
from fastapi import FastAPI, UploadFile, HTTPException, Request
from fastapi.responses import FileResponse, Response, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware
from pydantic import BaseModel, Field
import httpx
from backend import store, rag, answers

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("kema")
app = FastAPI(title="Kema Accounting Intelligence", version="1.0.0")
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=os.getenv("ALLOWED_HOSTS", "127.0.0.1,localhost").split(","),
)
store.init()
limits = defaultdict(deque)


def now():
    return datetime.now(timezone.utc).isoformat()


def audit(db, action, detail):
    db.execute(
        "INSERT INTO audit(action,detail,created) VALUES(?,?,?)",
        (action, detail, now()),
    )


@app.middleware("http")
async def guard(request: Request, call_next):
    request_id = uuid.uuid4().hex[:12]
    token = os.getenv("APP_ACCESS_TOKEN")
    if request.url.path.startswith("/api") and request.url.path != "/api/health":
        if token and not secrets.compare_digest(
            request.headers.get("authorization", ""), "Bearer " + token
        ):
            return JSONResponse(
                {"detail": "Workspace access token required."}, status_code=401
            )
        length = request.headers.get("content-length")
        if length and (not length.isdigit() or int(length) > 11 * 1024 * 1024):
            return JSONResponse({"detail": "Upload limit is 10 MB."}, status_code=413)
        if request.method != "GET":
            origin = request.headers.get("origin")
            if origin and urlsplit(origin).netloc != request.headers.get("host"):
                return JSONResponse(
                    {"detail": "Cross-origin writes are not allowed."}, status_code=403
                )
            key = request.client.host if request.client else "local"
            queue = limits[key]
            while queue and queue[0] < time.monotonic() - 60:
                queue.popleft()
            if len(queue) >= 40:
                return JSONResponse(
                    {"detail": "Too many requests. Please try again in a minute."},
                    status_code=429,
                )
            queue.append(time.monotonic())
    try:
        response = await call_next(request)
    except Exception:
        log.exception("Request failed id=%s", request_id)
        response = JSONResponse(
            {"detail": "Something went wrong. Please retry.", "request_id": request_id},
            status_code=500,
        )
    response.headers.update(
        {
            "X-Request-ID": request_id,
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "same-origin",
            "X-Frame-Options": "DENY",
            "Cache-Control": "no-store",
            "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
            "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
        }
    )
    return response


@app.exception_handler(httpx.HTTPError)
async def provider_error(request, exc):
    log.warning("Provider failed: %s", type(exc).__name__)
    return JSONResponse(
        {
            "detail": "Ollama is unavailable or a model is missing. Start Ollama and check the models in Settings, then retry."
        },
        status_code=502,
    )


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "mode": "ollama" if os.getenv("AI_MODE", "ollama") == "ollama" else "local",
        "embedding_model": rag.embedding_model(),
        "chat_model": os.getenv("CHAT_MODEL", "llama3:latest"),
        "auth_required": bool(os.getenv("APP_ACCESS_TOKEN")),
    }


def document(row):
    return {k: row[k] for k in ("id", "name", "size", "pages", "created", "sample")} | {
        "fields": json.loads(row["fields"])
    }


@app.get("/api/documents")
def documents():
    with store.connection() as db:
        return [
            document(row)
            for row in db.execute("SELECT * FROM documents ORDER BY created DESC")
        ]


def ingest(content, name, sample=False):
    digest = hashlib.sha256(content).hexdigest()
    with store.connection() as db:
        if db.execute("SELECT id FROM documents WHERE hash=?", (digest,)).fetchone():
            raise HTTPException(409, "This document is already in your library.")
        if db.execute("SELECT COUNT(*) FROM documents").fetchone()[0] >= 200:
            raise HTTPException(
                400,
                "Workspace limit reached (200 documents). Remove a document to continue.",
            )
    try:
        pages = rag.extract(content)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    chunks = rag.chunk_pages(pages)
    vectors = rag.embed([c["text"] for c in chunks])
    doc_id = uuid.uuid4().hex
    fields = rag.fields_from_pages(pages)
    try:
        with store.connection() as db:
            db.execute(
                "INSERT INTO documents VALUES(?,?,?,?,?,?,?,?)",
                (
                    doc_id,
                    name,
                    digest,
                    len(content),
                    len(pages),
                    now(),
                    json.dumps(fields),
                    int(sample),
                ),
            )
            db.executemany(
                "INSERT INTO chunks VALUES(?,?,?,?,?,?)",
                [
                    (
                        uuid.uuid4().hex,
                        doc_id,
                        c["page"],
                        c["text"],
                        json.dumps(v),
                        rag.embedding_model(),
                    )
                    for c, v in zip(chunks, vectors)
                ],
            )
            (store.data_dir() / (doc_id + ".pdf")).write_bytes(content)
            audit(db, "document.uploaded", name)
    except sqlite3.IntegrityError as exc:
        (store.data_dir() / (doc_id + ".pdf")).unlink(missing_ok=True)
        raise HTTPException(409, "This document is already in your library.") from exc
    except Exception:
        (store.data_dir() / (doc_id + ".pdf")).unlink(missing_ok=True)
        raise
    return {"id": doc_id, "name": name}


@app.post("/api/documents", status_code=201)
def upload(file: UploadFile):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(415, "Only PDF documents are supported.")
    content = file.file.read(10 * 1024 * 1024 + 1)
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(413, "Upload limit is 10 MB per document.")
    name = Path(file.filename.replace("\\", "/")).name[:180]
    return ingest(content, name)


@app.post("/api/samples")
def load_samples():
    count = 0
    for path in sorted(Path("samples").glob("*.pdf")):
        try:
            ingest(path.read_bytes(), path.name, True)
            count += 1
        except HTTPException as exc:
            if exc.status_code != 409:
                raise
    return {"added": count}


@app.get("/api/documents/{doc_id}/pages")
def pages(doc_id: str):
    with store.connection() as db:
        rows = db.execute(
            "SELECT page,text FROM chunks WHERE document_id=? ORDER BY page,rowid",
            (doc_id,),
        ).fetchall()
        if not rows:
            raise HTTPException(404, "Document not found.")
        return [dict(r) for r in rows]


@app.get("/api/documents/{doc_id}/file")
def original(doc_id: str):
    with store.connection() as db:
        row = db.execute("SELECT name FROM documents WHERE id=?", (doc_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Document not found.")
    return FileResponse(
        store.data_dir() / (doc_id + ".pdf"),
        media_type="application/pdf",
        filename=row["name"],
        content_disposition_type="inline",
    )


@app.delete("/api/documents/{doc_id}")
def delete(doc_id: str):
    with store.connection() as db:
        row = db.execute("SELECT name FROM documents WHERE id=?", (doc_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Document not found.")
        db.execute("DELETE FROM documents WHERE id=?", (doc_id,))

        db.execute("DELETE FROM messages")
        audit(db, "document.deleted", row["name"])
    (store.data_dir() / (doc_id + ".pdf")).unlink(missing_ok=True)
    return {"deleted": doc_id}


@app.get("/api/export")
def export():
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        [
            "Document",
            "Vendor",
            "Invoice",
            "Date",
            "Due date",
            "Currency",
            "Total",
            "Payment status",
        ]
    )
    for doc in documents():
        f = doc["fields"]
        values = [doc["name"]] + [
            f.get(k, "")
            for k in ("vendor", "invoice", "date", "due", "currency", "total", "status")
        ]
        writer.writerow(
            [
                (
                    "'" + str(v)
                    if str(v).startswith(("=", "+", "-", "@", "\t", "\r"))
                    else v
                )
                for v in values
            ]
        )
    return Response(
        buffer.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=kema-documents.csv"},
    )


class Question(BaseModel):
    question: str = Field(min_length=3, max_length=2000)
    document_ids: list[str] = Field(default_factory=list, max_length=200)
    as_of: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).date().isoformat(),
        pattern=r"^\d{4}-\d{2}-\d{2}$",
    )


@app.post("/api/chat")
def chat(body: Question):
    try:
        datetime.strptime(body.as_of, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(422, "Choose a valid as-of date.")
    if not body.question.strip():
        raise HTTPException(422, "Enter a question.")
    with store.connection() as db:
        docs = db.execute("SELECT * FROM documents").fetchall()
        rows = db.execute(
            "SELECT c.*, d.name FROM chunks c JOIN documents d ON d.id=c.document_id"
        ).fetchall()
    if body.document_ids:
        if set(body.document_ids) - {d["id"] for d in docs}:
            raise HTTPException(
                404, "A selected document no longer exists. Refresh your library."
            )
        docs = [d for d in docs if d["id"] in body.document_ids]
        rows = [r for r in rows if r["document_id"] in body.document_ids]
    if not docs:
        raise HTTPException(
            400, "Upload a document or load the sample workspace first."
        )
    answer, sources, mode = answers.answer(body.question, docs, rows, body.as_of)
    result = {
        "id": uuid.uuid4().hex,
        "question": body.question,
        "answer": answer,
        "sources": sources,
        "created": now(),
        "mode": mode,
    }
    with store.connection() as db:
        db.execute(
            "INSERT INTO messages VALUES(?,?,?,?,?,?)",
            (
                result["id"],
                result["question"],
                answer,
                json.dumps(sources),
                result["created"],
                mode,
            ),
        )
        audit(db, "question.answered", f"{len(sources)} sources; {mode}")
    return result


@app.get("/api/history")
def history():
    with store.connection() as db:
        return [
            dict(r) | {"sources": json.loads(r["sources"])}
            for r in db.execute("SELECT * FROM messages ORDER BY created DESC LIMIT 50")
        ]


@app.delete("/api/history")
def clear_history():
    with store.connection() as db:
        db.execute("DELETE FROM messages")
        audit(db, "history.cleared", "Workspace history cleared")
    return {"cleared": True}


@app.get("/api/activity")
def activity():
    with store.connection() as db:
        return [
            dict(r) for r in db.execute("SELECT * FROM audit ORDER BY id DESC LIMIT 50")
        ]


if Path("frontend/dist").exists():
    app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="frontend")
