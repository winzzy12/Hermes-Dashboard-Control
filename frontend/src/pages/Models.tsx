import { useCallback, useEffect, useState } from "react";
import { Cpu, PlugZap, Star } from "lucide-react";
import { api } from "../api";
import type { ModelsPayload } from "../types";
import { Badge, Button, Card, CardHeader, Empty, ErrorBox, Modal, Spinner, useToast } from "../ui";

export default function Models() {
  const [data, setData] = useState<ModelsPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ status: string; latency_ms: number; detail: string } | null>(null);
  const [pendingDefault, setPendingDefault] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await api.get<ModelsPayload>("/api/models"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load models");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await api.post("/api/models/test"));
    } catch (e) {
      toast.push("error", e instanceof Error ? e.message : "Test failed");
    } finally {
      setTesting(false);
    }
  };

  const setDefault = async () => {
    if (!pendingDefault) return;
    try {
      await api.post("/api/models/default", { model: pendingDefault, confirm: true });
      toast.push("success", `Default model set to ${pendingDefault}`);
      setPendingDefault(null);
      load();
    } catch (e) {
      toast.push("error", e instanceof Error ? e.message : "Failed to set default model");
    }
  };

  if (loading) {
    return <div className="flex justify-center py-16"><Spinner /></div>;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      {error && <ErrorBox message={error} onRetry={load} />}
      {data && (
        <>
          <Card>
            <CardHeader
              title="Agent model configuration"
              sub={`${data.config.provider} · ${data.config.base_url || "no base_url"} · API key ${data.config.has_api_key ? "configured (server-side, hidden)" : "missing"}`}
              right={
                <Button size="sm" onClick={runTest} loading={testing}>
                  <PlugZap size={12} /> Test connectivity
                </Button>
              }
            />
            <div className="grid gap-px bg-line sm:grid-cols-3">
              <div className="bg-bg px-4 py-3">
                <p className="text-lg font-semibold">{data.config.default_model || "—"}</p>
                <p className="text-xxs text-muted">default model</p>
              </div>
              <div className="bg-bg px-4 py-3">
                <p className="text-lg font-semibold capitalize">{data.config.provider || "—"}</p>
                <p className="text-xxs text-muted">provider</p>
              </div>
              <div className="bg-bg px-4 py-3">
                {testResult ? (
                  <>
                    <p className={`text-lg font-semibold capitalize ${testResult.status === "operational" ? "text-success" : "text-error"}`}>
                      {testResult.status}
                    </p>
                    <p className="text-xxs text-muted">{testResult.detail} · {testResult.latency_ms} ms</p>
                  </>
                ) : (
                  <>
                    <p className="text-lg font-semibold text-muted">—</p>
                    <p className="text-xxs text-muted">run a connectivity test</p>
                  </>
                )}
              </div>
            </div>
          </Card>

          {data.providers.length === 0 ? (
            <Empty icon={<Cpu size={22} />} title="No provider model cache" sub="Hermes has not cached a model list yet. Run a chat or `hermes model` once." />
          ) : (
            data.providers.map((p) => (
              <Card key={p.base_url + p.provider}>
                <CardHeader
                  title={<span className="capitalize">{p.provider}</span>}
                  sub={`${p.models.length} models reported by the provider${p.age_hours !== null ? ` · cached ${p.age_hours}h ago` : ""}`}
                />
                <ul className="divide-y divide-line">
                  {p.models.map((m) => (
                    <li key={m} className="flex items-center gap-3 px-4 py-2">
                      <span className="min-w-0 flex-1 truncate font-mono text-xs">{m}</span>
                      {m === data.config.default_model ? (
                        <Badge tone="accent"><Star size={9} className="mr-1 inline" />default</Badge>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => setPendingDefault(m)}>
                          Set default
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            ))
          )}
          <p className="text-xxs text-muted">
            Changing the default model runs <code>hermes config set model.default</code> on the agent and affects every
            surface that uses the default profile. The per-chat model selector in Chat overrides it per message without
            touching the agent config.
          </p>
        </>
      )}

      <Modal open={pendingDefault !== null} onClose={() => setPendingDefault(null)} title="Change agent default model?">
        <p className="text-[13px]">
          Set the default model to <span className="font-mono text-xs">{pendingDefault}</span> for the whole Hermes
          agent? This changes the agent's live configuration.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" onClick={() => setPendingDefault(null)}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={setDefault}>Confirm</Button>
        </div>
      </Modal>
    </div>
  );
}
