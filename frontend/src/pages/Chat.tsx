import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  Plus, Send, Square, Trash2, MessageSquare, Pencil, RefreshCw, Bot,
} from "lucide-react";
import { api, fmtTime } from "../api";
import type { ChatMessage, Conversation } from "../types";
import { Markdown } from "../Markdown";
import { Badge, Button, Empty, Input, Spinner, Textarea, useToast } from "../ui";

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
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // Load available models for the selector (real provider list)
  useEffect(() => {
    api
      .get<{ providers: { models: string[] }[]; config: { default_model: string } }>("/api/models")
      .then((d) => {
        setAvailableModels(d.providers.flatMap((p) => p.models).sort());
        if (!defaultModel && d.config.default_model) setModel(d.config.default_model);
      })
      .catch(() => {});
  }, [defaultModel]);

  // Load conversation messages
  useEffect(() => {
    if (convId) loadMessages(convId);
    else setMessages([]);
  }, [convId, loadMessages]);

  // Poll while something is pending/running
  useEffect(() => {
    const busy = messages.some((m) => m.status === "pending" || m.status === "running");
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (busy && convId) {
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

  const send = async () => {
    const text = input.trim();
    if (!text || !convId) return;
    setInput("");
    try {
      await api.post(`/api/chat/conversations/${convId}/messages`, { content: text, model });
      await loadMessages(convId, true);
    } catch (e) {
      toast.push("error", e instanceof Error ? e.message : "Failed to send");
      setInput(text);
    }
  };

  const stop = async (msgId: number) => {
    try {
      await api.post(`/api/chat/messages/${msgId}/stop`);
      if (convId) loadMessages(convId, true);
    } catch {
      toast.push("error", "Failed to stop");
    }
  };

  const retry = async (m: ChatMessage) => {
    if (!convId) return;
    const idx = messages.findIndex((x) => x.id === m.id);
    const userMsg = [...messages.slice(0, idx)].reverse().find((x) => x.role === "user");
    if (!userMsg) return;
    try {
      await api.post(`/api/chat/conversations/${convId}/messages`, { content: userMsg.content, model });
      await loadMessages(convId, true);
    } catch (e) {
      toast.push("error", e instanceof Error ? e.message : "Retry failed");
    }
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
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line md:flex">
        <div className="space-y-2 p-2">
          <Button variant="primary" size="sm" className="w-full" onClick={createConv}>
            <Plus size={13} /> New conversation
          </Button>
          <Input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
          {convs.length === 0 && <p className="px-2 py-6 text-center text-xs text-muted">No conversations</p>}
          {convs.map((c) => (
            <div
              key={c.id}
              className={`group flex items-center gap-1 rounded px-2 py-1.5 ${
                c.id === convId ? "bg-accent/10" : "hover:bg-surface"
              }`}
            >
              <button
                className="min-w-0 flex-1 truncate text-left text-[13px]"
                onClick={() => nav(`/chat/${c.id}`)}
                title={c.title}
              >
                <MessageSquare size={11} className="mr-1.5 inline text-muted" />
                {c.title}
              </button>
              <button
                aria-label={`Rename ${c.title}`}
                className="hidden shrink-0 text-muted hover:text-text group-hover:block"
                onClick={() => setRenaming({ id: c.id, title: c.title })}
              >
                <Pencil size={11} />
              </button>
              <button
                aria-label={`Delete ${c.title}`}
                className="hidden shrink-0 text-muted hover:text-error group-hover:block"
                onClick={() => removeConv(c.id)}
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* chat area */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
          <Button size="sm" variant="ghost" className="md:hidden" onClick={createConv}>
            <Plus size={13} />
          </Button>
          {convId && convs.find((c) => c.id === convId) && (
            <span className="truncate text-[13px] font-medium">{convs.find((c) => c.id === convId)!.title}</span>
          )}
          {!convId && <span className="text-[13px] text-muted">Select or create a conversation</span>}
          <div className="flex-1" />
          <span className="flex items-center gap-1.5 text-xxs text-muted" title={connected ? "Dashboard backend reachable" : "Backend unreachable"}>
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${connected === false ? "bg-error" : connected ? "bg-success" : "bg-muted"}`} />
            {connected === false ? "offline" : "connected"}
          </span>
          <select
            aria-label="Model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="h-6 max-w-40 rounded border border-line bg-bg px-1 text-xxs"
          >
            <option value="">default model</option>
            {availableModels.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <button aria-label="Reload messages" onClick={() => convId && loadMessages(convId)} className="text-muted hover:text-text">
            <RefreshCw size={13} />
          </button>
        </div>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
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
            <div className="mx-auto max-w-3xl space-y-4">
              {messages.map((m) => (
                <div key={m.id} className="fadein">
                  {m.role === "user" ? (
                    <div className="flex justify-end">
                      <div className="max-w-[85%] rounded-xl rounded-br-sm border border-accent/25 bg-accent/10 px-3 py-2">
                        <p className="whitespace-pre-wrap text-[13px]">{m.content}</p>
                        <p className="mt-1 text-right text-xxs text-muted" title={new Date(m.created_at * 1000).toLocaleString()}>
                          {fmtTime(m.created_at)}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2.5">
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-surface text-muted">
                        <Bot size={13} />
                      </span>
                      <div className="min-w-0 flex-1">
                        {m.status === "pending" || m.status === "running" ? (
                          <div className="flex items-center gap-2 rounded-lg border border-line bg-surface/50 px-3 py-2 text-xs text-muted">
                            <Spinner className="h-3.5 w-3.5" /> Hermes is thinking…
                            {m.status === "running" && (
                              <Button size="sm" variant="ghost" onClick={() => stop(m.id)}>
                                <Square size={11} /> Stop
                              </Button>
                            )}
                          </div>
                        ) : m.status === "error" ? (
                          <div className="rounded-lg border border-error/30 bg-error/5 px-3 py-2">
                            <p className="text-xs text-error">{m.error}</p>
                            <Button size="sm" variant="ghost" className="mt-1" onClick={() => retry(m)}>
                              <RefreshCw size={11} /> Retry
                            </Button>
                          </div>
                        ) : m.status === "stopped" ? (
                          <div className="rounded-lg border border-line bg-surface/50 px-3 py-2 text-xs text-muted">
                            Generation stopped.
                          </div>
                        ) : (
                          <div className="rounded-lg border border-line bg-bg px-3 py-2">
                            <Markdown content={m.content} />
                            <div className="mt-1.5 flex items-center gap-2 text-xxs text-muted">
                              <span title={new Date(m.created_at * 1000).toLocaleString()}>{fmtTime(m.created_at)}</span>
                              {m.model && <Badge>{m.model}</Badge>}
                              <button
                                aria-label="Copy message"
                                className="ml-auto text-muted hover:text-text"
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
        <div className="shrink-0 border-t border-line p-3">
          <div className="mx-auto max-w-3xl">
            <div className="relative">
              <Textarea
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
                className="pr-10"
                aria-label="Message input"
              />
              <button
                aria-label="Send message"
                onClick={send}
                disabled={!convId || busy || !input.trim()}
                className="absolute bottom-2 right-2 rounded p-1 text-accent disabled:opacity-40"
              >
                <Send size={15} />
              </button>
            </div>
            {busy && <p className="mt-1 text-xxs text-muted">Waiting for the agent — send is disabled while a generation is in flight.</p>}
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
