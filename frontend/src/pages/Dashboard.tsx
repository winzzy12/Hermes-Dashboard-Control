import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  MessageSquare, Puzzle, Clock, Cpu, Activity, ArrowRight, RefreshCw,
} from "lucide-react";
import { api, fmtTime, fmtTokens } from "../api";
import type { Overview } from "../types";
import { Badge, Card, CardHeader, Empty, ErrorBox, Spinner, StatusDot } from "../ui";

function Metric({ icon: Icon, label, value, sub, to }: {
  icon: typeof Puzzle; label: string; value: string; sub?: string; to: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-lg border border-line bg-bg px-3.5 py-3 hover:border-accent/40"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface text-muted">
        <Icon size={15} />
      </span>
      <div className="min-w-0">
        <p className="text-lg font-semibold leading-tight">{value}</p>
        <p className="truncate text-xxs text-muted">{sub ?? label}</p>
      </div>
    </Link>
  );
}

const QUICK = [
  { to: "/chat", label: "New chat", icon: MessageSquare },
  { to: "/skills", label: "Browse skills", icon: Puzzle },
  { to: "/cronjobs", label: "View cronjobs", icon: Clock },
  { to: "/models", label: "Manage models", icon: Cpu },
  { to: "/system", label: "System status", icon: Activity },
];

export default function Dashboard() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setData(await api.get<Overview>("/api/overview"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load overview");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const user = localStorage.getItem("hd-user") || "there";
  const health = data?.last_health ?? {};
  const healthEntries = Object.entries(health);

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold">Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}, {user}</h1>
          <p className="text-xs text-muted">
            {data?.mode === "mock" ? "Development mock data — not your real agent." : "Hermes Agent overview"}
          </p>
        </div>
        <button onClick={load} className="text-muted hover:text-text" aria-label="Refresh overview">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {error && <ErrorBox message={error} onRetry={load} />}
      {!data && loading && (
        <div className="flex justify-center py-16"><Spinner /></div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric icon={MessageSquare} label="Conversations" value={String(data.conversations)} sub={`${data.dashboard_messages} messages in dashboard`} to="/chat" />
            <Metric
              icon={Cpu}
              label="Active model"
              value={data.model.default_model || "—"}
              sub={data.model.default_model ? `via ${data.model.provider}` : "not configured"}
              to="/models"
            />
            <Metric
              icon={Puzzle}
              label="Skills"
              value={String(data.skills.total)}
              sub={`${data.skills.enabled} enabled`}
              to="/skills"
            />
            <Metric
              icon={Clock}
              label="Cronjobs"
              value={String(data.cronjobs.total)}
              sub={data.cron_error ? "status unavailable" : `${data.cronjobs.active} active`}
              to="/cronjobs"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {QUICK.map((q) => (
              <Link
                key={q.to}
                to={q.to}
                className="inline-flex items-center gap-1.5 rounded border border-line bg-surface/50 px-2.5 py-1.5 text-xs text-muted hover:border-accent/40 hover:text-text"
              >
                <q.icon size={13} /> {q.label}
              </Link>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="Recent conversations"
                right={<Link to="/recents" className="text-xs text-accent hover:underline">View all</Link>}
              />
              {data.agent_sessions_unavailable ? (
                <Empty title="Session store unavailable" sub="Hermes state.db could not be read." />
              ) : data.recent_sessions.length === 0 ? (
                <Empty icon={<MessageSquare size={20} />} title="No conversations yet" sub="Start a chat to see activity here." />
              ) : (
                <ul className="divide-y divide-line">
                  {data.recent_sessions.map((s) => (
                    <li key={s.id}>
                      <Link to="/recents" className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface/50">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px]">{s.title || "(untitled)"}</p>
                          <p className="text-xxs text-muted">
                            {s.source} · {s.message_count ?? 0} msgs · {fmtTokens(s.input_tokens)}→{fmtTokens(s.output_tokens)} tok
                          </p>
                        </div>
                        <span className="shrink-0 text-xxs text-muted">{fmtTime(s.last_activity_at ?? s.started_at)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader title="System status" right={<Link to="/system" className="text-xs text-accent hover:underline">Details</Link>} />
                {healthEntries.length === 0 ? (
                  <Empty icon={<Activity size={20} />} title="No health check yet" sub="Open System Status to run the first check." />
                ) : (
                  <ul className="divide-y divide-line">
                    {healthEntries.map(([name, h]) => (
                      <li key={name} className="flex items-center justify-between px-4 py-2">
                        <span className="text-[13px] capitalize">{name.replace(/_/g, " ")}</span>
                        <StatusDot status={h.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card>
                <CardHeader title="Agent tokens" sub="from Hermes session store" />
                <div className="grid grid-cols-2 gap-px bg-line">
                  <div className="bg-bg px-4 py-3">
                    <p className="text-lg font-semibold">{fmtTokens(data.agent_tokens?.input)}</p>
                    <p className="text-xxs text-muted">input tokens</p>
                  </div>
                  <div className="bg-bg px-4 py-3">
                    <p className="text-lg font-semibold">{fmtTokens(data.agent_tokens?.output)}</p>
                    <p className="text-xxs text-muted">output tokens</p>
                  </div>
                </div>
              </Card>
            </div>
          </div>

          {data.recent_executions.length > 0 && (
            <Card>
              <CardHeader title="Recent cronjob executions" right={<Link to="/cronjobs" className="text-xs text-accent hover:underline">Cronjobs <ArrowRight size={10} className="inline" /></Link>} />
              <ul className="divide-y divide-line">
                {data.recent_executions.slice(0, 5).map((e) => (
                  <li key={e.id} className="flex items-center justify-between px-4 py-2">
                    <span className="truncate text-[13px]">{e.job_id}</span>
                    <span className="flex items-center gap-2">
                      <Badge tone={e.status === "success" ? "success" : e.status === "failed" ? "error" : "muted"}>{e.status}</Badge>
                      <span className="text-xxs text-muted">{fmtTime(e.started_at)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
