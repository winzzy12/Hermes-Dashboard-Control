import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { History, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { api, fmtTime, fmtTokens } from "../api";
import type { ActivityItem } from "../types";
import { Badge, Button, Empty, ErrorBox, Input, Modal, Select, Spinner } from "../ui";
import { Markdown } from "../Markdown";

const KINDS = [
  ["", "All"],
  ["session", "Agent sessions"],
  ["chat", "Dashboard chats"],
  ["cron", "Cron executions"],
];

export default function Recents() {
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = 50;
  const type = params.get("type") ?? "";
  const status = params.get("status") ?? "";
  const [detail, setDetail] = useState<{ title: string; messages: { role: string; content: string }[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({ type, status, search, limit: String(limit), offset: String(offset) });
      const d = await api.get<{ items: ActivityItem[] }>(`/api/recents?${qs}`);
      setItems(d.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load activity");
    } finally {
      setLoading(false);
    }
  }, [type, status, search, offset]);

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = async (it: ActivityItem) => {
    if (it.kind !== "session") return;
    setDetailLoading(true);
    try {
      const d = await api.get<{ id: string; messages: { role: string; content: string }[] }>(
        `/api/recents/session/${it.id}`,
      );
      setDetail({ title: it.title, messages: d.messages });
    } catch {
      setDetail({ title: it.title, messages: [] });
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <Input
            className="pl-7"
            placeholder="Search activity…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
            }}
          />
        </div>
        <Select
          className="w-40"
          value={type}
          onChange={(v) => {
            setParams(v.target.value ? { type: v.target.value } : {});
            setOffset(0);
          }}
          aria-label="Filter by type"
        >
          {KINDS.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </Select>
        <Select
          className="w-36"
          value={status}
          onChange={(e) => {
            setParams({ ...(type ? { type } : {}), ...(e.target.value ? { status: e.target.value } : {}) });
            setOffset(0);
          }}
          aria-label="Filter by status"
        >
          <option value="">Any status</option>
          <option value="done">Done</option>
          <option value="active">Active</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
        </Select>
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          <Button size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))} aria-label="Previous page">
            <ChevronLeft size={13} />
          </Button>
          <span className="text-xxs text-muted">offset {offset}</span>
          <Button size="sm" disabled={items.length < limit} onClick={() => setOffset(offset + limit)} aria-label="Next page">
            <ChevronRight size={13} />
          </Button>
        </div>
      </div>

      {error && <ErrorBox message={error} onRetry={load} />}
      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : items.length === 0 ? (
        <Empty icon={<History size={22} />} title="No activity found" sub="Agent sessions, dashboard chats, and cron executions will appear here." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line bg-surface/50 text-xxs uppercase tracking-wide text-muted">
                <th className="px-3 py-2 font-medium">Activity</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((it) => (
                <tr key={`${it.kind}-${it.id}`} className="hover:bg-surface/40">
                  <td className="max-w-[420px] truncate px-3 py-2">
                    {it.kind === "session" ? (
                      <button className="text-left hover:text-accent" onClick={() => openDetail(it)} title="View transcript">
                        {it.title || "(untitled)"}
                      </button>
                    ) : (
                      it.title
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted">{it.kind === "session" ? `session (${it.source})` : it.kind === "chat" ? "chat" : "cron"}</td>
                  <td className="px-3 py-2">
                    <Badge tone={it.status === "done" || it.status === "success" ? "success" : it.status === "failed" || it.status === "error" ? "error" : "muted"}>
                      {it.status}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xxs text-muted">{fmtTime(it.ts)}</td>
                  <td className="px-3 py-2 text-xxs text-muted">
                    {it.kind === "session" && `${it.message_count ?? 0} msgs · ${fmtTokens(it.input_tokens)}→${fmtTokens(it.output_tokens)}`}
                    {it.kind === "chat" && `${it.message_count ?? 0} msgs`}
                    {it.kind === "cron" && (it.error ? <span className="text-error">{it.error.slice(0, 80)}</span> : it.job_id)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={detail !== null || detailLoading} onClose={() => setDetail(null)} title={detail?.title ?? "Transcript"} width="720px">
        {detailLoading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : detail && detail.messages.length > 0 ? (
          <div className="max-h-[60vh] space-y-3 overflow-y-auto">
            {detail.messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
                <div className={`max-w-[90%] rounded-lg border border-line px-3 py-2 ${m.role === "user" ? "bg-accent/10" : "bg-surface/40"}`}>
                  <p className="mb-0.5 text-xxs uppercase tracking-wide text-muted">{m.role}</p>
                  <Markdown content={m.content} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty title="No messages" sub="This session has no stored messages." />
        )}
      </Modal>
    </div>
  );
}
