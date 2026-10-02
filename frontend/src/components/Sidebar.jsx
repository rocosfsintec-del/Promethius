import { useState } from "react";
import { Flame, Plus, Trash2, Brain, Library, FolderKanban, BookOpen, Clapperboard, Wrench, Clock, LogOut, Shield, Settings as SettingsIcon, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "../context/AuthContext";
import api from "../lib/api";
import VoiceSettings from "./VoiceSettings";
import { APP_VERSION } from "../lib/version";

const TOOLS = [
  { id: "memory", label: "Memory", icon: Brain },
  { id: "vault", label: "Vault", icon: Library },
  { id: "projects", label: "Projects", icon: FolderKanban },
  { id: "journal", label: "Journal", icon: BookOpen },
  { id: "studio", label: "Studio", icon: Clapperboard },
  { id: "tools", label: "Tools", icon: Wrench },
  { id: "schedule", label: "Auto", icon: Clock },
];

// Admin-only one-click updater. The backend launches update-promethius.bat
// (pull -> rebuild -> restart) and the server restarts, so we don't stream
// progress — we flip to a "Reload" state the user taps once it's back.
function UpdateButton() {
  const [state, setState] = useState("idle"); // idle | starting | restarting | error

  const run = async () => {
    if (state === "restarting") { window.location.reload(); return; }
    if (state === "starting") return;
    setState("starting");
    try {
      await api.post("/system/update");
      setState("restarting");
      toast.success("Updating Promethius… it will restart (~30s). Tap Reload when it's back.");
    } catch (e) {
      setState("error");
      toast.error(e?.response?.data?.detail || "Update failed to start.");
      setTimeout(() => setState("idle"), 4000);
    }
  };

  const label = { idle: "Update", starting: "…", restarting: "Reload", error: "Err" }[state];
  const color =
    state === "restarting" ? "text-green-400"
    : state === "error" ? "text-red-400"
    : state === "starting" ? "text-orange-400"
    : "text-zinc-500 hover:text-zinc-200";

  return (
    <button
      data-testid="update-promethius-button"
      onClick={run}
      disabled={state === "starting"}
      title={state === "restarting" ? "Click to reload once Promethius is back" : "Update Promethius (admin)"}
      className={`flex flex-col items-center gap-1 py-2 rounded-lg transition-colors hover:bg-white/5 ${color}`}
    >
      <RefreshCw size={17} strokeWidth={1.5} className={state === "starting" ? "animate-spin" : ""} />
      <span className="text-[9px] font-mono uppercase tracking-wide">{label}</span>
    </button>
  );
}

export default function Sidebar({ conversations, currentId, onSelect, onNew, onDelete, activeTool, setActiveTool }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [showSettings, setShowSettings] = useState(false);

  return (
    <div className="w-72 border-r border-white/5 bg-[#09090b] flex flex-col h-full shrink-0">
      <button
        data-testid="back-to-orb-button"
        onClick={() => navigate("/")}
        className="p-4 flex items-center gap-2.5 hover:bg-white/5 transition-colors"
        title="Return to the Orb"
      >
        <Flame className="text-orange-500" size={24} strokeWidth={1.5} />
        <span className="font-heading text-xl font-bold tracking-tight">Promethius</span>
        <span data-testid="app-version" className="ml-auto font-mono text-[10px] text-zinc-500 tracking-wide">{APP_VERSION}</span>
      </button>

      <div className="px-3">
        <button
          data-testid="new-chat-button"
          onClick={onNew}
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium transition-colors"
        >
          <Plus size={16} strokeWidth={2} /> New chat
        </button>
      </div>

      <div className="px-3 mt-5 grid grid-cols-4 gap-1">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            data-testid={`tool-${t.id}`}
            onClick={() => setActiveTool(activeTool === t.id ? null : t.id)}
            title={t.label}
            className={`flex flex-col items-center gap-1 py-2 rounded-lg transition-colors ${
              activeTool === t.id ? "bg-orange-500/10 text-orange-400" : "text-zinc-500 hover:text-zinc-200 hover:bg-white/5"
            }`}
          >
            <t.icon size={17} strokeWidth={1.5} />
            <span className="text-[9px] font-mono uppercase tracking-wide">{t.label}</span>
          </button>
        ))}
        {user?.role === "admin" && <UpdateButton />}
      </div>

      <div className="px-3 mt-5 mb-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-600">Conversations</span>
      </div>

      <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
        {conversations.length === 0 && (
          <p className="text-zinc-600 text-xs px-2 py-3">No conversations yet.</p>
        )}
        {conversations.map((c) => (
          <div
            key={c.id}
            data-testid={`conversation-${c.id}`}
            onClick={() => onSelect(c.id)}
            className={`group flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
              currentId === c.id ? "bg-white/5 text-zinc-100" : "text-zinc-400 hover:bg-white/5"
            }`}
          >
            <span className="flex-1 truncate text-sm">{c.title}</span>
            <button
              data-testid={`delete-conversation-${c.id}`}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(c.id);
              }}
              className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-all"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      <div className="p-3 border-t border-white/5">
        <div className="flex items-center gap-2 px-2 py-2">
          <div className="w-8 h-8 rounded-full bg-orange-500/15 border border-orange-500/20 flex items-center justify-center text-orange-400 text-sm font-semibold">
            {user?.name?.[0]?.toUpperCase() || "U"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-zinc-200 truncate">{user?.name}</p>
            <p className="text-[10px] text-zinc-600 font-mono uppercase">{user?.role}</p>
          </div>
          {user?.role === "admin" && (
            <button data-testid="admin-link" onClick={() => navigate("/admin")} className="text-zinc-500 hover:text-orange-400 transition-colors" title="Admin">
              <Shield size={16} strokeWidth={1.5} />
            </button>
          )}
          <button data-testid="settings-link" onClick={() => setShowSettings(true)} className="text-zinc-500 hover:text-orange-400 transition-colors" title="Voice settings">
            <SettingsIcon size={16} strokeWidth={1.5} />
          </button>
          <button data-testid="logout-button" onClick={logout} className="text-zinc-500 hover:text-red-400 transition-colors" title="Logout">
            <LogOut size={16} strokeWidth={1.5} />
          </button>
        </div>
      </div>
      {showSettings && <VoiceSettings onClose={() => setShowSettings(false)} />}
    </div>
  );
}
