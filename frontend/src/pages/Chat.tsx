import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  Plus, Send, Square, Trash2, MessageSquare, Pencil, RefreshCw, Bot, Wrench, Brain, ChevronDown,
  Paperclip, FileText, X, Search,
} from "lucide-react";
import { api, fmtTime } from "../api";
import type { ChatAttachment, ChatMessage, Conversation, ModelsPayload } from "../types";
import { Markdown } from "../Markdown";
import { Badge, Button, Empty, Input, Spinner, useToast } from "../ui";

// Collapsible live-thoughts block: expanded (with a pulsing cursor) while provider
// thinking tokens stream in, auto-collapsed once the answer text starts arriving.
function ThoughtBlock({ text, open, live, onToggle }: { text: string; open: boolean; live?: boolean; onToggle: () => void }) {
  return (
    <div className="mb-1.5 overflow-hidden rounded-lg border border-line bg-surface/60">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-xxs text-muted transition-colors hover:text-text"
      >
        <Brain size={11} className={live ? "text-accent" : ""} />
        <span>{live ? "Thinking…" : "Thought process"}</span>
        <ChevronDown size={11} className={`ml-auto transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && (
        <div className="max-h-48 overflow-y-auto border-t border-line px-2.5 py-1.5">
          <p className="whitespace-pre-wrap text-xxs leading-relaxed text-muted">
            {text}
            {live && <span className="ml-0.5 inline-block h-2.5 w-1 animate-pulse rounded-sm bg-accent align-middle" aria-hidden />}
          </p>
        </div>
      )}
    </div>
  );
}

// Attachment chip: image thumbnail or file icon + name + size. Read-only when
// no onRemove (message history); removable in the composer (staged chips).
export function AttChip({ att, onRemove }: { att: ChatAttachment; onRemove?: () => void }) {
  const [imgOk, setImgOk] = useState(true);
  return (
    <span className="group inline-flex max-w-[220px] items-center gap-1.5 rounded-lg border border-line bg-bg px-1.5 py-1 text-xxs">
      {att.is_image && imgOk ? (
        <img
          src={`/api/chat/attachments/${att.id}/raw`}
          alt={att.name}
          className="h-7 w-7 shrink-0 rounded object-cover"
          onError={() => setImgOk(false)}
        />
      ) : (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-surface text-muted">
          <FileText size={13} />
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate leading-tight">{att.name}</span>
        <span className="block leading-tight text-muted">
          {att.size >= 1024 ? `${(att.size / 1024).toFixed(1)} KB` : `${att.size} B`}
          {att.uploading ? " · uploading…" : ""}
        </span>
      </span>
      {onRemove && (
        <button
          aria-label={`Remove ${att.name}`}
          className="ml-0.5 shrink-0 rounded p-0.5 text-muted hover:text-text"
          onClick={onRemove}
        >
          <X size={12} />
        </button>
      )}
    </span>
  );
}

/** Parse the JSON attachments column of a message row (tolerant of bad data). */
export function parseAtts(m: ChatMessage): ChatAttachment[] {
  if (!m.attachments) return [];
  if (Array.isArray(m.attachments)) return m.attachments as ChatAttachment[];
  try {
    const v = JSON.parse(m.attachments);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export default function Chat({ defaultModel }: { defaultModel: string }) {
  const { convId } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const toast = useToast();

  const [convs, setConvs] = useState<Conversation[]>([]);
  const [search, setSearch] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState(defaultModel);
  const [reasoning, setReasoning] = useState("minimal");
  const [liveTool, setLiveTool] = useState<Record<number, string | null>>({});
  // Live provider thinking tokens (streamed `reasoning` SSE events); keyed by message id.
  // Collapses automatically when the first answer text delta arrives.
  const [liveReasoning, setLiveReasoning] = useState<Record<number, string>>({});
  const [thoughtOpen, setThoughtOpen] = useState<Record<number, boolean>>({});
  const [endpointModels, setEndpointModels] = useState<string[]>([]);
  const [aliasModels, setAliasModels] = useState<{ name: string; model: string }[]>([]);
  const [fallbackModels, setFallbackModels] = useState<string[]>([]);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  // Staged chat attachments (uploaded immediately on pick; sent as ids with the message)
  const [staged, setStaged] = useState<ChatAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamAbort = useRef<AbortController | null>(null);

  // Prefill composer when arriving from Skills ("Run via chat")
  useEffect(() => {
    const draft = (loc.state as { draft?: string } | null)?.draft;
    if (draft) {
      setInput(draft);
      nav(loc.pathname, { replace: true, state: null });
    }
  }, [loc, nav]);

  const loadConvs = useCallback(async (q = "") => {
    try {
      setConvs(await api.get<Conversation[]>(`/api/chat/conversations?search=${encodeURIComponent(q)}`));
      setConnected(true);
    } catch {
      setConnected(false);
    }
  }, []);

  const loadMessages = useCallback(async (id: string, quiet = false) => {
    if (!quiet) setLoadingMsgs(true);
    try {
      const msgs = await api.get<ChatMessage[]>(`/api/chat/conversations/${id}/messages`);
      setMessages(msgs);
      setConnected(true);
      return msgs;
    } catch {
      setConnected(false);
      return [];
    } finally {
      if (!quiet) setLoadingMsgs(false);
    }
  }, []);

  useEffect(() => {
    loadConvs(search);
  }, [loadConvs, search]);

  // Load models for the selector: live ACTIVE endpoint list + custom aliases;
  // falls back to the Hermes provider cache only when the live list is empty.
  useEffect(() => {
    api
      .get<ModelsPayload>("/api/models")
      .then((d) => {
        const live = d.active?.models ?? [];
        setEndpointModels(live);
        const aliases = d.custom_models.map((c) => ({ name: c.name, model: c.model }));
        setAliasModels(aliases);
        const cached = d.providers.flatMap((p) => p.models).sort();
        setFallbackModels(live.length ? [] : cached);
        // Only pre-select the default if it is actually a selectable option (a route-name
        // default may not appear in the endpoint's public list). Otherwise keep "" (= default).
        if (!defaultModel && d.config.default_model) {
          const selectable = new Set([...live, ...aliases.map((a) => a.name), ...(live.length ? [] : cached)]);
          setModel(selectable.has(d.config.default_model) ? d.config.default_model : "");
        }
      })
      .catch(() => {});
  }, [defaultModel]);

  // Load conversation messages
  useEffect(() => {
    if (convId) loadMessages(convId);
    else setMessages([]);
  }, [convId, loadMessages]);

  // Poll while something is pending/running — except while THIS client owns the
  // stream (the SSE feed is the source of truth and the DB row is still empty).
  useEffect(() => {
    const busy = messages.some((m) => m.status === "pending" || m.status === "running");
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (busy && convId && streamAbort.current === null) {
      pollRef.current = setInterval(() => loadMessages(convId, true), 1500);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [messages, convId, loadMessages]);

  // Autoscroll on new content
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const createConv = async () => {
    try {
      const c = await api.post<{ id: string }>("/api/chat/conversations", {});
      await loadConvs(search);
      nav(`/chat/${c.id}`);
    } catch (e) {
      toast.push("error", e instanceof Error ? e.message : "Failed to create conversation");
    }
  };

  const uploadFiles = async (files: FileList | File[]) => {
    const incoming = Array.from(files);
    if (!incoming.length || !convId) return;
    const room = 5 - staged.filter((s) => !s.uploading).length;
    if (room <= 0) {
      toast.push("error", "Max 5 attachments per message");
      return;
    }
    const accepted = incoming.slice(0, room);
    if (incoming.length > room) toast.push("error", "Max 5 attachments per message — extra files skipped");
    const placeholders: ChatAttachment[] = accepted.map((f, i) => ({
      id: `pending_${Date.now()}_${i}`, name: f.name, size: f.size,
      is_image: /\.(png|jpe?g|gif|webp|bmp)$/i.test(f.name), uploading: true,
    }));
    setStaged((s) => [...s, ...placeholders]);
    for (let i = 0; i < accepted.length; i++) {
      const f = accepted[i];
      const ph = placeholders[i];
      const fd = new FormData();
      fd.append("files", f);
      try {
        const res = await fetch("/api/chat/attachments", { method: "POST", credentials: "same-origin", body: fd });
        const data = await res.json().catch(() => null);
        if (!res.ok || !Array.isArray(data) || !data[0]) {
          throw new Error(data?.detail ?? `HTTP ${res.status}`);
        }
        setStaged((s) => s.map((a) => (a.id === ph.id ? { ...data[0], uploading: false } : a)));
      } catch (e) {
        setStaged((s) => s.filter((a) => a.id !== ph.id));
        toast.push("error", e instanceof Error ? e.message : "Upload failed");
      }
    }
  };

  const removeStaged = async (id: string) => {
    setStaged((s) => s.filter((a) => a.id !== id));
    if (!id.startsWith("pending_")) {
      try { await api.del(`/api/chat/attachments/${id}`); } catch { /* already gone is fine */ }
    }
  };

  const send = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    const ready = staged.filter((s) => !s.uploading);
    if ((!text && ready.length === 0) || !convId || staged.some((s) => s.uploading)) return;
    setInput("");
    const attsMeta = ready.map(({ id, name, size, is_image }) => ({ id, name, size, is_image }));
    setStaged([]);
    const now = Date.now() / 1000;
    const userRow = { id: -Date.now(), conversation_id: convId, role: "user" as const, content: text, status: "done" as const, error: null, model, hermes_session_id: null, created_at: now, finished_at: now, attachments: attsMeta.length ? JSON.stringify(attsMeta) : null };
    const asstRow = { id: userRow.id + 1, conversation_id: convId, role: "assistant" as const, content: "", status: "running" as const, error: null, model, hermes_session_id: null, created_at: now, finished_at: null };
    setMessages((ms) => [...ms, userRow as ChatMessage, asstRow as ChatMessage]);
    let targetId = asstRow.id;
    const ac = new AbortController();
    streamAbort.current = ac;
    try {
      const res = await fetch(`/api/chat/conversations/${convId}/messages`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text, model, reasoning, attachments: attsMeta.map((a) => a.id) }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.detail ?? `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          let event = "";
          const dataLines: string[] = [];
          for (const ln of frame.split("\n")) {
            if (ln.startsWith("event:")) event = ln.slice(6).trim();
            else if (ln.startsWith("data:")) dataLines.push(ln.slice(5).trim());
          }
          if (!event || dataLines.length === 0) continue;
          let data: any;
          try { data = JSON.parse(dataLines.join("\n")); } catch { continue; }
          if (event === "init" && data.message_id) {
            targetId = data.message_id;
            setMessages((ms) => ms.map((m) => (m.id === asstRow.id ? { ...m, id: data.message_id } : m)));
          } else if (event === "reasoning") {
            if (data.t) setLiveReasoning((lr) => ({ ...lr, [targetId]: (lr[targetId] ?? "") + data.t }));
          } else if (event === "delta") {
            setMessages((ms) => ms.map((m) => (m.id === targetId ? { ...m, content: m.content + (data.t || "") } : m)));
            if (data.t) setThoughtOpen((to) => ({ ...to, [targetId]: false }));
          } else if (event === "tool") {
            setLiveTool((lt) => ({ ...lt, [targetId]: data.state === "started" ? data.name : null }));
          } else if (event === "done") {
            setMessages((ms) => ms.map((m) => (m.id === targetId ? { ...m, status: "done", content: data.text || m.content, finished_at: Date.now() / 1000 } : m)));
            setLiveTool((lt) => ({ ...lt, [targetId]: null }));
          } else if (event === "stopped") {
            setMessages((ms) => ms.map((m) => (m.id === targetId ? { ...m, status: "stopped", content: data.content ?? m.content, finished_at: Date.now() / 1000 } : m)));
          } else if (event === "error") {
            setMessages((ms) => ms.map((m) => (m.id === targetId ? { ...m, status: "error", error: data.detail || "Generation failed", finished_at: Date.now() / 1000 } : m)));
          }
        }
      }
      // Reconcile with the DB (session id, model, final content)
      setTimeout(() => convId && loadMessages(convId, true), 300);
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === "AbortError";
      if (aborted) {
        setMessages((ms) => ms.map((m) => (m.id === targetId ? { ...m, status: "stopped", finished_at: Date.now() / 1000 } : m)));
        setTimeout(() => convId && loadMessages(convId, true), 1500);
      } else {
        setMessages((ms) => ms.map((m) => (m.id === targetId ? { ...m, status: "error", error: e instanceof Error ? e.message : "Failed to send", finished_at: Date.now() / 1000 } : m)));
        toast.push("error", e instanceof Error ? e.message : "Failed to send");
        setInput(text);
      }
    } finally {
      streamAbort.current = null;
    }
  };

  const stop = async (msgId: number) => {
    try {
      await api.post(`/api/chat/messages/${msgId}/stop`);
    } catch {
      toast.push("error", "Failed to stop");
    }
    streamAbort.current?.abort();
  };

  const retry = (m: ChatMessage) => {
    if (!convId) return;
    const idx = messages.findIndex((x) => x.id === m.id);
    const userMsg = [...messages.slice(0, idx)].reverse().find((x) => x.role === "user");
    if (!userMsg) return;
    send(userMsg.content);
  };

  const removeConv = async (id: string) => {
    if (!window.confirm("Delete this conversation? This cannot be undone.")) return;
    try {
      await api.del(`/api/chat/conversations/${id}`);
      await loadConvs(search);
      if (convId === id) nav("/chat");
      toast.push("success", "Conversation deleted");
    } catch (e) {
      toast.push("error", e instanceof Error ? e.message : "Delete failed");
    }
  };

  const busy = messages.some((m) => m.status === "pending" || m.status === "running");

  return (
    <div className="flex h-full min-h-0">
      {/* conversation list */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-line bg-surface/40 md:flex">
        <div className="flex items-center justify-between pb-1.5 pl-3.5 pr-2 pt-3">
          <span className="text-xxs font-semibold uppercase tracking-wider text-muted">Conversations</span>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={createConv} aria-label="New conversation" title="New conversation">
            <Plus size={14} />
          </Button>
        </div>
        <div className="px-2.5 pb-2">
          <div className="relative">
            <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <Input
              placeholder="Search conversations…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 pl-7 text-xs"
              aria-label="Search conversations"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {convs.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-muted">No conversations yet.<br />Start one with the + button.</p>
          )}
          {convs.map((c) => {
            const active = c.id === convId;
            return (
              <div
                key={c.id}
                className={`group relative mb-0.5 flex items-center rounded-lg transition-colors ${
                  active ? "bg-accent/12" : "hover:bg-bg"
                }`}
              >
                {active && (
                  <span aria-hidden className="absolute -left-0.5 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent" />
                )}
                <button
                  className="min-w-0 flex-1 py-[7px] pl-3.5 pr-1.5 text-left"
                  onClick={() => nav(`/chat/${c.id}`)}
                  title={c.title}
                >
                  <span className={`block truncate text-[13px] leading-tight ${active ? "font-medium" : "text-text/90"}`}>
                    {c.title}
                  </span>
                </button>
                <span className="shrink-0 pr-2.5 text-xxs text-muted group-hover:hidden">
                  {fmtTime(c.updated_at)}
                </span>
                <span className="hidden shrink-0 items-center gap-0.5 pr-1.5 group-hover:flex">
                  <button
                    aria-label={`Rename ${c.title}`}
                    className="rounded p-1 text-muted hover:bg-bg hover:text-text"
                    onClick={() => setRenaming({ id: c.id, title: c.title })}
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    aria-label={`Delete ${c.title}`}
                    className="rounded p-1 text-muted hover:bg-bg hover:text-error"
                    onClick={() => removeConv(c.id)}
                  >
                    <Trash2 size={11} />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      </aside>

      {/* chat area */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-surface/40 px-3">
          <Button size="sm" variant="ghost" className="md:hidden" onClick={createConv} aria-label="New conversation">
            <Plus size={13} />
          </Button>
          {convId && convs.find((c) => c.id === convId) && (
            <span className="truncate text-[13px] font-medium">{convs.find((c) => c.id === convId)!.title}</span>
          )}
          {!convId && <span className="text-[13px] text-muted">Select or create a conversation</span>}
          <div className="flex-1" />
          <span
            className="flex items-center gap-1.5 rounded-full border border-line bg-bg px-2 py-0.5 text-xxs text-muted"
            title={connected ? "Dashboard backend reachable" : "Backend unreachable"}
          >
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${connected === false ? "bg-error" : connected ? "bg-success" : "bg-muted"}`} />
            {connected === false ? "offline" : "connected"}
          </span>
          <select
            aria-label="Model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="h-7 max-w-40 rounded-lg border border-line bg-bg px-1.5 text-xxs"
          >
            <option value="">default model</option>
            {endpointModels.length > 0 && (
              <optgroup label="Active endpoint (live)">
                {endpointModels.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </optgroup>
            )}
            {aliasModels.length > 0 && (
              <optgroup label="Custom aliases">
                {aliasModels.map((a) => (
                  <option key={a.name} value={a.name}>{a.name} → {a.model}</option>
                ))}
              </optgroup>
            )}
            {endpointModels.length === 0 && fallbackModels.length > 0 && (
              <optgroup label="Hermes cache (endpoint unreachable)">
                {fallbackModels.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </optgroup>
            )}
          </select>
          <select
            aria-label="Reasoning"
            title="Thinking effort — lower = faster first token"
            value={reasoning}
            onChange={(e) => setReasoning(e.target.value)}
            className="h-7 max-w-32 rounded-lg border border-line bg-bg px-1.5 text-xxs"
          >
            <option value="minimal">minimal thinking</option>
            <option value="none">no thinking</option>
            <option value="low">low thinking</option>
            <option value="medium">medium thinking</option>
            <option value="high">high thinking</option>
          </select>
          <span aria-hidden className="h-4 w-px bg-line" />
          <button aria-label="Reload messages" onClick={() => convId && loadMessages(convId)} className="rounded p-1 text-muted hover:bg-bg hover:text-text">
            <RefreshCw size={13} />
          </button>
        </div>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-6">
          {!convId ? (
            <Empty
              icon={<MessageSquare size={22} />}
              title="Chat with your Hermes agent"
              sub="Pick a conversation on the left or create a new one. Messages run through the real `hermes` CLI."
            />
          ) : loadingMsgs ? (
            <div className="flex justify-center py-10"><Spinner /></div>
          ) : messages.length === 0 ? (
            <Empty icon={<Bot size={22} />} title="No messages yet" sub="Send the first message below." />
          ) : (
            <div className="mx-auto max-w-[760px] space-y-5">
              {messages.map((m) => (
                <div key={m.id} className="msg-in fadein">
                  {m.role === "user" ? (
                    <div className="flex justify-end">
                      <div className="max-w-[85%] rounded-2xl rounded-br-md border border-accent/25 bg-accent/10 px-3.5 py-2 shadow-sm">
                        {parseAtts(m).length > 0 && (
                          <div className="mb-1.5 flex flex-wrap justify-end gap-1.5">
                            {parseAtts(m).map((a) => (
                              <AttChip key={a.id} att={a} />
                            ))}
                          </div>
                        )}
                        {m.content && <p className="whitespace-pre-wrap text-[13px]">{m.content}</p>}
                        <p className="mt-1 text-right text-xxs text-muted/80" title={new Date(m.created_at * 1000).toLocaleString()}>
                          {fmtTime(m.created_at)}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2.5">
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-accent/20 bg-accent/10 text-accent">
                        <Bot size={14} />
                      </span>
                      <div className="min-w-0 flex-1">
                        {m.status === "pending" || m.status === "running" ? (
                          <div className="rounded-xl border border-line bg-surface/50 px-3.5 py-2.5">
                            {liveReasoning[m.id] && (
                              <ThoughtBlock
                                text={liveReasoning[m.id]}
                                open={thoughtOpen[m.id] !== false}
                                live
                                onToggle={() => setThoughtOpen((to) => ({ ...to, [m.id]: to[m.id] === false }))}
                              />
                            )}
                            {m.content ? (
                              <div>
                                <Markdown content={m.content} />
                                <span className="caret ml-0.5 inline-block h-3 w-1.5 rounded-sm bg-accent align-middle" aria-hidden />
                              </div>
                            ) : !liveReasoning[m.id] ? (
                              <div className="flex items-center gap-2 text-xs text-muted">
                                <span className="flex items-end gap-0.5" aria-hidden>
                                  {[0, 1, 2].map((i) => (
                                    <span key={i} className="chat-dot inline-block h-1 w-1 rounded-full bg-accent" style={{ animationDelay: `${i * 0.18}s` }} />
                                  ))}
                                </span>
                                Hermes is thinking…
                              </div>
                            ) : null}
                            {liveTool[m.id] && (
                              <p className="mt-1.5 flex items-center gap-1.5 text-xxs text-muted">
                                <Wrench size={11} className="shrink-0 text-accent" />
                                using tool: <span className="font-mono">{liveTool[m.id]}</span>…
                              </p>
                            )}
                            {m.status === "running" && (
                              <div className="mt-1.5">
                                <Button size="sm" variant="ghost" onClick={() => stop(m.id)}>
                                  <Square size={11} /> Stop
                                </Button>
                              </div>
                            )}
                          </div>
                        ) : m.status === "error" ? (
                          <div className="rounded-xl border border-error/30 bg-error/5 px-3.5 py-2.5">
                            <p className="text-xs text-error">{m.error}</p>
                            <Button size="sm" variant="ghost" className="mt-1" onClick={() => retry(m)}>
                              <RefreshCw size={11} /> Retry
                            </Button>
                          </div>
                        ) : m.status === "stopped" ? (
                          <div className="rounded-xl border border-line bg-surface/50 px-3.5 py-2.5 text-xs text-muted">
                            Generation stopped.
                          </div>
                        ) : (
                          <div className="group/card rounded-xl border border-line bg-bg px-3.5 py-2.5 shadow-sm">
                            {liveReasoning[m.id] && (
                              <ThoughtBlock
                                text={liveReasoning[m.id]}
                                open={thoughtOpen[m.id] === true}
                                onToggle={() => setThoughtOpen((to) => ({ ...to, [m.id]: !(to[m.id] === true) }))}
                              />
                            )}
                            <Markdown content={m.content} />
                            <div className="mt-1.5 flex items-center gap-2 text-xxs text-muted opacity-70 transition-opacity group-hover/card:opacity-100">
                              <span title={new Date(m.created_at * 1000).toLocaleString()}>{fmtTime(m.created_at)}</span>
                              {m.model && <Badge>{m.model}</Badge>}
                              <button
                                aria-label="Copy message"
                                className="ml-auto rounded px-1.5 py-0.5 text-muted transition-colors hover:bg-surface hover:text-text"
                                onClick={() => navigator.clipboard.writeText(m.content)}
                              >
                                Copy
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* composer */}
        <div className="shrink-0 border-t border-line bg-surface/40 p-3">
          <div className="mx-auto max-w-[760px]">
            {staged.length > 0 && (
              <div className="mb-1.5 flex flex-wrap gap-1.5">
                {staged.map((a) => (
                  <AttChip key={a.id} att={a} onRemove={() => removeStaged(a.id)} />
                ))}
              </div>
            )}
            <div
              className={`rounded-xl border border-line bg-bg shadow-sm transition-shadow ${dragOver ? "ring-2 ring-accent" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                if (!dragOver) setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (convId && e.dataTransfer?.files?.length) uploadFiles(e.dataTransfer.files);
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                aria-label="Attach files"
                onChange={(e) => {
                  if (e.target.files?.length) uploadFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <textarea
                rows={2}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (!busy) send();
                  }
                }}
                placeholder={convId ? "Message Hermes… (Enter to send, Shift+Enter for newline)" : "Create a conversation first"}
                disabled={!convId}
                className="block max-h-44 w-full resize-none border-0 bg-transparent px-3.5 py-2.5 text-[13px] text-text outline-none placeholder:text-muted/70 disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Message input"
              />
              <div className="flex items-center gap-1 border-t border-line/60 px-2 py-1.5">
                <button
                  aria-label="Attach files"
                  title="Attach files (or drag & drop)"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!convId || staged.length >= 5}
                  className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface hover:text-text disabled:opacity-40"
                >
                  <Paperclip size={14} />
                </button>
                <div className="flex-1" />
                <span className="mr-1 hidden text-xxs text-muted/80 sm:block">
                  {busy ? "Agent is generating…" : <kbd className="rounded border border-line bg-surface px-1 font-sans text-xxs">Enter</kbd>}
                </span>
                <button
                  aria-label="Send message"
                  title="Send message"
                  onClick={() => send()}
                  disabled={!convId || busy || staged.some((s) => s.uploading) || (!input.trim() && staged.filter((s) => !s.uploading).length === 0)}
                  className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-accent px-2.5 text-xxs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Send size={12} /> Send
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* rename dialog */}
      {renaming && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[20vh]" onMouseDown={() => setRenaming(null)}>
          <div className="fadein w-80 rounded-xl border border-line bg-bg p-4 shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-[13px] font-semibold">Rename conversation</h3>
            <Input
              autoFocus
              value={renaming.title}
              onChange={(e) => setRenaming({ ...renaming, title: e.target.value })}
              onKeyDown={async (e) => {
                if (e.key === "Enter" && renaming.title.trim()) {
                  await api.patch(`/api/chat/conversations/${renaming.id}`, { title: renaming.title.trim() });
                  setRenaming(null);
                  loadConvs(search);
                }
              }}
            />
            <div className="mt-3 flex justify-end gap-2">
              <Button size="sm" onClick={() => setRenaming(null)}>Cancel</Button>
              <Button
                size="sm"
                variant="primary"
                onClick={async () => {
                  if (!renaming.title.trim()) return;
                  await api.patch(`/api/chat/conversations/${renaming.id}`, { title: renaming.title.trim() });
                  setRenaming(null);
                  loadConvs(search);
                }}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
