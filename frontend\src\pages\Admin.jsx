import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Users, MessageSquare, Image, FolderKanban, Activity } from "lucide-react";
import api from "../lib/api";

const StatCard = ({ icon: Icon, label, value }) => (
  <div className="bg-[#121214] border border-white/5 rounded-2xl p-5">
    <div className="flex items-center gap-2 text-zinc-500 mb-3">
      <Icon size={16} strokeWidth={1.5} />
      <span className="font-mono text-[10px] uppercase tracking-widest">{label}</span>
    </div>
    <p className="font-heading text-4xl font-medium tracking-tight text-zinc-50">{value ?? "—"}</p>
  </div>
);

export default function Admin() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({});
  const [users, setUsers] = useState([]);

  useEffect(() => {
    api.get("/admin/stats").then((r) => setStats(r.data)).catch(() => {});
    api.get("/admin/users").then((r) => setUsers(r.data)).catch(() => {});
  }, []);

  return (
    <div className="min-h-screen max-w-6xl mx-auto px-6 py-10">
      <button data-testid="back-button" onClick={() => navigate("/chat")} className="flex items-center gap-2 text-zinc-500 hover:text-zinc-200 mb-8 text-sm transition-colors">
        <ArrowLeft size={16} /> Back to workspace
      </button>
      <div className="flex items-center gap-3 mb-2">
        <Activity className="text-orange-500" strokeWidth={1.5} />
        <h1 className="font-heading text-4xl font-medium tracking-tight">Admin Dashboard</h1>
      </div>
      <p className="text-zinc-500 mb-10">System overview and user management.</p>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-10">
        <StatCard icon={Users} label="Users" value={stats.users} />
        <StatCard icon={MessageSquare} label="Conversations" value={stats.conversations} />
        <StatCard icon={Activity} label="Messages" value={stats.messages} />
        <StatCard icon={Image} label="Images" value={stats.generated_images} />
        <StatCard icon={FolderKanban} label="Projects" value={stats.projects} />
      </div>

      <div className="bg-[#121214] border border-white/5 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-white/5">
          <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">Users</span>
        </div>
        <table className="w-full text-sm" data-testid="admin-users-table">
          <thead>
            <tr className="text-zinc-600 text-left font-mono text-[10px] uppercase tracking-wider">
              <th className="px-6 py-3 font-normal">Name</th>
              <th className="px-6 py-3 font-normal">Email</th>
              <th className="px-6 py-3 font-normal">Role</th>
              <th className="px-6 py-3 font-normal">Chats</th>
              <th className="px-6 py-3 font-normal">Messages</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-white/5">
                <td className="px-6 py-3 text-zinc-200">{u.name}</td>
                <td className="px-6 py-3 text-zinc-400">{u.email}</td>
                <td className="px-6 py-3">
                  <span className={`px-2 py-0.5 rounded-md text-xs font-mono ${u.role === "admin" ? "bg-orange-500/15 text-orange-400" : "bg-white/5 text-zinc-400"}`}>{u.role}</span>
                </td>
                <td className="px-6 py-3 text-zinc-400">{u.conversation_count}</td>
                <td className="px-6 py-3 text-zinc-400">{u.message_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
