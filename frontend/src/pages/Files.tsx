import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronRight, Download, Eye, File as FileIcon, FileCode2, FileX, Folder,
  Home, RefreshCw, Trash2, Upload,
} from "lucide-react";
import { api, fmtTime } from "../api";
import type { FileEntry, FileListPayload, FileViewPayload } from "../types";
import { Badge, Button, Card, Empty, ErrorBox, Input, Modal, Spinner, Textarea, useToast } from "../ui";

/* ------------------------------------------------------------------ helpers */

function fmtSize(n: number | null): string {
  if (n === null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 * 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function ext(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

const TEXT_EXT = new Set([
  "txt", "md", "markdown", "json", "jsonl", "yaml", "yml", "toml", "ini", "cfg", "conf", "env",
  "log", "csv", "tsv", "xml", "html", "htm", "css", "js", "jsx", "ts", "tsx", "py", "sh", "bash",
  "zsh", "c", "h", "cpp", "hpp", "go", "rs", "java", "kt", "rb", "php", "sql", "lua", "pl", "r",
  "dockerfile", "gitignore", "gitattributes", "editorconfig", "lock", "patch", "diff",
]);

function isTextish(name: string, path: string): boolean {
  if (path.endsWith("/Dockerfile") || name === "Makefile" || name === "README" || name === ".gitignore" || name === ".env") return true;
  return TEXT_EXT.has(ext(name));
}

type EditState = {
  path: string;
  name: string;
  content: string;
  exists: boolean;
  size: number;
  truncated: boolean;
  binary: boolean;
};

type DeleteTarget = { path: string; name: string; is_dir: boolean };

/* ------------------------------------------------------------------ page */

export default function Files() {
  const [dir, setDir] = useState("/");
  const [data, setData] = useState<FileListPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [jump, setJump] = useState("/");
  const [jumping, setJumping] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [view, setView] = useState<FileViewPayload | null>(null);
  const [viewErr, setViewErr] = useState("");
  const [edit, setEdit] = useState<EditState | null>(null);
  const [editErr, setEditErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null);
  const [deleteErr, setDeleteErr] = useState("");
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async (path: string) => {
    setLoading(true);
    setError("");
    try {
      setData(await api.get<FileListPayload>(`/api/files?path=${encodeURIComponent(path)}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to list directory");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setDir("/");
    setJump("/");
    load("/");
  }, [load]);

  const go = (path: string) => {
    if (!path) return;
    setDir(path);
    setJump(path);
    load(path);
  };

  const submitJump = () => {
    const p = jump.trim().startsWith("/") ? jump.trim() : `/${jump.trim()}`;
    if (p === dir) return;
    setJumping(true);
    load(p).finally(() => setJumping(false));
    setDir(p);
  };

  const openView = async (e: FileEntry) => {
    setView(null);
    setViewErr("");
    try {
      setView(await api.get<FileViewPayload>(`/api/files/view?path=${encodeURIComponent(e.path)}`));
    } catch (err) {
      setViewErr(err instanceof Error ? err.message : "Failed to open file");
    }
  };

  const openEdit = async (e: FileEntry) => {
    setEditErr("");
    if (!isTextish(e.name, e.path)) {
      setEdit({ path: e.path, name: e.name, content: "", exists: true, size: e.size ?? 0, truncated: false, binary: true });
      return;
    }
    setEdit({ path: e.path, name: e.name, content: "", exists: true, size: e.size ?? 0, truncated: false, binary: false });
    try {
      const v = await api.get<FileViewPayload>(`/api/files/view?path=${encodeURIComponent(e.path)}`);
      setEdit({ path: e.path, name: e.name, content: v.content ?? "", exists: true, size: v.size, truncated: v.truncated, binary: v.binary });
      if (v.binary) setEditErr("This file is binary and cannot be edited as text. Use Download instead.");
    } catch (err) {
      setEditErr(err instanceof Error ? err.message : "Failed to load file");
    }
  };

  const saveEdit = async () => {
    if (!edit) return;
    setSaving(true);
    setEditErr("");
    try {
      await api.put("/api/files", { path: edit.path, content: edit.content, confirm: edit.exists });
      toast.push("success", edit.exists ? `Saved ${edit.name}` : `Created ${edit.name}`);
      setEdit(null);
      load(dir);
    } catch (e) {
      setEditErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteErr("");
    try {
      await api.del(`/api/files?path=${encodeURIComponent(deleting.path)}&confirm=true`);
      toast.push("success", `Deleted ${deleting.name}`);
      setDeleting(null);
      load(dir);
    } catch (e) {
      setDeleteErr(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const onUploadPicked = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    let okCount = 0;
    for (const f of Array.from(files)) {
      const fd = new FormData();
      fd.append("file", f);
      try {
        const res = await fetch(`/api/files/upload?path=${encodeURIComponent(dir)}&overwrite=false`, {
          method: "POST",
          credentials: "same-origin",
          body: fd,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          toast.push("error", `${f.name}: ${body?.detail ?? `HTTP ${res.status}`}`);
          continue;
        }
        okCount++;
      } catch (e) {
        toast.push("error", `${f.name}: ${e instanceof Error ? e.message : "upload failed"}`);
      }
    }
    if (okCount > 0) toast.push("success", `Uploaded ${okCount} file${okCount > 1 ? "s" : ""}`);
    setUploading(false);
    if (fileInput.current) fileInput.current.value = "";
    load(dir);
  };

  /* breadcrumb segments */
  const segs = dir.split("/").filter(Boolean);
  const crumbs: { label: string; path: string }[] = [];
  let acc = "";
  for (const s of segs) {
    acc += `/${s}`;
    crumbs.push({ label: s, path: acc });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => data?.parent && go(data.parent)} disabled={!data?.parent} title="Up one level">
          <Home size={13} /> Up
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto rounded border border-line bg-bg px-2 py-1">
          <button onClick={() => go("/")} title="/root home" className="shrink-0 text-muted hover:text-text">
            <Home size={13} />
          </button>
          {crumbs.map((c) => (
            <span key={c.path} className="flex shrink-0 items-center gap-0.5">
              <ChevronRight size={11} className="text-muted/50" />
              <button
                onClick={() => go(c.path)}
                className={`max-w-[180px] truncate px-1 py-0.5 text-[13px] hover:underline ${c.path === dir ? "font-semibold text-text" : "text-muted"}`}
                title={c.path}
              >
                {c.label}
              </button>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={jump}
            onChange={(e) => setJump(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitJump()}
            placeholder="Jump to /path…"
            className="w-52 font-mono"
          />
          <Button size="sm" onClick={submitJump} loading={jumping}>Go</Button>
          <Button size="sm" onClick={() => load(dir)}>
            <RefreshCw size={13} /> Refresh
          </Button>
          <Button size="sm" variant="primary" onClick={() => fileInput.current?.click()} loading={uploading}>
            <Upload size={13} /> Upload
          </Button>
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => onUploadPicked(e.target.files)} />
        </div>
      </div>

      {/* listing */}
      <Card>
        {loading && (
          <div className="flex items-center justify-center py-16">
            <Spinner />
          </div>
        )}
        {!loading && error && <div className="p-4"><ErrorBox message={error} onRetry={() => load(dir)} /></div>}
        {!loading && !error && data && data.entries.length === 0 && (
          <Empty icon={<Folder size={22} />} title="Empty directory" sub={data.path} />
        )}
        {!loading && !error && data && data.entries.length > 0 && (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-xxs uppercase tracking-wide text-muted">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="w-28 px-3 py-2 font-medium">Size</th>
                <th className="w-36 px-3 py-2 font-medium">Modified</th>
                <th className="w-16 px-3 py-2 font-medium">Mode</th>
                <th className="w-44 px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.path} className="group border-b border-line/60 last:border-0 hover:bg-surface/40">
                  <td className="px-4 py-1.5">
                    <button
                      onClick={() => (e.is_dir ? go(e.path) : openView(e))}
                      className="flex max-w-[480px] items-center gap-2 truncate text-left"
                      title={e.path}
                    >
                      {e.is_dir ? (
                        <Folder size={14} className="shrink-0 text-accent" />
                      ) : isTextish(e.name, e.path) ? (
                        <FileCode2 size={14} className="shrink-0 text-muted" />
                      ) : (
                        <FileIcon size={14} className="shrink-0 text-muted" />
                      )}
                      <span className="truncate">{e.name}</span>
                    </button>
                  </td>
                  <td className="px-3 py-1.5 text-muted">{fmtSize(e.size)}</td>
                  <td className="px-3 py-1.5 text-muted">{fmtTime(e.mtime)}</td>
                  <td className="px-3 py-1.5 font-mono text-xxs text-muted">{e.mode}</td>
                  <td className="px-4 py-1.5">
                    <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      {!e.is_dir && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => openView(e)} title="View">
                            <Eye size={13} />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => openEdit(e)} title="Edit">
                            <FileCode2 size={13} />
                          </Button>
                          <a
                            href={`/api/files/download?path=${encodeURIComponent(e.path)}`}
                            title="Download"
                            className="inline-flex h-7 items-center rounded px-2 text-muted hover:bg-surface hover:text-text"
                          >
                            <Download size={13} />
                          </a>
                        </>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => { setDeleteErr(""); setDeleting({ path: e.path, name: e.name, is_dir: e.is_dir }); }} title="Delete" className="hover:text-error">
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!loading && !error && data?.truncated && (
          <p className="border-t border-line px-4 py-2 text-xxs text-muted">Showing first 5,000 entries (directory truncated).</p>
        )}
      </Card>

      {/* view modal */}
      <Modal open={!!view || !!viewErr} onClose={() => { setView(null); setViewErr(""); }} title={view ? view.name : "View file"} width="760px">
        {viewErr && <ErrorBox message={viewErr} />}
        {view && view.binary && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <FileX size={26} className="text-muted" />
            <p className="text-[13px]">Binary file ({fmtSize(view.size)}) — no text preview available.</p>
            <a
              href={`/api/files/download?path=${encodeURIComponent(view.path)}`}
              className="inline-flex items-center gap-1.5 rounded border border-line bg-surface px-3 py-1.5 text-[13px] font-medium hover:bg-surface/70"
            >
              <Download size={13} /> Download
            </a>
          </div>
        )}
        {view && !view.binary && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-xxs text-muted">
              <Badge tone="muted">{view.encoding}</Badge>
              <span>{fmtSize(view.size)}</span>
              <span>·</span>
              <span>{fmtTime(view.mtime)}</span>
              {view.truncated && <Badge tone="warning">preview truncated at 512 KB</Badge>}
            </div>
            <pre className="max-h-[60vh] overflow-auto rounded border border-line bg-surface/40 p-3 font-mono text-xxs leading-relaxed whitespace-pre">
              {view.content}
            </pre>
          </div>
        )}
      </Modal>

      {/* edit modal */}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit ? `Edit — ${edit.name}` : "Edit"} width="760px">
        {edit && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-xxs text-muted">
              <span className="font-mono">{edit.path}</span>
              {edit.truncated && <Badge tone="warning">file &gt; 512 KB — editing disabled, use ssh</Badge>}
            </div>
            {editErr && <ErrorBox message={editErr} />}
            {!edit.binary && (
              <Textarea
                value={edit.content}
                onChange={(e) => setEdit({ ...edit, content: e.target.value })}
                spellCheck={false}
                disabled={edit.truncated}
                className="h-[55vh] resize-none font-mono text-xxs leading-relaxed"
              />
            )}
            <div className="flex items-center justify-end gap-2">
              <Button size="sm" onClick={() => setEdit(null)}>Cancel</Button>
              <Button size="sm" variant="primary" onClick={saveEdit} loading={saving} disabled={edit.binary || edit.truncated}>
                {edit.exists ? "Save changes" : "Create file"}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* delete modal */}
      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Delete" width="440px">
        {deleting && (
          <div className="flex flex-col gap-3">
            <p className="text-[13px]">
              Delete <span className="break-all font-mono text-xs font-semibold text-error">{deleting.path}</span>?
            </p>
            {deleting.is_dir && (
              <p className="rounded border border-error/30 bg-error/5 px-2.5 py-2 text-xs text-error">
                This is a <strong>directory</strong> — it will be deleted recursively, including all contents. This cannot be undone.
              </p>
            )}
            {deleteErr && <ErrorBox message={deleteErr} />}
            <div className="flex items-center justify-end gap-2">
              <Button size="sm" onClick={() => setDeleting(null)}>Cancel</Button>
              <Button size="sm" variant="danger" onClick={confirmDelete}>
                <Trash2 size={13} /> {deleting.is_dir ? "Delete directory" : "Delete file"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
