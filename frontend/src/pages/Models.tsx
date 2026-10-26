import { useCallback, useEffect, useState } from "react";
import { Cpu, Eye, EyeOff, KeyRound, Pencil, PlugZap, Plus, Star, Trash2, Zap } from "lucide-react";
import { api } from "../api";
import type { ModelsPayload } from "../types";
import { Badge, Button, Card, CardHeader, Empty, ErrorBox, Field, Input, Modal, Spinner, useToast } from "../ui";

type ProbeResult = { status: string; latency_ms: number; detail: string };

type CustomModel = ModelsPayload["custom_models"][number];

type CustomForm = {
  name: string;
  model: string;
  base_url: string;
  api_key: string;
  set_default: boolean;
  editing: boolean;
};

const EMPTY_FORM: CustomForm = { name: "", model: "", base_url: "", api_key: "", set_default: false, editing: false };

export default function Models() {
  const [data, setData] = useState<ModelsPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ProbeResult | null>(null);
  const [pendingDefault, setPendingDefault] = useState<string | null>(null);
  const toast = useToast();

  // custom models
  const [form, setForm] = useState<CustomForm | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [formErr, setFormErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [rowTesting, setRowTesting] = useState<Record<string, boolean>>({});
  const [rowTests, setRowTests] = useState<Record<string, ProbeResult>>({});
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [pendingActivate, setPendingActivate] = useState<string | null>(null);

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
      setTestResult(await api.post<ProbeResult>("/api/models/test"));
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

  // ---- custom model actions

  const openAdd = () => {
    setForm({ ...EMPTY_FORM });
    setShowKey(false);
    setFormErr("");
  };

  const openEdit = (m: CustomModel) => {
    setForm({ name: m.name, model: m.model, base_url: m.base_url, api_key: "", set_default: false, editing: true });
    setShowKey(false);
    setFormErr("");
  };

  const saveCustom = async () => {
    if (!form) return;
    const name = form.name.trim();
    const model = form.model.trim();
    const base = form.base_url.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(name)) {
      setFormErr("Name: 1-40 chars, letters/digits/-/_, must start with a letter or digit.");
      return;
    }
    if (!model) {
      setFormErr("Model ID is required.");
      return;
    }
    if (!/^https?:\/\/\S+$/.test(base)) {
      setFormErr("Base URL must be a valid http(s) URL.");
      return;
    }
    setSaving(true);
    setFormErr("");
    try {
      const res = await api.post<{ ok: boolean; test: ProbeResult }>("/api/models/custom", {
        name,
        model,
        base_url: base,
        api_key: form.api_key,
        set_default: form.set_default,
      });
      setRowTests((t) => ({ ...t, [name]: res.test }));
      toast.push(
        res.test.status === "operational" ? "success" : "info",
        (form.editing ? `Custom model ${name} updated` : `Custom model ${name} added`) +
          (res.test.status === "operational" ? ` · endpoint reachable (${res.test.detail})` : ` · endpoint check: ${res.test.status}`)
      );
      setForm(null);
      load();
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : "Failed to save custom model");
    } finally {
      setSaving(false);
    }
  };

  const testCustom = async (name: string) => {
    setRowTesting((t) => ({ ...t, [name]: true }));
    try {
      const r = await api.post<ProbeResult>(`/api/models/custom/${encodeURIComponent(name)}/test`);
      setRowTests((t) => ({ ...t, [name]: r }));
    } catch (e) {
      toast.push("error", e instanceof Error ? e.message : "Test failed");
    } finally {
      setRowTesting((t) => ({ ...t, [name]: false }));
    }
  };

  const activate = async () => {
    if (!pendingActivate) return;
    try {
      await api.post(`/api/models/custom/${encodeURIComponent(pendingActivate)}/activate`, { confirm: true });
      toast.push("success", `Active model switched to ${pendingActivate}`);
      setPendingActivate(null);
      load();
    } catch (e) {
      toast.push("error", e instanceof Error ? e.message : "Failed to activate custom model");
    }
  };

  const removeCustom = async () => {
    if (!pendingDelete) return;
    try {
      await api.del(`/api/models/custom/${encodeURIComponent(pendingDelete)}?confirm=true`);
      toast.push("success", `Custom model ${pendingDelete} deleted`);
      setPendingDelete(null);
      load();
    } catch (e) {
      toast.push("error", e instanceof Error ? e.message : "Failed to delete custom model");
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

          <Card>
            <CardHeader
              title="Custom models"
              sub="Named endpoints you can add (base URL + API key + model). Keys are stored in ~/.hermes/.env and never shown again."
              right={
                <Button size="sm" variant="primary" onClick={openAdd}>
                  <Plus size={12} /> Add custom model
                </Button>
              }
            />
            {data.custom_models.length === 0 ? (
              <Empty
                icon={<KeyRound size={22} />}
                title="No custom models yet"
                sub="Add an OpenAI-compatible endpoint (base URL, API key, model ID) to switch to it anytime."
              />
            ) : (
              <ul className="divide-y divide-line">
                {data.custom_models.map((m) => {
                  const t = rowTests[m.name];
                  return (
                    <li key={m.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="text-[13px] font-semibold">{m.name}</span>
                          {m.is_default && (
                            <Badge tone="accent"><Star size={9} className="mr-1 inline" />active</Badge>
                          )}
                          {!m.has_key && <Badge tone="warning">no key</Badge>}
                        </span>
                        <span className="block truncate font-mono text-xxs text-muted">{m.model} · {m.base_url}</span>
                      </span>
                      {t && (
                        <span className={`text-xxs ${t.status === "operational" ? "text-success" : "text-error"}`}>
                          {t.status} · {t.latency_ms} ms
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Button size="sm" variant="ghost" loading={rowTesting[m.name]} onClick={() => testCustom(m.name)}>
                          <Zap size={11} /> Test
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => openEdit(m)}>
                          <Pencil size={11} />
                        </Button>
                        {!m.is_default && (
                          <Button size="sm" variant="ghost" onClick={() => setPendingActivate(m.name)}>
                            <Star size={11} /> Activate
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setPendingDelete(m.name)}>
                          <Trash2 size={11} />
                        </Button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
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

      <Modal
        open={form !== null}
        onClose={() => setForm(null)}
        title={form?.editing ? `Edit custom model: ${form?.name}` : "Add custom model"}
        width="460px"
      >
        {form && (
          <div className="space-y-3">
            <Field label="Name" hint="Identifier used for /model switching (letters, digits, - and _).">
              <Input
                value={form.name}
                disabled={form.editing}
                placeholder="my-endpoint"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label="Model ID" hint="The exact model ID the endpoint serves, e.g. qwen3-32b.">
              <Input
                value={form.model}
                placeholder="qwen3-32b"
                onChange={(e) => setForm({ ...form, model: e.target.value })}
              />
            </Field>
            <Field label="Base URL" hint="OpenAI-compatible endpoint, e.g. https://api.example.com/v1">
              <Input
                value={form.base_url}
                placeholder="https://api.example.com/v1"
                onChange={(e) => setForm({ ...form, base_url: e.target.value })}
              />
            </Field>
            <Field
              label="API key"
              hint={
                form.editing
                  ? "Stored in ~/.hermes/.env, referenced by name only. Leave empty to keep the current key."
                  : "Stored in ~/.hermes/.env, referenced by name only. Optional for local endpoints without auth."
              }
            >
              <div className="relative">
                <Input
                  type={showKey ? "text" : "password"}
                  value={form.api_key}
                  autoComplete="off"
                  placeholder={form.editing ? "•••••••• (keep current)" : "sk-..."}
                  className="pr-8"
                  onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-2 flex items-center text-muted hover:text-text"
                  onClick={() => setShowKey(!showKey)}
                  aria-label={showKey ? "Hide API key" : "Show API key"}
                >
                  {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
            </Field>
            {!form.editing && (
              <label className="flex cursor-pointer items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  className="accent-[var(--c-accent)]"
                  checked={form.set_default}
                  onChange={(e) => setForm({ ...form, set_default: e.target.checked })}
                />
                Set as the agent's default model
              </label>
            )}
            {formErr && <p className="text-xs text-error">{formErr}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button size="sm" onClick={() => setForm(null)}>Cancel</Button>
              <Button size="sm" variant="primary" loading={saving} onClick={saveCustom}>
                {form.editing ? "Save changes" : "Add model"}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={pendingDelete !== null} onClose={() => setPendingDelete(null)} title="Delete custom model?">
        <p className="text-[13px]">
          Delete <span className="font-mono text-xs">{pendingDelete}</span>? Its alias is removed from the agent config
          (the stored key in ~/.hermes/.env stays and is harmless). If it is the active model, the active route keeps
          working.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" onClick={() => setPendingDelete(null)}>Cancel</Button>
          <Button size="sm" variant="danger" onClick={removeCustom}>Delete</Button>
        </div>
      </Modal>

      <Modal open={pendingActivate !== null} onClose={() => setPendingActivate(null)} title="Activate custom model?">
        <p className="text-[13px]">
          Switch the agent's active model to <span className="font-mono text-xs">{pendingActivate}</span> (model, base
          URL and key)? The previous route is replaced in the agent's live configuration.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" onClick={() => setPendingActivate(null)}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={activate}>Confirm</Button>
        </div>
      </Modal>
    </div>
  );
}
