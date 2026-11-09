import React, { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ArrowUpRight,
  ArrowRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  CircleHelp,
  Copy,
  Download,
  FileText,
  FolderOpen,
  History,
  LayoutDashboard,
  Loader2,
  MessageSquare,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import "./styles.css";

import {
  api,
  downloadFile,
  getAccessToken,
  saveAccessToken,
  type Doc,
  type Source,
  type Answer,
  type Health,
  type Activity,
} from "./client";
const today = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });
const money = (n: number, currency = "AED") =>
  new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(n);
const shortDate = (s: string) =>
  new Date(s).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const prompts = [
  {
    title: "Overdue invoices",
    text: "Which invoices are overdue?",
  },
  {
    title: "Invoice summary",
    text: "Summarize the invoices in my documents.",
  },
  {
    title: "Vendor totals",
    text: "What is the total invoiced by Atlas Office Supplies?",
  },
];

export default function App() {
  const [tab, setTab] = useState("Assistant");
  const [docs, setDocs] = useState<Doc[]>([]);
  const [history, setHistory] = useState<Answer[]>([]);
  const [health, setHealth] = useState<Health>();
  const [question, setQuestion] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState(false);
  const [asOf, setAsOf] = useState(today());
  const [activity, setActivity] = useState<Activity[]>([]);
  const [auth, setAuth] = useState(false);
  const [token, setToken] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<Doc | null>(null);
  const [help, setHelp] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const unlock = () => {
      setAuth(true);
      setToken("");
    };
    window.addEventListener("kema:unauthorized", unlock);
    return () => window.removeEventListener("kema:unauthorized", unlock);
  }, []);
  async function refresh() {
    try {
      const [d, h, a] = await Promise.all([
        api<Doc[]>("/documents"),
        api<Answer[]>("/history"),
        api<typeof activity>("/activity"),
      ]);
      setDocs(d);
      setHistory(h);
      setActivity(a);
    } catch (e) {
      setError(String((e as Error).message));
    }
  }
  useEffect(() => {
    api<Health>("/health")
      .then((h) => {
        setHealth(h);
        if (h.auth_required && !getAccessToken()) setAuth(true);
        else refresh();
      })
      .catch(() =>
        setError("The backend is offline. Start the server to connect."),
      );
  }, []);
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(""), 4000);
      return () => clearTimeout(t);
    }
  }, [notice]);
  useEffect(() => {
    function keys(e: KeyboardEvent) {
      const modal = document.querySelector<HTMLElement>('[role="dialog"]');
      if (!modal) return;
      if (e.key === "Escape" && !auth) {
        setSource(null);
        setConfirmDelete(null);
        setHelp(false);
      }
      if (e.key === "Tab") {
        const elements = Array.from(
          modal.querySelectorAll<HTMLElement>(
            'button:not([disabled]),input,textarea,[tabindex="0"]',
          ),
        );
        const first = elements[0],
          last = elements[elements.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener("keydown", keys);
    return () => document.removeEventListener("keydown", keys);
  }, [auth]);
  async function samples() {
    setBusy("Loading sample workspace");
    setError("");
    try {
      const r = await api<{ added: number }>("/samples", { method: "POST" });
      await refresh();
      setNotice(
        r.added
          ? `${r.added} sample documents added. Ready to explore.`
          : "Sample documents are already in your library.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function upload(files: FileList | File[] | null) {
    if (!files?.length) return;
    setError("");
    setBusy("Extracting and indexing documents");
    let count = 0;
    const failures: string[] = [];
    for (const f of Array.from(files)) {
      try {
        if (f.size > 10 * 1024 * 1024) throw Error("File exceeds 10 MB.");
        const data = new FormData();
        data.append("file", f);
        await api("/documents", { method: "POST", body: data });
        count++;
      } catch (e) {
        failures.push(`${f.name}: ${(e as Error).message}`);
      }
    }
    await refresh();
    setBusy("");
    if (failures.length) setError(failures.join(" "));
    if (count)
      setNotice(`${count} document${count > 1 ? "s" : ""} indexed and ready.`);
    if (fileInput.current) fileInput.current.value = "";
  }
  async function ask(text = question) {
    if (!text.trim() || busy) return;
    if (!docs.length) {
      setError(
        "Add your documents or load the sample workspace to get started.",
      );
      return;
    }
    setQuestion(text);
    setBusy("Reviewing your documents");
    setError("");
    try {
      const a = await api<Answer>("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: text,
          document_ids: selected,
          as_of: asOf,
        }),
      });
      setAnswer(a);
      setQuestion("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function remove() {
    if (!confirmDelete) return;
    try {
      await api("/documents/" + confirmDelete.id, { method: "DELETE" });
      setSelected((x) => x.filter((id) => id !== confirmDelete.id));
      setAnswer(null);
      setSource(null);
      setConfirmDelete(null);
      await refresh();
      setNotice("Document and retained conversation excerpts deleted.");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function download(path: string, name: string) {
    try {
      await downloadFile(path, name);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function inspect(d: Doc) {
    try {
      const pages = await api<{ page: number; text: string }[]>(
        "/documents/" + d.id + "/pages",
      );
      setSource({
        number: 1,
        document_id: d.id,
        name: d.name,
        page: pages[0].page,
        excerpt: pages
          .filter((p) => p.page === pages[0].page)
          .map((p) => p.text)
          .join("\n\n"),
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const filtered = docs.filter((d) =>
    (d.name + " " + (d.fields.vendor || ""))
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const nav = (name: string, Icon: typeof MessageSquare, badge?: string) => (
    <button
      className={"nav-item " + (tab === name ? "active" : "")}
      aria-label={name}
      onClick={() => {
        setTab(name);
        setSearch("");
      }}
    >
      <Icon size={19} />
      <span>{name}</span>
      {badge && <small>{badge}</small>}
    </button>
  );
  function renderText(text: string) {
    return text.split(/(\[\d+\])/g).map((s, i) => {
      const match = s.match(/^\[(\d+)\]$/);
      const citation =
        match && answer?.sources.find((x) => x.number === Number(match[1]));
      return citation ? (
        <button
          key={i}
          className="inline-cite"
          onClick={() => setSource(citation)}
        >
          {citation.number}
        </button>
      ) : (
        <React.Fragment key={i}>{s}</React.Fragment>
      );
    });
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/kema-logo.svg" alt="Kema" />
        </div>
        <nav aria-label="Workspace navigation">
          {nav("Assistant", MessageSquare)}
          {nav("Documents", FolderOpen, String(docs.length))}
          {nav("History", History)}
        </nav>
        <div className="sidebar-bottom">
          {nav("Activity", LayoutDashboard)}
          {nav("Settings", Settings2)}
          <button className="workspace-help" onClick={() => setHelp(true)}>
            <CircleHelp size={18} />
            <span>Help & information</span>
          </button>
          <span className="local-status">
            <i />
            {health?.mode === "ollama"
              ? "Local AI"
              : health
                ? "Evidence search"
                : "Connecting"}
          </span>
        </div>
      </aside>
      <div className="main-shell">
        <main>
          <div className="page-title">
            <div>
              <h1>
                {tab === "Assistant"
                  ? "Accounting assistant"
                  : tab === "Documents"
                    ? "Documents"
                    : tab === "History"
                      ? "Question history"
                      : tab === "Activity"
                        ? "Activity"
                        : "Workspace settings"}
              </h1>
              <p>
                {tab === "Assistant"
                  ? "Ask questions about your financial documents."
                  : tab === "Documents"
                    ? "One place for your invoices, statements, and financial records."
                    : tab === "History"
                      ? "Every question and its supporting evidence, saved in your workspace."
                      : tab === "Activity"
                        ? "Track document changes and questions across your workspace."
                        : "Local models, practical safeguards, and transparent limits."}
              </p>
            </div>
            <button
              className="primary-button"
              onClick={() => fileInput.current?.click()}
              disabled={!!busy}
            >
              <Plus size={17} /> Add documents
            </button>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            hidden
            onChange={(e) => upload(e.target.files)}
          />
          {error && (
            <div className="alert error" role="alert">
              {error}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {busy && (
            <div className="alert working" role="status">
              <Loader2 className="spin" size={17} />
              {busy}…{" "}
              {busy.includes("Reviewing") && (
                <small>Local models can take a moment.</small>
              )}
            </div>
          )}
          {tab === "Assistant" && (
            <>
              <div className="assistant-layout">
                <section className="assistant-panel">
                  <div className="assistant-toolbar">
                    <span>
                      {docs.length} document{docs.length !== 1 ? "s" : ""}{" "}
                      available
                    </span>
                    {answer && (
                      <button
                        className="text-button"
                        onClick={() => {
                          setAnswer(null);
                          setQuestion("");
                          textarea.current?.focus();
                        }}
                      >
                        <Plus size={16} />
                        New question
                      </button>
                    )}
                  </div>
                  <div
                    className={"conversation " + (answer ? "has-answer" : "")}
                  >
                    {!answer ? (
                      <>
                        <h2>What would you like to know?</h2>
                        <p>Find the details. Check the source. Move forward.</p>
                        <div className="prompt-grid">
                          {prompts.map((p) => (
                            <button
                              className="prompt-card"
                              key={p.title}
                              onClick={() => ask(p.text)}
                              disabled={!!busy}
                            >
                              {p.title}
                              <ArrowUpRight size={15} />
                            </button>
                          ))}
                        </div>
                        {!docs.length && (
                          <button
                            className="sample-link"
                            disabled={!!busy}
                            onClick={samples}
                          >
                            Just exploring? Try the sample workspace{" "}
                            <ArrowRight size={14} />
                          </button>
                        )}
                      </>
                    ) : (
                      <div className="answer-wrap">
                        <div className="user-question">
                          <span className="avatar small">YOU</span>
                          <h3>{answer.question}</h3>
                        </div>
                        <div className="answer-label">
                          <span className="blue-symbol">
                            <Sparkles size={16} />
                          </span>
                          <strong>Kema assistant</strong>
                          <span>
                            {answer.mode === "ollama"
                              ? "Local AI"
                              : answer.mode === "verified fields"
                                ? "Verified fields"
                                : "Evidence search"}
                          </span>
                        </div>
                        <div className="answer-text">
                          {renderText(answer.answer)}
                        </div>
                        {answer.sources.length > 0 && (
                          <div className="answer-sources">
                            <span>
                              <BookOpen size={14} /> SOURCES ·{" "}
                              {answer.sources.length}
                            </span>
                            {answer.sources.map((s) => (
                              <button
                                key={s.number}
                                onClick={() => setSource(s)}
                              >
                                <b>{s.number}</b>
                                <FileText size={13} />
                                <span>{s.name}</span>
                                <small>p. {s.page}</small>
                                <ArrowUpRight size={13} />
                              </button>
                            ))}
                          </div>
                        )}
                        <div className="answer-actions">
                          <span>
                            <CheckCheck size={14} />{" "}
                            {answer.sources.length
                              ? "Source references attached"
                              : "No matching evidence"}
                          </span>
                          <button
                            onClick={() =>
                              navigator.clipboard
                                .writeText(answer.answer)
                                .then(() => setNotice("Answer copied."))
                                .catch(() =>
                                  setError(
                                    "Clipboard unavailable. Select and copy the answer.",
                                  ),
                                )
                            }
                          >
                            <Copy size={14} /> Copy answer
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  <form
                    className="composer"
                    onSubmit={(e) => {
                      e.preventDefault();
                      ask();
                    }}
                  >
                    <textarea
                      ref={textarea}
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      placeholder="Ask a question about your documents…"
                      maxLength={2000}
                      aria-label="Question about your documents"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          ask();
                        }
                      }}
                    />
                    <div className="composer-bottom">
                      <div className="scope-wrap">
                        <button
                          type="button"
                          className="scope-button"
                          onClick={() => setScope(!scope)}
                        >
                          <FolderOpen size={14} />
                          {selected.length
                            ? `${selected.length} document${selected.length > 1 ? "s" : ""}`
                            : "All documents"}
                          <ChevronDown size={13} />
                        </button>
                        {scope && (
                          <div className="scope-popover">
                            <label className="asof-label">
                              Overdue reference date
                              <input
                                type="date"
                                value={asOf}
                                onChange={(e) => setAsOf(e.target.value)}
                                aria-label="Overdue reference date"
                              />
                            </label>
                            <strong>Answer using</strong>
                            <button
                              type="button"
                              onClick={() => setSelected([])}
                            >
                              <span
                                className={
                                  "checkbox " +
                                  (!selected.length ? "checked" : "")
                                }
                              >
                                {!selected.length && <Check size={11} />}
                              </span>
                              All documents
                            </button>
                            {docs.map((d) => (
                              <button
                                type="button"
                                key={d.id}
                                onClick={() =>
                                  setSelected((s) =>
                                    s.includes(d.id)
                                      ? s.filter((id) => id !== d.id)
                                      : [...s, d.id],
                                  )
                                }
                              >
                                <span
                                  className={
                                    "checkbox " +
                                    (selected.includes(d.id) ? "checked" : "")
                                  }
                                >
                                  {selected.includes(d.id) && (
                                    <Check size={11} />
                                  )}
                                </span>
                                {d.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="send-area">
                        <small>Enter to send</small>
                        <button
                          type="submit"
                          className="send-button"
                          aria-label="Send question"
                          disabled={!question.trim() || !!busy}
                        >
                          <ArrowUp size={18} />
                        </button>
                      </div>
                    </div>
                  </form>
                  <div className="assistant-footnote">
                    <ShieldCheck size={12} /> Review the cited sources before
                    making financial decisions.
                  </div>
                </section>
              </div>
            </>
          )}
          {tab === "Documents" && (
            <>
              <div className="library-tools">
                <div className="search">
                  <Search size={17} />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search documents or vendors"
                    aria-label="Search documents"
                  />
                </div>
                <div>
                  <button
                    className="secondary-button"
                    disabled={!!busy}
                    onClick={samples}
                  >
                    <Plus size={15} /> Load samples
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => download("/export", "kema-documents.csv")}
                  >
                    <Download size={15} /> Export CSV
                  </button>
                </div>
              </div>
              <div
                className="upload-zone"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!busy) upload(e.dataTransfer.files);
                }}
              >
                <Upload size={24} />
                <div>
                  <strong>Drop your financial documents here</strong>
                  <span>
                    Searchable PDFs · Up to 10 MB each · 100 pages maximum
                  </span>
                </div>
                <button
                  className="secondary-button"
                  disabled={!!busy}
                  onClick={() => fileInput.current?.click()}
                >
                  Browse files
                </button>
              </div>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Document</th>
                      <th>Vendor</th>
                      <th>Invoice total</th>
                      <th>Payment status</th>
                      <th>Added</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((d) => (
                      <tr key={d.id}>
                        <td>
                          <button
                            className="document-name"
                            onClick={() => inspect(d)}
                          >
                            <span className="file-tile">
                              <FileText size={19} />
                            </span>
                            <span>
                              <strong>{d.name}</strong>
                              <small>
                                {d.pages} page{d.pages > 1 ? "s" : ""} ·{" "}
                                {(d.size / 1024).toFixed(0)} KB{" "}
                                {d.sample ? "· Sample" : ""}
                              </small>
                            </span>
                          </button>
                        </td>
                        <td>{d.fields.vendor || "Not extracted"}</td>
                        <td className="amount">
                          {d.fields.total
                            ? money(Number(d.fields.total), d.fields.currency)
                            : "—"}
                        </td>
                        <td>
                          <span
                            className={
                              "status-pill " +
                              (d.fields.status?.toLowerCase() === "paid"
                                ? "paid"
                                : d.fields.status?.toLowerCase() === "unpaid" &&
                                    d.fields.due < asOf
                                  ? "overdue"
                                  : "")
                            }
                          >
                            {d.fields.status?.toLowerCase() === "unpaid" &&
                            d.fields.due < asOf
                              ? "Overdue"
                              : d.fields.status || "Not stated"}
                          </span>
                        </td>
                        <td>{shortDate(d.created)}</td>
                        <td>
                          <button
                            className="icon-button"
                            aria-label={"Delete " + d.name}
                            onClick={() => setConfirmDelete(d)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!filtered.length && (
                  <div className="empty-state">
                    <FolderOpen size={32} />
                    <h3>
                      {search
                        ? "No matching documents"
                        : "Your library is ready for its first document"}
                    </h3>
                    <p>
                      {search
                        ? "Try another document name or vendor."
                        : "Upload your own PDFs, or load our fictional sample invoices."}
                    </p>
                    {!search && (
                      <button
                        className="primary-button"
                        onClick={samples}
                        disabled={!!busy}
                      >
                        Explore sample workspace <ArrowRight size={16} />
                      </button>
                    )}
                  </div>
                )}
                <div className="table-footer">
                  <span>
                    {filtered.length} document{filtered.length !== 1 ? "s" : ""}
                  </span>
                  <span>
                    <ShieldCheck size={13} /> Stored on this machine
                  </span>
                </div>
              </div>
              <p className="subtle-note">
                Invoice fields are extracted from explicit labels. An empty
                field means it could not be reliably recognized. Review the
                original before relying on totals.
              </p>
            </>
          )}
          {tab === "History" && (
            <section className="list-panel">
              <div className="panel-heading">
                <strong>
                  Recent questions <span className="tag">{history.length}</span>
                </strong>
                <button
                  className="text-button"
                  onClick={async () => {
                    if (
                      window.confirm("Clear all saved questions and answers?")
                    ) {
                      try {
                        await api("/history", { method: "DELETE" });
                        setAnswer(null);
                        await refresh();
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }
                  }}
                >
                  <Trash2 size={14} /> Clear history
                </button>
              </div>
              {history.map((h) => (
                <button
                  className="history-row"
                  key={h.id}
                  onClick={() => {
                    setAnswer(h);
                    setTab("Assistant");
                  }}
                >
                  <MessageSquare size={20} />
                  <span>
                    <strong>{h.question}</strong>
                    <small>
                      {shortDate(h.created)} · {h.sources.length} sources ·{" "}
                      {h.mode}
                    </small>
                  </span>
                  <ArrowUpRight size={17} />
                </button>
              ))}
              {!history.length && (
                <div className="empty-state">
                  <History size={32} />
                  <h3>A fresh start</h3>
                  <p>
                    Ask your first question to begin building a useful record.
                  </p>
                  <button
                    className="primary-button"
                    onClick={() => setTab("Assistant")}
                  >
                    Ask a question <ArrowRight size={15} />
                  </button>
                </div>
              )}
            </section>
          )}
          {tab === "Activity" && (
            <section className="list-panel">
              <div className="panel-heading">
                <strong>Workspace activity</strong>
                <span className="tag">LATEST 50 EVENTS</span>
              </div>
              {activity.map((a) => (
                <div className="activity-row" key={a.id}>
                  <span className="activity-dot" />
                  <span>
                    <strong>
                      {a.action.replaceAll(".", " ").replaceAll("_", " ")}
                    </strong>
                    <small>{a.detail}</small>
                  </span>
                  <time>{new Date(a.created).toLocaleString("en-GB")}</time>
                </div>
              ))}
              {!activity.length && (
                <div className="empty-state">
                  <ShieldCheck size={30} />
                  <h3>A clear audit trail</h3>
                  <p>
                    Document changes and answered questions will appear here.
                  </p>
                </div>
              )}
            </section>
          )}
          {tab === "Settings" && (
            <div className="settings-grid">
              <section className="settings-card">
                <h2>Local intelligence</h2>
                <p>
                  Your models run through Ollama on your machine. No API
                  subscription, usage charges, or cloud account.
                </p>
                <dl>
                  <dt>Answer model</dt>
                  <dd>{health?.chat_model || "llama3:latest"}</dd>
                  <dt>Embedding model</dt>
                  <dd>
                    {health?.embedding_model || "nomic-embed-text:latest"}
                  </dd>
                  <dt>Mode</dt>
                  <dd>{health?.mode || "Connecting"}</dd>
                </dl>
                <div className="settings-note">
                  Configure models in the server’s .env file and restart.
                  Changing the embedding model requires re-uploading documents
                  for semantic search.
                </div>
              </section>
              <section className="settings-card">
                <h2>Practical safeguards</h2>
                <ul className="security-list">
                  {[
                    "PDF validation and bounded uploads",
                    "Optional Bearer-token workspace access",
                    "Rate-limited write requests",
                    "Document instructions treated as untrusted",
                    "Page-level references and audit events",
                    "CSV formula injection protection",
                  ].map((s) => (
                    <li key={s}>
                      <Check size={16} />
                      {s}
                    </li>
                  ))}
                </ul>
                <p className="settings-note">
                  This is a single-workspace application. For internet
                  deployment, enable a token, HTTPS, encrypted storage, and
                  infrastructure-level request limits. Model citations are
                  checked for valid references, not factual entailment.
                </p>
              </section>
              <section className="settings-card">
                <h2>Workspace access</h2>
                <p>
                  {health?.auth_required
                    ? "Token access is enabled on the server."
                    : "Local development access is enabled. Set APP_ACCESS_TOKEN on the server to require a shared workspace token."}
                </p>
                <label className="field-label">
                  Session token
                  <input
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="Enter workspace access token"
                    autoComplete="off"
                  />
                </label>
                <button
                  className="secondary-button"
                  onClick={() => {
                    saveAccessToken(token);

                    refresh();
                    setNotice("Session token updated.");
                  }}
                >
                  Update session token
                </button>
              </section>
              <section className="settings-card">
                <h2>Know the boundaries</h2>
                <p>
                  Searchable PDFs are supported. Scanned pages need OCR before
                  upload. Exact totals use recognized invoice labels and keep
                  currencies separate.
                </p>
                <p>
                  Payment status comes from the document. The assistant cannot
                  see your bank or accounting ledger. AI answers can still be
                  wrong: review the cited evidence.
                </p>
                <button
                  className="secondary-button"
                  onClick={() => setHelp(true)}
                >
                  Read quick guide <ArrowUpRight size={14} />
                </button>
              </section>
            </div>
          )}
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <CheckCheck size={18} />
          {notice}
        </div>
      )}
      {source && (
        <div className="overlay" onClick={() => setSource(null)}>
          <aside
            className="source-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="source-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="drawer-heading">
              <span>
                <BookOpen size={18} /> SOURCE EVIDENCE
              </span>
              <button
                className="icon-button"
                aria-label="Close source"
                onClick={() => setSource(null)}
                autoFocus
              >
                <X size={20} />
              </button>
            </div>
            <span className="pdf-icon large">
              <FileText size={26} />
              <small>PDF</small>
            </span>
            <h2 id="source-title">{source.name}</h2>
            <p className="source-meta">
              Page {source.page} · Extracted document text
            </p>
            <div className="evidence-label">
              <span className="citation-number">{source.number}</span>Supporting
              excerpt
            </div>
            <blockquote>{source.excerpt}</blockquote>
            <p className="subtle-note">
              This is the text used as evidence. Check the original PDF for
              layout, tables, and surrounding context.
            </p>
            <button
              className="primary-button"
              onClick={() =>
                download(
                  "/documents/" + source.document_id + "/file",
                  source.name,
                )
              }
            >
              <Download size={16} /> Download original PDF
            </button>
            <button
              className="secondary-button"
              onClick={() => {
                setSelected([source.document_id]);
                setSource(null);
                setTab("Assistant");
                textarea.current?.focus();
              }}
            >
              Ask about this document <ArrowRight size={15} />
            </button>
          </aside>
        </div>
      )}
      {confirmDelete && (
        <div className="modal-overlay">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-title"
          >
            <Trash2 size={26} />
            <h2 id="delete-title">Delete this document?</h2>
            <p>
              {confirmDelete.name} will be removed with its search index. Saved
              question history is cleared to remove retained source excerpts.
            </p>
            <div className="modal-actions">
              <button
                className="secondary-button"
                onClick={() => setConfirmDelete(null)}
                autoFocus
              >
                Cancel
              </button>
              <button className="danger-button" onClick={remove}>
                Delete document
              </button>
            </div>
          </div>
        </div>
      )}
      {(help || auth) && (
        <div className="modal-overlay">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
          >
            <img className="modal-logo" src="/kema-logo.svg" alt="Kema" />
            <h2 id="help-title">
              {auth ? "Unlock your workspace" : "Your documents, made useful."}
            </h2>
            {auth ? (
              <>
                <p>
                  This workspace requires an access token configured by its
                  owner.
                </p>
                <input
                  className="token-input"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Workspace access token"
                  autoFocus
                />
                {error && (
                  <p className="auth-error" role="alert">
                    {error}
                  </p>
                )}
                <button
                  className="primary-button"
                  onClick={async () => {
                    try {
                      await api("/documents", {
                        headers: { Authorization: "Bearer " + token },
                      });
                      saveAccessToken(token);
                      setAuth(false);
                      setError("");
                      refresh();
                    } catch {
                      setError("That access token was not accepted.");
                    }
                  }}
                >
                  Unlock workspace <ArrowRight size={15} />
                </button>
              </>
            ) : (
              <>
                <p>
                  1. Add searchable PDF invoices or load the sample workspace.
                  <br />
                  <br />
                  2. Ask a specific question. Use the document selector to
                  narrow your search.
                  <br />
                  <br />
                  3. Open numbered sources to check the evidence.
                </p>
                <p>
                  All sample companies and invoices are fictional. This
                  application is an independent take-home project inspired by
                  Kema’s brand.
                </p>
                <button
                  className="primary-button"
                  onClick={() => setHelp(false)}
                  autoFocus
                >
                  Got it <Check size={15} />
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
