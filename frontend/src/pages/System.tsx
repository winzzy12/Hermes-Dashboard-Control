import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api, fmtTime } from "../api";
import type { HealthService, SystemStatus } from "../types";
import { Badge, Button, Card, CardHeader, Spinner, StatusDot } from "../ui";

const POLL_SECONDS = 30;

export default function System() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [history, setHistory] = useState<{ ts: number; name: string; status: string; latency_ms: number | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [auto, setAuto] = useState(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [s, h] = await Promise.all([
        api.get<SystemStatus>("/api/system/status"),
        api.get<typeof history>("/api/system/history?limit=120"),
      ]);
      setStatus(s);
      setHistory(h);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    if (auto) {
      timer.current = setInterval(() => load(true), POLL_SECONDS * 1000);
    }
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [auto, load]);

  const perService = (name: string) => history.filter((h) => h.name === name).slice(-30);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        {status && (
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold">Overall:</span>
            <StatusDot status={status.overall} />
            <Badge tone={status.mode === "mock" ? "warning" : "muted"}>{status.mode} mode</Badge>
            <span className="text-xxs text-muted">checked {fmtTime(status.checked_at)}</span>
          </div>
        )}
        <div className="flex-1" />
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="accent-accent" />
          Auto refresh ({POLL_SECONDS}s)
        </label>
        <Button size="sm" onClick={() => load()} loading={loading}>
          <RefreshCw size={12} /> Refresh
        </Button>
      </div>

      {loading && !status ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : status ? (
        <div className="grid gap-3 md:grid-cols-2">
          {status.services.map((s: HealthService) => {
            const hist = perService(s.name);
            const okCount = hist.filter((h) => h.status === "operational").length;
            return (
              <Card key={s.name} className="p-4">
                <div className="mb-1.5 flex items-center justify-between">
                  <h3 className="text-[13px] font-semibold capitalize">{s.name.replace(/_/g, " ")}</h3>
                  <StatusDot status={s.status} />
                </div>
                <p className="text-xs text-muted">{s.detail || "—"}</p>
                <div className="mt-2 flex items-center justify-between text-xxs text-muted">
                  <span>{s.latency_ms !== null ? `${s.latency_ms} ms` : ""}</span>
                  <span>
                    {hist.length > 0 && `${okCount}/${hist.length} checks ok (last ${hist.length})`}
                  </span>
                </div>
                {hist.length > 1 && (
                  <div className="mt-2 flex h-4 items-end gap-px" aria-hidden>
                    {hist.map((h, i) => (
                      <span
                        key={i}
                        title={`${h.status} ${h.latency_ms ?? ""}ms`}
                        className={`flex-1 rounded-sm ${
                          h.status === "operational" ? "bg-success/70" : h.status === "degraded" ? "bg-warning/70" : h.status === "offline" ? "bg-error/70" : "bg-muted/40"
                        }`}
                        style={{ height: `${Math.max(2, Math.min(100, ((h.latency_ms ?? 0) / 2000) * 100))}%` }}
                      />
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="p-6 text-center text-xs text-muted">No status available — run a refresh.</Card>
      )}

      <Card>
        <CardHeader title="Recent checks" sub="each row is one probe result, newest last" />
        <div className="max-h-64 overflow-y-auto px-4 py-2 font-mono text-xxs text-muted">
          {history.slice(-40).reverse().map((h, i) => (
            <p key={i}>
              {new Date(h.ts * 1000).toLocaleTimeString()} · {h.name.padEnd(15)} · {h.status} · {h.latency_ms ?? "—"} ms
            </p>
          ))}
          {history.length === 0 && <p className="py-4 text-center">No history yet.</p>}
        </div>
      </Card>
    </div>
  );
}
