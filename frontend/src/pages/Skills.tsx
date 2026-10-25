import { useEffect, useMemo, useState } from "react";
import { Puzzle, Search, Eye, MessageSquarePlus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import type { Skill, SkillDetail } from "../types";
import { Badge, Card, Empty, ErrorBox, Input, Modal, Spinner, useToast } from "../ui";

export default function Skills() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const toast = useToast();
  const nav = useNavigate();

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setSkills(await api.get<Skill[]>("/api/skills"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load skills");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const categories = useMemo(
    () => Array.from(new Set(skills.map((s) => s.category).filter(Boolean))).sort(),
    [skills],
  );
  const filtered = skills.filter(
    (s) =>
      (!category || s.category === category) &&
      (!search || s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.description.toLowerCase().includes(search.toLowerCase())),
  );

  const openDetail = async (slug: string) => {
    setDetailLoading(true);
    try {
      setDetail(await api.get<SkillDetail>(`/api/skills/${slug}`));
    } catch {
      toast.push("error", "Failed to load skill detail");
    } finally {
      setDetailLoading(false);
    }
  };

  const statusTone = (s: string) => (s === "enabled" ? "success" : s === "disabled" ? "error" : "muted");

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <Input className="pl-7" placeholder="Search skills…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select
          className="h-8 rounded border border-line bg-bg px-2 text-[13px]"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Filter by category"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <div className="flex-1" />
        <span className="text-xxs text-muted">{skills.length} skills installed</span>
      </div>

      {error && <ErrorBox message={error} onRetry={load} />}
      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : filtered.length === 0 ? (
        <Empty icon={<Puzzle size={22} />} title="No skills match" sub="Adjust the search or category filter." />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((s) => (
            <Card key={s.slug + s.path} className="p-3 hover:border-accent/40">
              <div className="flex items-start justify-between gap-2">
                <button className="min-w-0 text-left" onClick={() => openDetail(s.slug)}>
                  <p className="truncate text-[13px] font-medium hover:text-accent">{s.name}</p>
                  {s.category && <p className="text-xxs text-muted">{s.category}</p>}
                </button>
                <Badge tone={statusTone(s.status)}>{s.status}</Badge>
              </div>
              <p className="mt-1.5 line-clamp-2 text-xs text-muted">{s.description || "No description in SKILL.md."}</p>
              <div className="mt-2 flex items-center gap-2">
                <button className="inline-flex items-center gap-1 text-xxs text-accent hover:underline" onClick={() => openDetail(s.slug)}>
                  <Eye size={11} /> Detail
                </button>
                <button
                  className="inline-flex items-center gap-1 text-xxs text-muted hover:text-text"
                  title="Ask the agent to use this skill in a new chat"
                  onClick={() => nav("/chat", { state: { draft: `Use the '${s.name}' skill to help me with: ` } })}
                >
                  <MessageSquarePlus size={11} /> Run via chat
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xxs text-muted">
        Enable/disable is managed by Hermes (`hermes skills config`, interactive) — the dashboard shows each skill's
        current state read-only. Skills are executed by the agent in Chat, not through this UI.
      </p>

      <Modal open={detail !== null || detailLoading} onClose={() => setDetail(null)} title={detail?.name ?? "Skill"} width="720px">
        {detailLoading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : detail ? (
          <div className="max-h-[65vh] space-y-2 overflow-y-auto">
            <div className="flex flex-wrap items-center gap-2 text-xxs text-muted">
              {detail.category && <Badge tone="accent">{detail.category}</Badge>}
              <Badge tone={statusTone(detail.status)}>{detail.status}</Badge>
              <span className="truncate">{detail.path}</span>
            </div>
            <p className="text-xs text-muted">{detail.description}</p>
            <pre className="whitespace-pre-wrap rounded-lg border border-line bg-surface/40 p-3 text-xxs leading-relaxed">{detail.content}</pre>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
