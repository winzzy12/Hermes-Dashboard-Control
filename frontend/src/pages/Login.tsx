import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Bot, Eye, EyeOff } from "lucide-react";
import { api, ApiError } from "../api";
import { Button, Input, Field } from "../ui";

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [mode, setMode] = useState<"loading" | "setup" | "login">("loading");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Decide between first-run setup and login
  useEffect(() => {
    api
      .get<{ users_exist: boolean }>("/api/auth/status")
      .then((s) => setMode(s.users_exist ? "login" : "setup"))
      .catch(() => setMode("login"));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "setup") {
        await api.post("/api/auth/setup", { username, password });
      } else {
        await api.post("/api/auth/login", { username, password });
      }
      onLogin();
      nav(params.get("next") || "/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Connection failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-surface/50 px-4">
      <div className="w-full max-w-[320px]">
        <div className="mb-6 flex flex-col items-center gap-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Bot size={20} />
          </span>
          <h1 className="text-base font-semibold">Hermes Control</h1>
          <p className="text-xs text-muted">AI Control Dashboard</p>
        </div>
        <form
          onSubmit={submit}
          className="rounded-xl border border-line bg-bg p-4 shadow-sm"
          aria-label={mode === "setup" ? "Create admin account" : "Sign in"}
        >
          {mode === "setup" && (
            <p className="mb-3 rounded border border-warning/30 bg-warning/5 px-2.5 py-1.5 text-xxs text-warning">
              First run — create the admin account for this dashboard.
            </p>
          )}
          <div className="space-y-3">
            <Field label="Username">
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
                required
                minLength={3}
              />
            </Field>
            <Field label="Password">
              <div className="relative">
                <Input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === "setup" ? "new-password" : "current-password"}
                  required
                  minLength={8}
                  className="pr-8"
                />
                <button
                  type="button"
                  aria-label={showPw ? "Hide password" : "Show password"}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text"
                  onClick={() => setShowPw((s) => !s)}
                >
                  {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </Field>
            {error && (
              <p role="alert" className="text-xs text-error">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" loading={busy} className="w-full">
              {mode === "setup" ? "Create account" : "Sign in"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
