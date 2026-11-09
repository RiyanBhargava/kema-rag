# Kema Accounting Assistant

A simple, local accounting assistant for PDFs. Uses Ollama, FastAPI, SQLite and React. No paid APIs or API keys are needed.

## Install and run

Install Python 3.12+, Node.js 22+, and [Ollama](https://ollama.com/download). Open Ollama and keep it running. Download the two free local models:

```powershell
ollama pull llama3
ollama pull nomic-embed-text
```

From this project folder on Windows, run:

```powershell
.\start.ps1
```

This installs dependencies, builds the website and starts it at **http://127.0.0.1:8000**. Press Ctrl+C to stop.

For manual setup, create a Python virtual environment, install `requirements.txt`, run `npm ci` and `npm run build` inside `frontend`, then run `python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000` from the project root using that environment.

## Use

1. Open **Documents** and upload searchable PDFs, or choose **Load samples** for five fictional documents.
2. Open **Assistant** and ask about an invoice, expenses, vendor totals or overdue payments.
3. Use **All documents** below the question box to select files and change the overdue reference date.
4. Click numbered sources to read the supporting page, download the original or ask about that document.

For the samples, use reference date **2026-11-07**. Try ?Which invoices are overdue?? or ?What is the total invoiced by Atlas Office Supplies?? Select one invoice for its number, date, vendor and total. Select the expense statement for an expense summary.

## Features

- **Documents:** multiple uploads, drag and drop, filename/vendor search, extracted invoice fields, original downloads, deletion and CSV export.
- **Assistant:** natural-language questions, document selection, invoice details, expense summaries, vendor totals and overdue checks with a chosen date.
- **Sources:** document names, original page numbers, supporting excerpts, clickable citations and refusal when evidence is missing.
- **Reliable amounts:** exact decimal invoice totals, separate currencies and overdue checks based on explicit unpaid status. Ambiguous invoice requests ask for a selection.
- **History:** saved questions and answers, reopen conversations, copy answers and clear history.
- **Activity:** a log of uploads, deletions and answered questions.
- **Local storage:** documents, search vectors and history survive restarts; duplicate uploads are blocked and failed indexing does not save partial records.
- **Interface:** minimal Kema styling, locally hosted Google Sans, responsive layout, keyboard focus controls, loading/error messages, help and settings.
- **Local AI:** Ollama answers and embeddings; model information is shown in Settings. Offline evidence search is also available.

## Security

- Optional workspace token, kept only for the browser session; server configuration stays outside the frontend.
- PDF validation; limits of 10 MB/file, 100 pages/file and 200 documents. Invalid, encrypted and unreadable files show clear errors.
- Rate limits, hostname/origin checks, browser security headers and restricted camera/microphone/location permissions.
- Safe database queries, generated storage filenames, text-only answer rendering and protected CSV exports.
- Document instructions are treated as untrusted; generated source numbers are checked. Review the evidence because AI answers can still be wrong.
- Saved-source cleanup on document deletion, database transactions, request IDs and a health endpoint at `/api/health`. Deleting a document also clears saved question history; activity entries retain filenames.

## Optional settings

Create a `.env` file in the project root only if needed. Never commit it.

| Setting | Purpose |
| --- | --- |
| `APP_ACCESS_TOKEN` | Set a long random value to require a workspace token |
| `CHAT_MODEL`, `EMBEDDING_MODEL` | Choose installed local models; defaults are `llama3:latest` and `nomic-embed-text:latest` |
| `OLLAMA_URL` | Local endpoint; defaults to `http://127.0.0.1:11434` |
| `AI_MODE=local` | Evidence search without Ollama or generated answers |
| `DATA_DIR` | Storage folder; defaults to `data` |
| `ALLOWED_HOSTS` | Allowed hostnames; defaults to `127.0.0.1,localhost` |

Restart after changing settings. Re-upload documents after changing the embedding model. Use local models rather than Ollama cloud models.

Scanned PDFs need OCR before upload; built-in OCR and image uploads are not included. Exact table fields require recognizable labels; other layouts remain searchable. This is a single-workspace app. Public multi-user deployment needs individual login, HTTPS and encrypted storage.

The Kema logo is used for this independent take-home project. Google Sans licensing is included in `frontend/public/OFL.txt`.
