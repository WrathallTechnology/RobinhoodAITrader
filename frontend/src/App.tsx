import { useEffect } from "react";
import { BrowserRouter, NavLink, Routes, Route } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchMe, fetchSetupRequired, logout } from "./api/client";
import AgentStatus from "./components/AgentStatus";
import Dashboard from "./pages/Dashboard";
import Strategies from "./pages/Strategies";
import History from "./pages/History";
import Settings from "./pages/Settings";
import Login from "./pages/Login";
import Setup from "./pages/Setup";
import {
  LayoutDashboard,
  Zap,
  History as HistoryIcon,
  Settings as SettingsIcon,
  LogOut,
} from "lucide-react";
import clsx from "clsx";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/strategies", label: "Strategies", icon: Zap },
  { to: "/history", label: "History", icon: HistoryIcon },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

function Shell() {
  const qc = useQueryClient();
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: fetchMe, staleTime: Infinity, retry: false });

  const handleLogout = async () => {
    await logout();
    qc.invalidateQueries({ queryKey: ["me"] });
  };

  return (
    <div className="flex h-screen overflow-hidden bg-gray-950">
      <aside className="w-56 flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col">
        <div className="px-5 py-5 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-brand flex items-center justify-center text-black font-bold text-sm">
              AI
            </div>
            <div>
              <div className="text-white font-semibold text-sm leading-tight">RH AI Trader</div>
              <div className="text-gray-500 text-xs">Autonomous trading</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 py-4 space-y-1 px-2">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                  isActive
                    ? "bg-gray-800 text-white"
                    : "text-gray-400 hover:text-white hover:bg-gray-800/60"
                )
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="px-3 pb-4 space-y-3">
          <AgentStatus />
          {/* Signed-in user */}
          {me?.username && (
            <div className="px-3 py-1.5 text-xs text-gray-500 truncate">
              Signed in as <span className="text-gray-300 font-medium">{me.username}</span>
              {me.is_admin && <span className="ml-1 text-brand">(admin)</span>}
            </div>
          )}
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-500 hover:text-white hover:bg-gray-800/60 transition-colors"
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/strategies" element={<Strategies />} />
          <Route path="/history" element={<History />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}

function Spinner() {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export default function App() {
  const qc = useQueryClient();

  const { data: setupData, isLoading: setupLoading } = useQuery({
    queryKey: ["setupRequired"],
    queryFn: fetchSetupRequired,
    retry: false,
    staleTime: Infinity,
  });

  const { data: meData, isLoading: meLoading } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    retry: false,
    staleTime: 5 * 60_000,
    enabled: setupData?.required === false,
  });

  useEffect(() => {
    const handler = () => qc.invalidateQueries({ queryKey: ["me"] });
    window.addEventListener("auth:expired", handler);
    return () => window.removeEventListener("auth:expired", handler);
  }, [qc]);

  if (setupLoading || meLoading) return <Spinner />;

  if (setupData?.required) return <Setup />;

  if (!meData?.authenticated) return <Login />;

  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  );
}
