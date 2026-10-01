import { useState, useEffect } from "react";
import {
  X, Plus, Trash2, Brain, Library, FolderKanban, BookOpen, Clapperboard,
  Loader2, Play, Upload, Sparkles, FileText, Video, Wrench, Clock,
  Terminal, Search, Link2, BarChart3, Wand2,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { toast } from "sonner";
import api from "../lib/api";

const TITLES = {
  memory: { label: "Personal Memory", icon: Brain },
  vault: { label: "Knowledge Vault", icon: Library },
  projects: { label: "Project Tracking", icon: FolderKanban },
  journal: { label: "Daily Journal", icon: BookOpen },
  studio: { label: "Creation Studio", icon: Clapperboard },
  tools: { label: "Power Tools", icon: Wrench },
  schedule: { label: "Autonomous Jobs", icon: Clock },
};

const Field = (props) => (
  <input
    {...props}
    className={`w-full bg-[#1c1c1f] border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-orange-500/50 transition-colors ${props.className || ""}`}
  />
);

const CAT_COLORS = {
  identity: "text-sky-400 bg-sky-500/10 border-sky-500/20",
  preference: "text-orange-400 bg-orange-500/10 border-orange-500/20",
  goal: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  project: "text-violet-400 bg-violet-500/10 border-violet-500/20",
  relationship: "text-pink-400 bg-pink-500/10 border-pink-500/20",
  fact: "text-zinc-400 bg-white/5 border-white/10",
};

function ImportanceBar({ value, onChange }) {
  const v = value || 3;
  return (
    <div className="flex items-center gap-0.5" data-testid="memory-importance">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          data-testid={`importance-dot-${n}`}
          onClick={() => onChange(n)}
          title={`Set importance ${n}/5`}
          className={`w-3 h-1.5 rounded-full transition-colors ${n <= v ? "bg-orange-500" : "bg-white/10 hover:bg-white/25"}`}
        />
      ))}
    </div>
  );
}

function Memory() {
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState(null);
  const [val, setVal] = useState("");
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("all");

  const load = async () => {
    const [m, s] = await Promise.all([
      api.get("/memory"),
      api.get("/memory/stats").catch(() => ({ data: null })),
    ]);
    setItems(m.data);
    setStats(s.data);
  };
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!val.trim()) return;
    await api.post("/memory", { content: val });
    setVal("");
    load();
  };
  const setImportance = async (id, importance) => {
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, importance } : x)));
    try { await api.patch(`/memory/${id}`, { importance }); } catch { toast.error("Could not update importance"); }
  };
  const del = async (id) => { await api.delete(`/memory/${id}`); load(); };

  const catOf = (m) => m.category || "fact";
  const q = query.trim().toLowerCase();
  const shown = items
    .filter((m) => cat === "all" || catOf(m) === cat)
    .filter((m) => !q || (m.content || "").toLowerCase().includes(q))
    .sort((a, b) => (b.importance || 3) - (a.importance || 3));
  const cats = ["all", ...Object.keys(stats?.by_category || {})];

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500 leading-relaxed">Facts Promethius remembers about you. The most important and relevant are injected into every conversation.</p>

      {stats && (
        <div data-testid="memory-stats" className="grid grid-cols-4 gap-2 bg-[#121214] border border-white/5 rounded-xl p-3 text-center">
          <div><div className="text-lg font-semibold text-orange-400">{stats.total}</div><div className="text-[10px] text-zinc-500">memories</div></div>
          <div><div className="text-lg font-semibold text-sky-400">{stats.total_recall ?? 0}</div><div className="text-[10px] text-zinc-500">recalls</div></div>
          <div><div className="text-lg font-semibold text-emerald-400">{stats.by_source?.auto ?? 0}</div><div className="text-[10px] text-zinc-500">auto</div></div>
          <div><div className="text-lg font-semibold text-violet-400">{stats.by_source?.manual ?? 0}</div><div className="text-[10px] text-zinc-500">manual</div></div>
        </div>
      )}

      <div className="flex gap-2">
        <Field data-testid="memory-input" value={val} onChange={(e) => setVal(e.target.value)} placeholder="e.g. I prefer concise answers" onKeyDown={(e) => e.key === "Enter" && add()} />
        <button data-testid="add-memory-button" onClick={add} className="shrink-0 h-9 w-9 rounded-lg bg-orange-600 hover:bg-orange-500 flex items-center justify-center"><Plus size={16} /></button>
      </div>

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
        <Field data-testid="memory-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search memories" className="pl-9" />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {cats.map((c) => (
          <button
            key={c}
            data-testid={`memory-cat-${c}`}
            onClick={() => setCat(c)}
            className={`text-[11px] px-2 py-1 rounded-full border capitalize transition-colors ${cat === c ? "bg-orange-600 border-orange-500 text-white" : "bg-white/5 border-white/10 text-zinc-400 hover:text-zinc-200"}`}
          >
            {c}{c !== "all" && stats?.by_category?.[c] ? ` ${stats.by_category[c]}` : ""}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {shown.map((m) => {
          const c = catOf(m);
          return (
            <div key={m.id} data-testid="memory-fact-item" className="group bg-[#121214] border border-white/5 rounded-xl p-3 space-y-2">
              <div className="flex items-start gap-2">
                <Brain size={14} className="text-orange-500/70 mt-0.5 shrink-0" />
                <span className="flex-1 text-sm text-zinc-300">{m.content}</span>
                <button onClick={() => del(m.id)} className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400"><Trash2 size={14} /></button>
              </div>
              <div className="flex items-center justify-between pl-6">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border capitalize ${CAT_COLORS[c] || CAT_COLORS.fact}`}>{c}</span>
                  <span className="text-[10px] text-zinc-600">{m.auto ? "auto" : "manual"}</span>
                  {!!m.recall_count && <span className="text-[10px] text-sky-500/80">· recalled {m.recall_count}×</span>}
                </div>
                <ImportanceBar value={m.importance} onChange={(n) => setImportance(m.id, n)} />
              </div>
            </div>
          );
        })}
        {shown.length === 0 && <p className="text-zinc-600 text-sm">No memories{q || cat !== "all" ? " match" : " yet"}.</p>}
      </div>
    </div>
  );
}

function Vault() {
  const [data, setData] = useState({ notes: [], files: [] });
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [uploading, setUploading] = useState(false);
  const load = () => api.get("/vault").then((r) => setData(r.data));
  useEffect(() => { load(); }, []);
  const addNote = async () => {
    if (!title.trim()) return;
    await api.post("/vault/note", { title, content });
    setTitle(""); setContent(""); load();
  };
  const upload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("vault", "true");
    try { await api.post("/upload", fd); toast.success("Added to vault"); load(); }
    catch { toast.error("Upload failed"); }
    finally { setUploading(false); e.target.value = ""; }
  };
  return (
    <div className="space-y-5">
      <label data-testid="vault-upload-zone" className="border-2 border-dashed border-white/10 rounded-2xl p-6 flex flex-col items-center justify-center text-center hover:border-orange-500/30 hover:bg-orange-500/5 transition-colors cursor-pointer">
        {uploading ? <Loader2 className="animate-spin text-orange-500" /> : <Upload size={22} className="text-zinc-500 mb-2" strokeWidth={1.5} />}
        <span className="text-sm text-zinc-400">Upload document (PDF, DOCX, TXT)</span>
        <input type="file" className="hidden" onChange={upload} />
      </label>

      <div className="space-y-2">
        <Field data-testid="note-title-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Note title" />
        <textarea data-testid="note-content-input" value={content} onChange={(e) => setContent(e.target.value)} placeholder="Write a note..." rows={3} className="w-full bg-[#1c1c1f] border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-orange-500/50 resize-none" />
        <button data-testid="add-note-button" onClick={addNote} className="w-full py-2 rounded-lg bg-[#1c1c1f] hover:bg-[#27272a] border border-white/10 text-sm text-zinc-200">Save note</button>
      </div>

      {data.files.map((f) => (
        <div key={f.id} className="group flex items-center gap-2 bg-[#121214] border border-white/5 rounded-xl p-3">
          <FileText size={15} className="text-orange-500/70 shrink-0" />
          <span className="flex-1 text-sm text-zinc-300 truncate">{f.original_filename}</span>
          <button onClick={async () => { await api.delete(`/vault/file/${f.id}`); load(); }} className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400"><Trash2 size={14} /></button>
        </div>
      ))}
      {data.notes.map((n) => (
        <div key={n.id} className="group bg-[#121214] border border-white/5 rounded-xl p-3">
          <div className="flex items-center gap-2">
            <span className="flex-1 text-sm font-medium text-zinc-200">{n.title}</span>
            <button onClick={async () => { await api.delete(`/vault/note/${n.id}`); load(); }} className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400"><Trash2 size={14} /></button>
          </div>
          {n.content && <p className="text-xs text-zinc-500 mt-1 whitespace-pre-wrap">{n.content}</p>}
        </div>
      ))}
    </div>
  );
}

function Projects() {
  const [projects, setProjects] = useState([]);
  const [name, setName] = useState("");
  const [taskInputs, setTaskInputs] = useState({});
  const [executing, setExecuting] = useState(null);
  const load = () => api.get("/projects").then((r) => setProjects(r.data));
  useEffect(() => { load(); }, []);
  const addProject = async () => { if (!name.trim()) return; await api.post("/projects", { name }); setName(""); load(); };
  const addTask = async (pid) => {
    const t = taskInputs[pid];
    if (!t?.trim()) return;
    await api.post("/tasks", { project_id: pid, title: t });
    setTaskInputs((s) => ({ ...s, [pid]: "" }));
    load();
  };
  const execute = async (tid) => {
    setExecuting(tid);
    try { const r = await api.post(`/tasks/${tid}/execute`); toast.success("Task executed by Promethius"); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Execution failed"); }
    finally { setExecuting(null); }
  };
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Field data-testid="project-name-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="New project" onKeyDown={(e) => e.key === "Enter" && addProject()} />
        <button data-testid="add-project-button" onClick={addProject} className="shrink-0 h-9 w-9 rounded-lg bg-orange-600 hover:bg-orange-500 flex items-center justify-center"><Plus size={16} /></button>
      </div>
      {projects.map((p) => (
        <div key={p.id} data-testid={`project-${p.id}`} className="bg-[#121214] border border-white/5 rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <FolderKanban size={15} className="text-orange-500/70" />
            <span className="flex-1 text-sm font-semibold text-zinc-100">{p.name}</span>
            <button onClick={async () => { await api.delete(`/projects/${p.id}`); load(); }} className="text-zinc-600 hover:text-red-400"><Trash2 size={14} /></button>
          </div>
          {p.tasks?.map((t) => (
            <div key={t.id} className="bg-[#1c1c1f] rounded-lg p-2.5 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className={`flex-1 text-sm ${t.status === "done" ? "text-zinc-500 line-through" : "text-zinc-300"}`}>{t.title}</span>
                <button data-testid={`execute-task-${t.id}`} onClick={() => execute(t.id)} disabled={executing === t.id} className="text-orange-500 hover:text-orange-400" title="Let Promethius execute">
                  {executing === t.id ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                </button>
                <button onClick={async () => { await api.delete(`/tasks/${t.id}`); load(); }} className="text-zinc-600 hover:text-red-400"><Trash2 size={13} /></button>
              </div>
              {t.result && <p className="text-xs text-zinc-400 bg-black/30 rounded p-2 whitespace-pre-wrap max-h-40 overflow-y-auto">{t.result}</p>}
            </div>
          ))}
          <div className="flex gap-2">
            <Field data-testid={`task-input-${p.id}`} value={taskInputs[p.id] || ""} onChange={(e) => setTaskInputs((s) => ({ ...s, [p.id]: e.target.value }))} placeholder="Add task" onKeyDown={(e) => e.key === "Enter" && addTask(p.id)} className="text-xs" />
            <button onClick={() => addTask(p.id)} className="shrink-0 h-9 px-3 rounded-lg bg-[#1c1c1f] border border-white/10 text-xs text-zinc-300">Add</button>
          </div>
        </div>
      ))}
      {projects.length === 0 && <p className="text-zinc-600 text-sm">No projects yet.</p>}
    </div>
  );
}

function Journal() {
  const [entries, setEntries] = useState([]);
  const [content, setContent] = useState("");
  const load = () => api.get("/journal").then((r) => setEntries(r.data));
  useEffect(() => { load(); }, []);
  const add = async () => { if (!content.trim()) return; await api.post("/journal", { content }); setContent(""); load(); };
  return (
    <div className="space-y-4">
      <textarea data-testid="journal-input" value={content} onChange={(e) => setContent(e.target.value)} placeholder="What's on your mind today?" rows={4} className="w-full bg-[#1c1c1f] border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-orange-500/50 resize-none" />
      <button data-testid="add-journal-button" onClick={add} className="w-full py-2 rounded-lg bg-orange-600 hover:bg-orange-500 text-sm text-white">Save entry</button>
      <div className="space-y-2">
        {entries.map((e) => (
          <div key={e.id} className="group bg-[#121214] border border-white/5 rounded-xl p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-600">{e.date}</span>
              <button onClick={async () => { await api.delete(`/journal/${e.id}`); load(); }} className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400"><Trash2 size={13} /></button>
            </div>
            <p className="text-sm text-zinc-300 whitespace-pre-wrap">{e.content}</p>
          </div>
        ))}
        {entries.length === 0 && <p className="text-zinc-600 text-sm">No entries yet.</p>}
      </div>
    </div>
  );
}

function Studio() {
  const [imgPrompt, setImgPrompt] = useState("");
  const [imgUrl, setImgUrl] = useState(null);
  const [imgLoading, setImgLoading] = useState(false);
  const [editPrompt, setEditPrompt] = useState("");
  const [editUrl, setEditUrl] = useState(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editFile, setEditFile] = useState(null);
  const [vidPrompt, setVidPrompt] = useState("");
  const [vidUrl, setVidUrl] = useState(null);
  const [vidLoading, setVidLoading] = useState(false);
  const [refFiles, setRefFiles] = useState([]);

  const genImage = async () => {
    if (!imgPrompt.trim()) return;
    setImgLoading(true); setImgUrl(null);
    try {
      const r = await api.post("/image/generate", { prompt: imgPrompt });
      const blob = await api.get(r.data.url, { responseType: "blob" });
      setImgUrl(URL.createObjectURL(blob.data));
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
    finally { setImgLoading(false); }
  };

  const editImage = async () => {
    if (!editFile || !editPrompt.trim()) { toast.error("Pick an image and describe the edit"); return; }
    setEditLoading(true); setEditUrl(null);
    const fd = new FormData();
    fd.append("file", editFile);
    fd.append("prompt", editPrompt);
    try {
      const r = await api.post("/image/edit", fd);
      const blob = await api.get(r.data.url, { responseType: "blob" });
      setEditUrl(URL.createObjectURL(blob.data));
    } catch (e) { toast.error(e?.response?.data?.detail || "Edit failed (needs OpenAI billing)"); }
    finally { setEditLoading(false); }
  };

  const uploadRef = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    const r = await api.post("/upload", fd);
    const full = `${api.defaults.baseURL.replace(/\/api$/, "")}${r.data.url}`;
    setRefFiles((f) => [...f, { name: r.data.original_filename, url: full }]);
    e.target.value = "";
  };

  const genVideo = async () => {
    if (!vidPrompt.trim()) return;
    setVidLoading(true); setVidUrl(null);
    try {
      const r = await api.post("/video/generate", { prompt: vidPrompt, reference_image_urls: refFiles.map((f) => f.url) });
      setVidUrl(r.data.url);
    } catch (e) { toast.error(e?.response?.data?.detail || "Video generation unavailable"); }
    finally { setVidLoading(false); }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-200"><Sparkles size={15} className="text-orange-500" /> Image generation</div>
        <textarea data-testid="studio-image-prompt" value={imgPrompt} onChange={(e) => setImgPrompt(e.target.value)} placeholder="A phoenix rising over a neon city..." rows={2} className="w-full bg-[#1c1c1f] border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-orange-500/50 resize-none" />
        <button data-testid="studio-generate-image" onClick={genImage} disabled={imgLoading} className="w-full py-2 rounded-lg bg-orange-600 hover:bg-orange-500 text-sm text-white flex items-center justify-center gap-2 disabled:opacity-60">
          {imgLoading && <Loader2 size={15} className="animate-spin" />} Generate image
        </button>
        {imgUrl && <img src={imgUrl} alt="generated" className="rounded-xl border border-white/10 w-full" />}
      </div>

      <div className="h-px bg-white/5" />

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-200"><Wand2 size={15} className="text-orange-500" /> Image editing</div>
        <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer hover:text-zinc-200">
          <Upload size={13} /> {editFile ? editFile.name : "Choose image to edit"}
          <input data-testid="studio-edit-file" type="file" accept="image/*" className="hidden" onChange={(e) => setEditFile(e.target.files[0])} />
        </label>
        <textarea data-testid="studio-edit-prompt" value={editPrompt} onChange={(e) => setEditPrompt(e.target.value)} placeholder="Make the sky a fiery orange sunset..." rows={2} className="w-full bg-[#1c1c1f] border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-orange-500/50 resize-none" />
        <button data-testid="studio-edit-image" onClick={editImage} disabled={editLoading} className="w-full py-2 rounded-lg bg-orange-600 hover:bg-orange-500 text-sm text-white flex items-center justify-center gap-2 disabled:opacity-60">
          {editLoading && <Loader2 size={15} className="animate-spin" />} Edit image
        </button>
        {editUrl && <img src={editUrl} alt="edited" className="rounded-xl border border-white/10 w-full" />}
      </div>

      <div className="h-px bg-white/5" />

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-200"><Video size={15} className="text-orange-500" /> Video generation</div>
        <textarea data-testid="studio-video-prompt" value={vidPrompt} onChange={(e) => setVidPrompt(e.target.value)} placeholder="Camera flies through a burning forest at dusk..." rows={2} className="w-full bg-[#1c1c1f] border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-orange-500/50 resize-none" />
        <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer hover:text-zinc-200">
          <Upload size={13} /> Add reference image (image-to-video)
          <input type="file" accept="image/*" className="hidden" onChange={uploadRef} />
        </label>
        {refFiles.map((f, i) => <p key={i} className="text-xs text-zinc-500 truncate">• {f.name}</p>)}
        <button data-testid="studio-generate-video" onClick={genVideo} disabled={vidLoading} className="w-full py-2 rounded-lg bg-orange-600 hover:bg-orange-500 text-sm text-white flex items-center justify-center gap-2 disabled:opacity-60">
          {vidLoading && <Loader2 size={15} className="animate-spin" />} Generate video
        </button>
        {vidLoading && <p className="text-[11px] text-zinc-500">Rendering video — this can take up to a minute.</p>}
        {vidUrl && <video src={vidUrl} controls className="rounded-xl border border-white/10 w-full" />}
      </div>
    </div>
  );
}

function Tools() {
  const [tab, setTab] = useState("code");
  const tabs = [
    { id: "code", label: "Code", icon: Terminal },
    { id: "research", label: "Research", icon: Search },
    { id: "url", label: "URL", icon: Link2 },
    { id: "data", label: "Data", icon: BarChart3 },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-1 bg-[#121214] rounded-lg p-1">
        {tabs.map((t) => (
          <button key={t.id} data-testid={`tools-tab-${t.id}`} onClick={() => setTab(t.id)} className={`flex flex-col items-center gap-1 py-2 rounded-md text-[10px] transition-colors ${tab === t.id ? "bg-orange-500/15 text-orange-400" : "text-zinc-500 hover:text-zinc-200"}`}>
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>
      {tab === "code" && <CodeTool />}
      {tab === "research" && <ResearchTool />}
      {tab === "url" && <UrlTool />}
      {tab === "data" && <DataTool />}
    </div>
  );
}

function CodeTool() {
  const [code, setCode] = useState("print('Hello from Promethius')");
  const [out, setOut] = useState(null);
  const [loading, setLoading] = useState(false);
  const run = async () => {
    setLoading(true); setOut(null);
    try { const r = await api.post("/tools/run-code", { code }); setOut(r.data); }
    catch (e) { toast.error("Run failed"); }
    finally { setLoading(false); }
  };
  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-500">Promethius runs real Python (20s limit).</p>
      <textarea data-testid="code-input" value={code} onChange={(e) => setCode(e.target.value)} rows={8} spellCheck={false} className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-zinc-100 focus:outline-none focus:border-orange-500/50 resize-none" />
      <button data-testid="run-code-button" onClick={run} disabled={loading} className="w-full py-2 rounded-lg bg-orange-600 hover:bg-orange-500 text-sm text-white flex items-center justify-center gap-2 disabled:opacity-60">
        {loading ? <Loader2 size={15} className="animate-spin" /> : <Play size={14} />} Run code
      </button>
      {out && (
        <div className="space-y-1">
          {out.stdout && <pre className="bg-black/40 rounded-lg p-3 text-xs font-mono text-green-300 whitespace-pre-wrap max-h-48 overflow-auto">{out.stdout}</pre>}
          {out.stderr && <pre className="bg-black/40 rounded-lg p-3 text-xs font-mono text-red-300 whitespace-pre-wrap max-h-48 overflow-auto">{out.stderr}</pre>}
          {!out.stdout && !out.stderr && <p className="text-xs text-zinc-500">No output.</p>}
        </div>
      )}
    </div>
  );
}

function ResearchTool() {
  const [q, setQ] = useState("");
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(false);
  const go = async () => {
    if (!q.trim()) return;
    setLoading(true); setRes(null);
    try { const r = await api.post("/tools/research", { query: q }); setRes(r.data); }
    catch (e) { toast.error(e?.response?.data?.detail || "Research unavailable"); }
    finally { setLoading(false); }
  };
  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-500">Multi-source web research with citations.</p>
      <textarea data-testid="research-input" value={q} onChange={(e) => setQ(e.target.value)} rows={2} placeholder="Research question..." className="w-full bg-[#1c1c1f] border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-orange-500/50 resize-none" />
      <button data-testid="research-button" onClick={go} disabled={loading} className="w-full py-2 rounded-lg bg-orange-600 hover:bg-orange-500 text-sm text-white flex items-center justify-center gap-2 disabled:opacity-60">
        {loading && <Loader2 size={15} className="animate-spin" />} Research
      </button>
      {res && (
        <div className="space-y-3">
          <div className="bg-[#121214] border border-white/5 rounded-xl p-3 text-sm text-zinc-300 whitespace-pre-wrap max-h-80 overflow-auto prose-promethius">{res.report}</div>
          <div className="space-y-1">
            {res.sources?.map((s, i) => (
              <a key={i} href={s.url} target="_blank" rel="noreferrer" className="block text-xs text-orange-400/80 hover:text-orange-400 truncate">[{i + 1}] {s.title}</a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function UrlTool() {
  const [url, setUrl] = useState("");
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(false);
  const go = async () => {
    if (!url.trim()) return;
    setLoading(true); setRes(null);
    try { const r = await api.post("/tools/read-url", { url, summarize: true }); setRes(r.data); }
    catch (e) { toast.error(e?.response?.data?.detail || "Could not read URL"); }
    finally { setLoading(false); }
  };
  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-500">Paste any link — Promethius reads & summarizes it.</p>
      <input data-testid="url-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." className="w-full bg-[#1c1c1f] border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-orange-500/50" />
      <button data-testid="read-url-button" onClick={go} disabled={loading} className="w-full py-2 rounded-lg bg-orange-600 hover:bg-orange-500 text-sm text-white flex items-center justify-center gap-2 disabled:opacity-60">
        {loading && <Loader2 size={15} className="animate-spin" />} Read & summarize
      </button>
      {res?.summary && <div className="bg-[#121214] border border-white/5 rounded-xl p-3 text-sm text-zinc-300 whitespace-pre-wrap max-h-80 overflow-auto prose-promethius">{res.summary}</div>}
    </div>
  );
}

function DataTool() {
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(false);
  const upload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setLoading(true); setRes(null);
    const fd = new FormData();
    fd.append("file", file);
    try { const r = await api.post("/tools/analyze-data", fd); setRes(r.data); }
    catch (er) { toast.error(er?.response?.data?.detail || "Analysis failed"); }
    finally { setLoading(false); e.target.value = ""; }
  };
  return (
    <div className="space-y-3">
      <label data-testid="data-upload-zone" className="border-2 border-dashed border-white/10 rounded-2xl p-6 flex flex-col items-center justify-center text-center hover:border-orange-500/30 hover:bg-orange-500/5 transition-colors cursor-pointer">
        {loading ? <Loader2 className="animate-spin text-orange-500" /> : <Upload size={20} className="text-zinc-500 mb-2" strokeWidth={1.5} />}
        <span className="text-sm text-zinc-400">Upload CSV / Excel</span>
        <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={upload} />
      </label>
      {res && (
        <div className="space-y-3">
          <p className="text-xs text-zinc-500 font-mono">{res.rows} rows · {res.columns.length} columns</p>
          {res.chart && (
            <div className="bg-[#121214] border border-white/5 rounded-xl p-2 h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={res.chart.data}>
                  <XAxis dataKey="name" hide />
                  <YAxis hide />
                  <Tooltip contentStyle={{ background: "#121214", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="value" fill="#ea580c" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {res.insight && <div className="bg-[#121214] border border-white/5 rounded-xl p-3 text-sm text-zinc-300 whitespace-pre-wrap max-h-64 overflow-auto prose-promethius">{res.insight}</div>}
        </div>
      )}
    </div>
  );
}

function Schedule() {
  const [jobs, setJobs] = useState([]);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [interval, setIntervalMin] = useState(60);
  const [running, setRunning] = useState(null);
  const load = () => api.get("/scheduled").then((r) => setJobs(r.data));
  useEffect(() => { load(); }, []);
  const add = async () => {
    if (!title.trim() || !prompt.trim()) { toast.error("Title and instruction required"); return; }
    await api.post("/scheduled", { title, prompt, interval_minutes: Number(interval) });
    setTitle(""); setPrompt(""); load();
    toast.success("Scheduled job created");
  };
  const runNow = async (id) => {
    setRunning(id);
    try { await api.post(`/scheduled/${id}/run`); toast.success("Ran now"); load(); }
    catch { toast.error("Run failed"); }
    finally { setRunning(null); }
  };
  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500 leading-relaxed">Promethius runs these on a timer, autonomously.</p>
      <div className="space-y-2">
        <input data-testid="schedule-title-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Job name (e.g. Daily AI news)" className="w-full bg-[#1c1c1f] border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-orange-500/50" />
        <textarea data-testid="schedule-prompt-input" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} placeholder="Instruction for Promethius..." className="w-full bg-[#1c1c1f] border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-orange-500/50 resize-none" />
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">Every</span>
          <input data-testid="schedule-interval-input" type="number" min={1} value={interval} onChange={(e) => setIntervalMin(e.target.value)} className="w-20 bg-[#1c1c1f] border border-white/10 rounded-lg px-2 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-orange-500/50" />
          <span className="text-xs text-zinc-500">minutes</span>
        </div>
        <button data-testid="add-schedule-button" onClick={add} className="w-full py-2 rounded-lg bg-orange-600 hover:bg-orange-500 text-sm text-white">Create job</button>
      </div>
      <div className="space-y-2">
        {jobs.map((j) => (
          <div key={j.id} className="bg-[#121214] border border-white/5 rounded-xl p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Clock size={14} className="text-orange-500/70" />
              <span className="flex-1 text-sm font-medium text-zinc-100">{j.title}</span>
              <span className="font-mono text-[10px] text-zinc-600">{j.interval_minutes}m</span>
              <button data-testid={`run-schedule-${j.id}`} onClick={() => runNow(j.id)} disabled={running === j.id} className="text-orange-500 hover:text-orange-400" title="Run now">
                {running === j.id ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              </button>
              <button onClick={async () => { await api.delete(`/scheduled/${j.id}`); load(); }} className="text-zinc-600 hover:text-red-400"><Trash2 size={13} /></button>
            </div>
            {j.runs?.[0] && <p className="text-xs text-zinc-400 bg-black/30 rounded p-2 whitespace-pre-wrap max-h-32 overflow-auto">{j.runs[0].output}</p>}
          </div>
        ))}
        {jobs.length === 0 && <p className="text-zinc-600 text-sm">No scheduled jobs yet.</p>}
      </div>
    </div>
  );
}

const TOOLS = { memory: Memory, vault: Vault, projects: Projects, journal: Journal, studio: Studio, tools: Tools, schedule: Schedule };

export default function RightPanel({ tool, onClose }) {
  const meta = TITLES[tool];
  const Comp = TOOLS[tool];
  if (!Comp) return null;
  return (
    <div className="w-80 border-l border-white/5 bg-[#09090b]/60 backdrop-blur-xl flex flex-col h-full shrink-0 animate-fade-up">
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
        <div className="flex items-center gap-2">
          <meta.icon size={17} className="text-orange-500" strokeWidth={1.5} />
          <span className="font-heading text-lg font-medium tracking-tight">{meta.label}</span>
        </div>
        <button data-testid="close-panel-button" onClick={onClose} className="text-zinc-500 hover:text-zinc-200"><X size={18} /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-5">
        <Comp />
      </div>
    </div>
  );
}
