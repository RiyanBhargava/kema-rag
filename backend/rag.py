import hashlib
import io
import json
import math
import os
import re
from collections import Counter
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pypdf import PdfReader
import httpx

STOP = set(
    "what which is the a an of in on to for are with this that and how much me show please can you my all from".split()
)


def tokens(text):
    return [t for t in re.findall(r"[a-z0-9]+", text.lower()) if t not in STOP]


def embedding_model():
    return (
        os.getenv("EMBEDDING_MODEL", "nomic-embed-text:latest")
        if os.getenv("AI_MODE", "ollama") == "ollama"
        else "local-hash-v1"
    )


def embed(texts):
    if os.getenv("AI_MODE", "ollama") == "ollama":
        inputs = [
            (
                ("search_query: " + t[6:])
                if t.startswith("QUERY:")
                else ("search_document: " + t)
            )
            for t in texts
        ]
        response = httpx.post(
            os.getenv("OLLAMA_URL", "http://127.0.0.1:11434") + "/api/embed",
            json={"model": embedding_model(), "input": inputs, "truncate": False},
            timeout=120,
        )
        response.raise_for_status()
        vectors = response.json().get("embeddings")
        if not isinstance(vectors, list) or len(vectors) != len(texts):
            raise httpx.HTTPError("Ollama returned an incomplete embedding batch.")
        dimension = len(vectors[0]) if vectors and isinstance(vectors[0], list) else 0
        if not dimension or any(
            not isinstance(v, list)
            or len(v) != dimension
            or any(type(n) not in (int, float) or not math.isfinite(n) for n in v)
            for v in vectors
        ):
            raise httpx.HTTPError("Ollama returned invalid embedding vectors.")
        return vectors
    vectors = []
    for text in texts:
        vector = [0.0] * 512
        for token, count in Counter(tokens(text)).items():
            position = int(hashlib.sha256(token.encode()).hexdigest()[:8], 16) % 512
            vector[position] += 1 + math.log(count)
        norm = math.sqrt(sum(x * x for x in vector)) or 1
        vectors.append([x / norm for x in vector])
    return vectors


def extract(content):
    if not content.startswith(b"%PDF-"):
        raise ValueError("This file is not a valid PDF. Choose a PDF document.")
    try:
        reader = PdfReader(io.BytesIO(content))
        if reader.is_encrypted:
            raise ValueError(
                "Password-protected PDFs are not supported. Upload an unlocked copy."
            )
        if len(reader.pages) > 100:
            raise ValueError("Please upload a document with 100 pages or fewer.")
        pages = [
            (i + 1, (page.extract_text() or "").strip())
            for i, page in enumerate(reader.pages)
        ]
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError("The PDF could not be read. It may be damaged.") from exc
    if not any(len(text) >= 20 for _, text in pages):
        raise ValueError(
            "No readable text found. Scanned PDFs need OCR; upload a searchable PDF. See README for OCR setup."
        )

    if any(len(text) < 20 for _, text in pages):
        raise ValueError(
            "One or more pages have no readable text. Run OCR on the entire PDF before uploading."
        )
    return pages


def chunk_pages(pages, limit=1200, overlap=180):
    chunks = []
    for page, text in pages:
        start = 0
        while start < len(text):
            end = min(start + limit, len(text))
            if end < len(text):
                boundary = text.rfind(" ", start + limit // 2, end)
                if boundary > start:
                    end = boundary
            chunks.append({"page": page, "text": text[start:end]})
            if end == len(text):
                break
            start = end - overlap
    return chunks


def fields_from_pages(pages):
    text = "\n".join(text for _, text in pages)
    patterns = {
        "vendor": r"^Vendor\s*:\s*(.+)$",
        "invoice": r"^Invoice\s*(?:number|no\.?|#)\s*:\s*(.+)$",
        "date": r"^Invoice date\s*:\s*(\d{4}-\d{2}-\d{2})\b",
        "due": r"^Due date\s*:\s*(\d{4}-\d{2}-\d{2})\b",
        "status": r"^Payment status\s*:\s*(Paid|Unpaid|Partially paid)\s*$",
        "total": r"^Total\s*:\s*([A-Z]{3})\s+([\d,]+\.\d{2})\s*$",
    }
    result = {}
    for key, pattern in patterns.items():
        match = re.search(pattern, text, re.M | re.I)
        if match:
            if key == "total":
                try:
                    result.update(
                        currency=match[1].upper(),
                        total=str(Decimal(match[2].replace(",", ""))),
                    )
                except InvalidOperation:
                    pass
            else:
                result[key] = match[1].strip()
    for key in ("date", "due"):
        if result.get(key):
            try:
                datetime.strptime(result[key], "%Y-%m-%d")
            except ValueError:
                del result[key]
    invoice_ids = {
        m.strip() for m in re.findall(patterns["invoice"], text, re.M | re.I)
    }
    if len(invoice_ids) > 1:
        result.pop("total", None)
        result["warning"] = "Multiple invoice numbers detected; exact totals disabled."
    return result


def retrieve(question, rows, limit=6):
    if not rows:
        return []
    model = embedding_model()
    compatible = [r for r in rows if r["model"] == model]

    query = embed(["QUERY:" + question])[0] if compatible else []
    query_terms = set(tokens(question))
    ranked = []
    for row in rows:
        overlap = len(query_terms & set(tokens(row["text"]))) / max(len(query_terms), 1)
        semantic = 0
        if row["model"] == model and query:
            vector = json.loads(row["vector"])
            semantic = sum(a * b for a, b in zip(vector, query)) / (
                math.sqrt(sum(v * v for v in vector))
                * math.sqrt(sum(v * v for v in query))
                or 1
            )
        score = 0.55 * semantic + 0.45 * overlap
        if overlap > 0 or (model != "local-hash-v1" and semantic > 0.3):
            ranked.append(dict(row) | {"score": round(score, 3)})
    return sorted(ranked, key=lambda r: r["score"], reverse=True)[:limit]
