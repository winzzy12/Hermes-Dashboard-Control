import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Server } from "lucide-react";
import { api } from "../api";
import { Badge, Button, Card, CardHeader, Modal, Spinner, useToast } from "../ui";

type GatewayStatus = {
  unit: string;
  kind: "user" | "system";
  found: boolean;
  active: boolean;
  state: string;
  since: string | null;
  since_epoch: number | null;
  pid: number | null;
};

function fmtSince(epoch: number | null, raw: string | null): string {
  if (!epoch) return raw || "—";
  const mins = Math.floor((Date.now() / 1000 - epoch) / 60);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
  return new Date(epoch * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function Gateway() {
  const toast = useToast();
  const [st, setSt] = useState<GatewayStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [restarting, setRestarting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setSt(await api.get<GatewayStatus>("/api/gateway/status"));
    } catch (e) {
      toast.push("error", e instanceof Error ? e.message : "Failed to load gateway status");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  const restart = async () => {
    setConfirmOpen(false);
    setRestarting(true);
    try {
      const res = await api.post<{ ok: boolean; status: GatewayStatus }>("/api/gateway/restart");
      setSt(res.status);
      toast.push(res.ok ? "success" : "error",
        res.ok ? "hermes-gateway restarted — agent sessions were reset" : "Restart issued, but the unit did not come back active");
    } catch (e) {
      toast.push("error", e instanceof Error ? e.message : "Restart failed");
      load();
    } finally {
      setRestarting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-accent/20 bg-accent/10 text-accent">
          <Server size={17} />
        </span>
        <div>
          <h1 className="text-[15px] font-semibold leading-tight">Gateway</h1>
          <p className="text-xs text-muted">Control the hermes-gateway daemon that runs the chat agent.</p>
        </div>
      </div>

      <Card>
        <CardHeader
          title="hermes-gateway"
          sub="systemd unit running the agent behind chat sessions"
          right={
            <Button size="sm" variant="ghost" onClick={load} aria-label="Refresh status" disabled={loading || restarting}>
              <RefreshCw size={13} />
            </Button>
          }
        />
        <div className="px-4 pb-4">
          {loading ? (
            <div className="flex justify-center py-6"><Spinner /></div>
          ) : !st ? (
            <p className="py-4 text-xs text-muted">Status unavailable.</p>
          ) : (
            <div className="space-y-2.5 text-[13px]">
              <div className="flex items-center justify-between">
                <span className="text-muted">State</span>
                <span className="flex items-center gap-2">
                  <span className={`inline-block h-2 w-2 rounded-full ${st.active ? "bg-success" : st.state === "failed" ? "bg-error" : "bg-muted"}`} />
                  <span className="font-medium">{st.state}</span>
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">Active since</span>
                <span title={st.since ?? ""}>{fmtSince(st.since_epoch, st.since)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">Unit</span>
                <code className="rounded border border-line bg-surface px-1.5 py-0.5 text-xxs">{st.unit}</code>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">Scope</span>
                <Badge>{st.kind}</Badge>
              </div>
              {st.pid && (
                <div className="flex items-center justify-between">
                  <span className="text-muted">PID</span>
                  <span className="font-mono text-xs">{st.pid}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Restart" sub="Loads new agent-side code (hermes CLI patches) into the daemon." />
        <div className="flex items-center justify-between gap-3 px-4 pb-4">
          <p className="text-xs text-muted">
            Running agent sessions are terminated mid-task. Chat history is kept; in-flight replies are lost.
          </p>
          <Button variant="danger" size="sm" className="shrink-0" disabled={!st?.found || restarting} onClick={() => setConfirmOpen(true)}>
            <RefreshCw size={12} /> Restart gateway
          </Button>
        </div>
      </Card>

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Restart hermes-gateway?">
        <div className="px-4 py-3">
          <p className="text-[13px]">
            This restarts the gateway daemon. All agent sessions currently running are killed and chat
            streams in progress will end. History is preserved.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button variant="danger" size="sm" onClick={restart} loading={restarting}>Restart now</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
