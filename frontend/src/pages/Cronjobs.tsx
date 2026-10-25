import { useCallback, useEffect, useState } from "react";
import { Clock, Plus, Play, Pause, Pencil, Trash2 } from "lucide-react";
import { api, ApiError } from "../api";
import type { CronExecution, CronJob, SchedulePreview } from "../types";
import { Badge, Button, Empty, ErrorBox, Field, Input, Modal, Spinner, Textarea, useToast } from "../ui";

function ScheduleEditor({ schedule, onSchedule }: { schedule: string; onSchedule: (s: string) => void }) {
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  useEffect(() => {
    if (!schedule.trim()) {
      setPreview(null);
      return;
    }
    const t = setTimeout(() => {
      api
        .get<SchedulePreview>(`/api/cronjobs/schedule-preview?schedule=${encodeURIComponent(schedule)}`)
        .then(setPreview)
        .catch(() => setPreview(null));
    }, 300);
    return () => clearTimeout(t);
  }, [schedule]);
  return (
    <Field label="Schedule" hint="Interval ('30m', 'every 2h'), 5-field cron ('0 9 * * *'), or ISO timestamp">
      <Input value={schedule} onChange={(e) => onSchedule(e.target.value)} placeholder="0 9 * * *" />
      {preview && !preview.valid && <span className="mt-1 block text-xxs text-error">{preview.error}</span>}
      {preview && preview.valid && (
        <span className="mt-1 block text-xxs text-success">Next: {preview.next.slice(0, 2).join(" · ")}</span>
      )}
    </Field>
  );
}

export default function Cronjobs() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [execs, setExecs] = useState<CronExecution[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", schedule: "", prompt: "", paused: true });
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<CronJob | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [j, e] = await Promise.all([
        api.get<CronJob[]>(`/api/cronjobs?include_disabled=${showAll}`),
        api.get<CronExecution[]>("/api/cronjobs/executions?limit=30"),
      ]);
      setJobs(j);
      setExecs(e);
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "Failed to load cronjobs");
    } finally {
      setLoading(false);
    }
  }, [showAll]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    try {
      await api.post("/api/cronjobs", form);
      toast.push("success", form.paused ? "Job created (paused)" : "Job created and scheduled");
      setCreating(false);
      setForm({ name: "", schedule: "", prompt: "", paused: true });
      load();
    } catch (e) {
      toast.push("error", e instanceof ApiError ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  };

  const act = async (job: CronJob, action: "pause" | "resume" | "run") => {
    try {
      await api.patch(`/api/cronjobs/${job.id}`, { action });
      toast.push("success", action === "run" ? "Job triggered" : `Job ${action}d`);
      load();
    } catch (e) {
      toast.push("error", e instanceof ApiError ? e.message : `Failed to ${action}`);
    }
  };

  const remove = async () => {
    if (!confirmDelete) return;
    try {
      await api.del(`/api/cronjobs/${confirmDelete.id}?confirm=true`);
      toast.push("success", "Job deleted");
      setConfirmDelete(null);
      load();
    } catch (e) {
      toast.push("error", e instanceof ApiError ? e.message : "Delete failed");
    }
  };

  const statusTone = (s: string) =>
    s === "active" || s === "enabled" ? "success" : s === "paused" ? "warning" : "muted";

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="accent-accent" />
          Show paused/completed
        </label>
        <div className="flex-1" />
        <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
          <Plus size={13} /> New job
        </Button>
      </div>

      {error && <ErrorBox message={error} onRetry={load} />}
      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : jobs.length === 0 ? (
        <Empty
          icon={<Clock size={22} />}
          title="No scheduled jobs"
          sub="Create a job to schedule a Hermes task. Jobs are created through the real `hermes cron` scheduler; new jobs start paused until you resume them."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line bg-surface/50 text-xxs uppercase tracking-wide text-muted">
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Schedule</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Last run</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {jobs.map((j) => (
                <tr key={j.id} className="align-top hover:bg-surface/40" title={j.prompt}>
                  <td className="px-3 py-2">
                    <p className="font-medium">{j.name}</p>
                    <p className="max-w-xs truncate text-xxs text-muted">{j.prompt}</p>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{j.schedule}</td>
                  <td className="px-3 py-2">
                    <Badge tone={statusTone(j.status)}>{j.status}</Badge>
                    {j.last_error && <p className="mt-1 max-w-[200px] truncate text-xxs text-error">{j.last_error}</p>}
                  </td>
                  <td className="px-3 py-2 text-xxs text-muted">
                    {j.last_run ?? "never"}
                    {j.last_status && <span className="block">{j.last_status}</span>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      {j.status === "paused" ? (
                        <Button size="sm" variant="ghost" onClick={() => act(j, "resume")} title="Resume">
                          <Play size={12} />
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => act(j, "pause")} title="Pause">
                          <Pause size={12} />
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => act(j, "run")} title="Run now">
                        <Play size={12} className="rotate-[-90deg]" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Delete"
                        onClick={() => setConfirmDelete(j)}
                      >
                        <Trash2 size={12} />
                      </Button>
                      <span className="ml-1 inline-flex items-center gap-1 text-xxs text-muted">
                        <Pencil size={10} />
                        edit via CLI
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {execs.length > 0 && (
        <div>
          <h2 className="mb-2 text-[13px] font-semibold">Execution history</h2>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-left text-[13px]">
              <tbody className="divide-y divide-line">
                {execs.map((e) => (
                  <tr key={e.id}>
                    <td className="px-3 py-1.5 font-mono text-xs">{e.job_id}</td>
                    <td className="px-3 py-1.5">
                      <Badge tone={e.status === "success" ? "success" : e.status === "failed" ? "error" : "muted"}>{e.status}</Badge>
                    </td>
                    <td className="px-3 py-1.5 text-xxs text-muted">{e.started_at ?? "—"}</td>
                    <td className="max-w-xs truncate px-3 py-1.5 text-xxs text-error">{e.error ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* create dialog */}
      <Modal open={creating} onClose={() => setCreating(false)} title="Create cronjob" width="480px">
        <div className="space-y-3">
          <Field label="Name">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="daily-report" />
          </Field>
          <ScheduleEditor schedule={form.schedule} onSchedule={(schedule) => setForm({ ...form, schedule })} />
          <Field label="Prompt" hint="Self-contained instruction the agent will execute on each run">
            <Textarea rows={4} value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={form.paused} onChange={(e) => setForm({ ...form, paused: e.target.checked })} className="accent-accent" />
            Create paused (recommended — review before it schedules)
          </label>
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={() => setCreating(false)}>Cancel</Button>
            <Button size="sm" variant="primary" loading={busy} onClick={create} disabled={!form.schedule.trim() || !form.prompt.trim()}>
              Create job
            </Button>
          </div>
        </div>
      </Modal>

      {/* delete confirmation */}
      <Modal open={confirmDelete !== null} onClose={() => setConfirmDelete(null)} title="Delete cronjob?">
        <p className="text-[13px]">
          Delete <span className="font-medium">{confirmDelete?.name}</span> ({confirmDelete?.schedule})? The agent will no
          longer run this task. This cannot be undone.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button size="sm" variant="danger" onClick={remove}>Delete job</Button>
        </div>
      </Modal>
    </div>
  );
}
