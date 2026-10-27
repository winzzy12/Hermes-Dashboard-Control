import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, MessageSquare, History, Puzzle, Clock, Cpu, Folder, Activity, Settings as SettingsIcon,
  PanelLeft, Search, Sun, Moon, LogOut, Bot, Command, X, Menu, Server,
} from "lucide-react";
import type { User } from "./types";
const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, primary: true },
  { to: "/chat", label: "Chat", icon: MessageSquare, primary: true },
  { to: "/recents", label: "Recents", icon: History, primary: true },
  { to: "/skills", label: "Skills", icon: Puzzle, primary: true },
  { to: "/cronjobs", label: "Cronjobs", icon: Clock, primary: true },
  { to: "/models", label: "Models", icon: Cpu, primary: true },
  { to: "/files", label: "Files", icon: Folder, primary: true },
  { to: "/gateway", label: "Gateway", icon: Server, primary: false },
  { to: "/system", label: "System Status", icon: Activity, primary: false },
  { to: "/settings", label: "Settings", icon: SettingsIcon, primary: false },
];

/* ------------------------------------------------------------------ theme */

export function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">(
    () => (localStorage.getItem("hd-theme") as "light" | "dark") || "dark",
  );
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("hd-theme", theme);
  }, [theme]);
  return { theme, toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")) };
}

/* ------------------------------------------------------------------ command palette */

function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const items = NAV.filter((n) => n.label.toLowerCase().includes(q.toLowerCase()));
  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh]" onMouseDown={onClose}>
      <div
        className="fadein w-full max-w-md rounded-xl border border-line bg-bg shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Search size={14} className="text-muted" />
          <input
            ref={inputRef}
            value={q}
            placeholder="Go to page…"
            className="h-10 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted/70"
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") setSel((s) => Math.min(s + 1, items.length - 1));
              if (e.key === "ArrowUp") setSel((s) => Math.max(s - 1, 0));
              if (e.key === "Enter" && items[sel]) {
                nav(items[sel].to);
                onClose();
              }
              if (e.key === "Escape") onClose();
            }}
          />
          <kbd className="rounded border border-line px-1 text-xxs text-muted">esc</kbd>
        </div>
        <div className="max-h-72 overflow-y-auto p-1.5">
          {items.length === 0 && <p className="px-3 py-6 text-center text-xs text-muted">No matches</p>}
          {items.map((n, i) => (
            <button
              key={n.to}
              className={`flex w-full items-center gap-2.5 rounded px-3 py-2 text-left text-[13px] ${
                i === sel ? "bg-surface text-text" : "text-muted hover:bg-surface"
              }`}
              onMouseEnter={() => setSel(i)}
              onClick={() => {
                nav(n.to);
                onClose();
              }}
            >
              <n.icon size={14} />
              {n.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ layout */

export function Layout({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("hd-sidebar") === "collapsed");
  const [version, setVersion] = useState("");
  useEffect(() => {
    fetch("/api/health", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((d) => setVersion(d.version || ""))
      .catch(() => {});
  }, []);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { theme, toggle } = useTheme();
  const loc = useLocation();
  const nav = useNavigate();

  useEffect(() => setMobileOpen(false), [loc.pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const title = NAV.find((n) => loc.pathname.startsWith(n.to))?.label ?? "Hermes Control";

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-11 items-center gap-2 border-b border-line px-3">
        <Bot size={16} className="shrink-0 text-accent" />
        {!collapsed && <span className="truncate text-[13px] font-semibold">Hermes Control</span>}
      </div>
      <nav className="flex-1 overflow-y-auto px-1.5 py-2" aria-label="Primary">
        {NAV.filter((n) => n.primary).map((n) => (
          <NavItem key={n.to} {...n} collapsed={collapsed} />
        ))}
        <div className="my-2 border-t border-line" />
        {NAV.filter((n) => !n.primary).map((n) => (
          <NavItem key={n.to} {...n} collapsed={collapsed} />
        ))}
      </nav>
      <div className="border-t border-line p-2">
        <button
          onClick={() => {
            setMenuOpen(false);
            onLogout();
          }}
          className={`flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left text-xs text-muted hover:bg-surface hover:text-text ${
            collapsed ? "justify-center" : ""
          }`}
        >
          <LogOut size={14} />
          {!collapsed && "Sign out"}
        </button>
        {!collapsed && (
          <div className="mt-1 flex items-center gap-2 px-2 py-1">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-white">
              {(user.display_name || user.username).slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-medium">{user.display_name || user.username}</p>
              <p className="truncate text-xxs text-muted">@{user.username}</p>
            </div>
          </div>
        )}
        {version && (
          <p className={`mt-0.5 text-center text-xxs text-muted/60 ${collapsed ? "px-0" : "px-2"}`} title={`Hermes Control v${version}`}>
            v{version}
          </p>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-full">
      {/* desktop sidebar */}
      <aside
        className={`hidden shrink-0 border-r border-line bg-surface/40 md:block ${
          collapsed ? "w-12" : "w-52"
        }`}
      >
        {sidebar}
      </aside>
      {/* mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onMouseDown={() => setMobileOpen(false)} />
          <aside className="fadein absolute inset-y-0 left-0 w-56 border-r border-line bg-bg">{sidebar}</aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
          <button
            className="hidden text-muted hover:text-text md:block"
            aria-label="Toggle sidebar"
            onClick={() => {
              setCollapsed((c) => {
                localStorage.setItem("hd-sidebar", !c ? "collapsed" : "expanded");
                return !c;
              });
            }}
          >
            <PanelLeft size={15} />
          </button>
          <button className="text-muted hover:text-text md:hidden" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
            <Menu size={16} />
          </button>
          <h1 className="text-[13px] font-semibold">{title}</h1>
          <div className="flex-1" />
          <button
            onClick={() => setPaletteOpen(true)}
            className="hidden items-center gap-1.5 rounded border border-line px-2 py-1 text-xs text-muted hover:text-text sm:flex"
            aria-label="Open command palette"
          >
            <Search size={12} />
            Search
            <kbd className="rounded border border-line px-1 text-xxs">
              <Command size={9} className="mb-px inline" />K
            </kbd>
          </button>
          <button onClick={toggle} className="text-muted hover:text-text" aria-label="Toggle theme">
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <div className="relative">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-white"
              aria-label="User menu"
            >
              {(user.display_name || user.username).slice(0, 1).toUpperCase()}
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-30" onMouseDown={() => setMenuOpen(false)} />
                <div className="fadein absolute right-0 z-40 mt-1.5 w-44 rounded-lg border border-line bg-bg py-1 shadow-md">
                  <div className="border-b border-line px-3 py-2">
                    <p className="text-xs font-medium">{user.display_name || user.username}</p>
                    <p className="text-xxs text-muted">@{user.username}</p>
                  </div>
                  <button
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-muted hover:bg-surface hover:text-text"
                    onClick={() => {
                      setMenuOpen(false);
                      nav("/settings");
                    }}
                  >
                    <SettingsIcon size={13} /> Settings
                  </button>
                  <button
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-muted hover:bg-surface hover:text-text"
                    onClick={() => {
                      setMenuOpen(false);
                      onLogout();
                    }}
                  >
                    <LogOut size={13} /> Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      {mobileOpen && (
        <button className="fixed right-3 top-3 z-50 text-muted md:hidden" aria-label="Close navigation" onClick={() => setMobileOpen(false)}>
          <X size={18} />
        </button>
      )}
    </div>
  );
}

function NavItem({
  to, label, icon: Icon, collapsed,
}: { to: string; label: string; icon: typeof LayoutDashboard; collapsed: boolean }) {
  return (
    <NavLink
      to={to}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        `flex items-center gap-2.5 rounded px-2 py-1.5 text-[13px] ${
          isActive ? "bg-accent/10 font-medium text-accent" : "text-muted hover:bg-surface hover:text-text"
        } ${collapsed ? "justify-center" : ""}`
      }
    >
      <Icon size={15} className="shrink-0" />
      {!collapsed && label}
    </NavLink>
  );
}

export function Page({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto max-w-6xl p-4 md:p-6 ${className}`}>{children}</div>;
}
