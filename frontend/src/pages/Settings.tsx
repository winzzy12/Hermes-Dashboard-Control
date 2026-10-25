import { useEffect, useState, type FormEvent } from "react";
import { Sun, Moon } from "lucide-react";
import { api } from "../api";
import type { User } from "../types";
import { useTheme } from "../Layout";
import { Button, Card, CardHeader, Field, Input, useToast } from "../ui";

type SettingsPayload = { username: string; display_name: string; default_model: string; created_at: number };

export default function Settings({ user, onUserUpdate }: { user: User; onUserUpdate: (u: User) => void }) {
  const toast = useToast();
  const { theme, setTheme } = useThemeExt();
  const [profile, setProfile] = useState<SettingsPayload | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [pw, setPw] = useState({ current: "", next: "" });
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPw, setSavingPw] = useState(false);

  useEffect(() => {
    api.get<SettingsPayload>("/api/settings").then((s) => {
      setProfile(s);
      setDisplayName(s.display_name);
      setDefaultModel(s.default_model);
    });
    api
      .get<{ providers: { models: string[] }[] }>("/api/models")
      .then((d) => setModels(d.providers.flatMap((p) => p.models).sort()))
      .catch(() => {});
  }, []);

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const s = await api.patch<SettingsPayload>("/api/settings", {
        display_name: displayName,
        default_model: defaultModel,
      });
      setProfile(s);
      onUserUpdate({ ...user, display_name: s.display_name, default_model: s.default_model });
      toast.push("success", "Settings saved");
    } catch (err) {
      toast.push("error", err instanceof Error ? err.message : "Save failed");
    } finally {
      setSavingProfile(false);
    }
  };

  const changePw = async (e: FormEvent) => {
    e.preventDefault();
    setSavingPw(true);
    try {
      await api.post("/api/auth/password", { current_password: pw.current, new_password: pw.next });
      toast.push("success", "Password changed");
      setPw({ current: "", next: "" });
    } catch (err) {
      toast.push("error", err instanceof Error ? err.message : "Password change failed");
    } finally {
      setSavingPw(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <Card>
        <CardHeader title="Appearance" sub="Theme preference is stored per browser" />
        <div className="flex gap-2 p-4">
          {([
            ["light", Sun, "Light"],
            ["dark", Moon, "Dark"],
          ] as const).map(([value, Icon, label]) => (
            <button
              key={value}
              onClick={() => setTheme(value)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px] ${
                theme === value ? "border-accent text-accent" : "border-line text-muted hover:text-text"
              }`}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Profile" sub={`Signed in as @${user.username}${profile ? ` · since ${new Date(profile.created_at * 1000).toLocaleDateString()}` : ""}`} />
        <form onSubmit={saveProfile} className="space-y-3 p-4">
          <Field label="Display name">
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Wanz" />
          </Field>
          <Field label="Default chat model" hint="Preselected in the chat composer. Leave empty to use the agent default.">
            <Input value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)} list="hd-models" placeholder="(agent default)" />
          </Field>
          <datalist id="hd-models">
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <div className="flex justify-end">
            <Button size="sm" variant="primary" type="submit" loading={savingProfile}>Save</Button>
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader title="Security" sub={`Password change · session valid for 24h`} />
        <form onSubmit={changePw} className="space-y-3 p-4">
          <Field label="Current password">
            <Input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" required />
          </Field>
          <Field label="New password" hint="At least 8 characters">
            <Input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" required minLength={8} />
          </Field>
          <div className="flex justify-end">
            <Button size="sm" variant="primary" type="submit" loading={savingPw}>Change password</Button>
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader title="About" sub="Hermes Control" />
        <div className="space-y-1 p-4 text-xs text-muted">
          <p>Hermes Control v1.0.0 — dashboard for the local Hermes Agent.</p>
          <p>Integration: real mode (hermes CLI + agent state stores).</p>
          <p>Session cookie: HttpOnly, SameSite=Lax. Credentials never reach the browser.</p>
        </div>
      </Card>
    </div>
  );
}

function useThemeExt() {
  const { theme, toggle } = useTheme();
  return { theme, setTheme: (t: "light" | "dark") => {
    if (t !== theme) toggle();
  } };
}
