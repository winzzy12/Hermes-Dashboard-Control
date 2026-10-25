import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api } from "./api";
import type { User } from "./types";
import { Layout } from "./Layout";
import { ToastProvider, Spinner } from "./ui";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Chat from "./pages/Chat";
import Recents from "./pages/Recents";
import Skills from "./pages/Skills";
import Cronjobs from "./pages/Cronjobs";
import Models from "./pages/Models";
import System from "./pages/System";
import Settings from "./pages/Settings";

function RequireAuth({ user, children }: { user: User | null; children: React.ReactNode }) {
  const loc = useLocation();
  if (user === null) {
    return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  }
  return <>{children}</>;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<User>("/api/auth/me");
      localStorage.setItem("hd-user", me.display_name || me.username);
      setUser(me);
    } catch {
      setUser(null);
    } finally {
      setBooting(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const onUnauthorized = () => setUser(null);
    window.addEventListener("hd:unauthorized", onUnauthorized);
    return () => window.removeEventListener("hd:unauthorized", onUnauthorized);
  }, [refresh]);

  if (booting) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const DM = user?.default_model ?? "";
  const ANON = user ?? { id: 0, username: "", display_name: "", default_model: "" };

  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login onLogin={refresh} />} />
          <Route
            element={
              <RequireAuth user={user}>
                <Layout user={ANON} onLogout={async () => {
                  await api.post("/api/auth/logout").catch(() => {});
                  setUser(null);
                }} />
              </RequireAuth>
            }
          >
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/chat" element={<Chat defaultModel={DM} />} />
            <Route path="/chat/:convId" element={<Chat defaultModel={DM} />} />
            <Route path="/recents" element={<Recents />} />
            <Route path="/skills" element={<Skills />} />
            <Route path="/cronjobs" element={<Cronjobs />} />
            <Route path="/models" element={<Models />} />
            <Route path="/system" element={<System />} />
            <Route path="/settings" element={<Settings user={ANON} onUserUpdate={setUser} />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}
