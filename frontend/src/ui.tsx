/** Small shared UI primitives — restrained Linear-style. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { X, CheckCircle2, AlertCircle, Info, Loader2 } from "lucide-react";

/* ------------------------------------------------------------------ Button */

export function Button({
  children,
  variant = "default",
  size = "md",
  className = "",
  loading,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "danger" | "ghost";
  size?: "sm" | "md";
  loading?: boolean;
}) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded font-medium disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap";
  const sizes = size === "sm" ? "h-7 px-2 text-xs" : "h-8 px-3 text-[13px]";
  const variants = {
    default: "border border-line bg-surface hover:bg-surface/70 text-text",
    primary: "bg-accent text-white hover:opacity-90 border border-transparent",
    danger: "border border-error/40 text-error hover:bg-error/10",
    ghost: "text-muted hover:text-text hover:bg-surface",
  }[variant];
  return (
    <button className={`${base} ${sizes} ${variants} ${className}`} disabled={loading || rest.disabled} {...rest}>
      {loading && <Loader2 size={13} className="animate-spin" />}
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ Inputs */

export function Input({ className = "", ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`h-8 w-full rounded border border-line bg-bg px-2.5 text-[13px] placeholder:text-muted/70 focus:border-accent ${className}`}
      {...rest}
    />
  );
}

export function Textarea({ className = "", ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`w-full rounded border border-line bg-bg px-2.5 py-1.5 text-[13px] placeholder:text-muted/70 focus:border-accent ${className}`}
      {...rest}
    />
  );
}

export function Select({ className = "", ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`h-8 w-full rounded border border-line bg-bg px-2 text-[13px] focus:border-accent ${className}`}
      {...rest}
    />
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xxs text-muted">{hint}</span>}
    </label>
  );
}

/* ------------------------------------------------------------------ Surfaces */

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-line bg-bg ${className}`}>{children}</div>;
}

export function CardHeader({ title, right, sub }: { title: ReactNode; right?: ReactNode; sub?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
      <div>
        <h2 className="text-[13px] font-semibold">{title}</h2>
        {sub && <p className="text-xxs text-muted">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

/* ------------------------------------------------------------------ Status */

const statusColor: Record<string, string> = {
  operational: "bg-success",
  enabled: "bg-success",
  active: "bg-success",
  done: "bg-success",
  degraded: "bg-warning",
  warning: "bg-warning",
  pending: "bg-warning",
  offline: "bg-error",
  error: "bg-error",
  failed: "bg-error",
  stopped: "bg-muted",
  unknown: "bg-muted/60",
  running: "bg-accent animate-pulse",
};

export function StatusDot({ status, label }: { status: string; label?: string }) {
  const color = statusColor[status.toLowerCase()] ?? "bg-muted/60";
  return (
    <span className="inline-flex items-center gap-1.5" title={status}>
      <span className={`inline-block h-2 w-2 rounded-full ${color}`} aria-hidden />
      <span className="text-xs capitalize text-muted">{label ?? status}</span>
    </span>
  );
}

export function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "accent" | "success" | "warning" | "error" }) {
  const tones = {
    muted: "border-line text-muted",
    accent: "border-accent/40 text-accent",
    success: "border-success/40 text-success",
    warning: "border-warning/40 text-warning",
    error: "border-error/40 text-error",
  }[tone];
  return (
    <span className={`inline-flex items-center rounded-full border px-1.5 py-px text-xxs font-medium ${tones}`}>
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ States */

export function Spinner({ className = "" }: { className?: string }) {
  return <Loader2 size={16} className={`animate-spin text-muted ${className}`} />;
}

export function Empty({ icon, title, sub }: { icon?: ReactNode; title: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 py-14 text-center">
      {icon && <div className="text-muted/70">{icon}</div>}
      <p className="text-[13px] font-medium">{title}</p>
      {sub && <p className="max-w-sm text-xs text-muted">{sub}</p>}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-error/30 bg-error/5 px-3 py-2.5 text-[13px] text-error">
      <span className="flex items-center gap-2"><AlertCircle size={14} /> {message}</span>
      {onRetry && <Button size="sm" onClick={onRetry}>Retry</Button>}
    </div>
  );
}

/* ------------------------------------------------------------------ Modal */

export function Modal({
  open,
  onClose,
  title,
  children,
  width = "400px",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[14vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fadein w-full rounded-xl border border-line bg-bg shadow-xl"
        style={{ maxWidth: width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <h3 className="text-[13px] font-semibold">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="text-muted hover:text-text">
            <X size={15} />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Toasts */

type Toast = { id: number; kind: "success" | "error" | "info"; text: string };
const ToastCtx = createContext<{ push: (kind: Toast["kind"], text: string) => void }>({ push: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="fadein flex items-center gap-2 rounded-lg border border-line bg-bg px-3 py-2 text-[13px] shadow-md"
          >
            {t.kind === "success" ? (
              <CheckCircle2 size={14} className="text-success" />
            ) : t.kind === "error" ? (
              <AlertCircle size={14} className="text-error" />
            ) : (
              <Info size={14} className="text-accent" />
            )}
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}
