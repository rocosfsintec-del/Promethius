import { useEffect, useState } from "react";
import { X, Check, Loader2, Volume2, Trash2, Mic2, ScrollText, Users, Shield, Fingerprint, Plus, Pencil, Palette } from "lucide-react";
import { startRegistration } from "@simplewebauthn/browser";
import { toast } from "sonner";
import api from "../lib/api";
import { DEFAULT_ORB, ORB_PRESETS, ORB_MOODS } from "../lib/orbConfig";
import InstallButton from "./InstallButton";

const TABS = [
  { id: "voice", label: "Voice", icon: Mic2 },
  { id: "appearance", label: "Orb", icon: Palette },
  { id: "directives", label: "Laws", icon: ScrollText },
  { id: "people", label: "People", icon: Users },
  { id: "security", label: "Keys", icon: Fingerprint },
];

function Slider({ label, value, min, max, step, onChange }) {
  return (
    <div>
      <div className="flex justify-between text-xs text-zinc-400 mb-1">
        <span>{label}</span><span className="font-mono text-zinc-600">{Number(value).toFixed(2)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-orange-500" />
    </div>
  );
}

function AppearanceTab() {
  const [orb, setOrb] = useState(DEFAULT_ORB);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api.get("/auth/me").then((r) => setOrb({ ...DEFAULT_ORB, ...(r.data.orb || {}) })).finally(() => setLoading(false));
  }, []);
  const update = (patch) => {
    const next = { ...orb, ...patch };
    setOrb(next);
    setLocked(false);
    window.dispatchEvent(new CustomEvent("orb-config", { detail: next }));
  };
  const apply = async () => {
    setSaving(true);
    try { await api.put("/settings", { orb }); setLocked(true); toast.success("Settings applied & locked in"); }
    catch { toast.error("Save failed"); }
    finally { setSaving(false); }
  };
  if (loading) return <div className="flex justify-center py-8"><Loader2 className="animate-spin text-orange-500" /></div>;
  return (
    <div className="space-y-5">
      <p className="text-xs text-zinc-500">Changes preview live on the orb behind this panel. Save to keep them.</p>
      <div>
        <p className="text-xs text-zinc-400 mb-2">Moods <span className="text-zinc-600">— one tap sets the whole vibe</span></p>
        <div className="grid grid-cols-3 gap-2">
          {ORB_MOODS.map((mo) => {
            const active = orb.color === mo.config.color && orb.chaos === mo.config.chaos && orb.lightning === mo.config.lightning;
            return (
              <button key={mo.label} data-testid={`orb-mood-${mo.label}`} onClick={() => update(mo.config)}
                className={`py-2 rounded-lg text-xs font-medium border transition-all ${active ? "border-orange-500 text-orange-300 bg-orange-500/10" : "border-white/10 text-zinc-300 hover:border-white/25"}`}
                style={{ boxShadow: active ? `0 0 14px ${mo.config.color}55` : "none" }}>
                {mo.label}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <p className="text-xs text-zinc-400 mb-2">Color</p>
        <div className="grid grid-cols-3 gap-2">
          {ORB_PRESETS.map((p) => (
            <button key={p.color} data-testid={`orb-color-${p.color}`} onClick={() => update({ color: p.color })}
              className={`h-9 rounded-lg border transition-all ${orb.color === p.color ? "border-white scale-105" : "border-white/10"}`}
              style={{ background: `radial-gradient(circle at 50% 40%, #fff, ${p.color} 70%)` }} title={p.label} />
          ))}
        </div>
        <div className="flex items-center gap-2 mt-2">
          <span className="text-xs text-zinc-500">Custom</span>
          <input data-testid="orb-color-custom" type="color" value={orb.color} onChange={(e) => update({ color: e.target.value })}
            className="h-8 w-12 bg-transparent border border-white/10 rounded cursor-pointer" />
          <span className="font-mono text-xs text-zinc-500">{orb.color}</span>
        </div>
      </div>
      <Slider label="Size" value={orb.size} min={0.1} max={0.24} step={0.005} onChange={(v) => update({ size: v })} />
      <Slider label="Float speed" value={orb.floatSpeed} min={0} max={1.5} step={0.05} onChange={(v) => update({ floatSpeed: v })} />
      <Slider label="Glow intensity" value={orb.lightning} min={0} max={1.5} step={0.05} onChange={(v) => update({ lightning: v })} />
      <Slider label="Thinking chaos" value={orb.chaos} min={0.2} max={2} step={0.05} onChange={(v) => update({ chaos: v })} />
      <Slider label="Idle calm ⟶ active" value={orb.idle} min={0.02} max={0.5} step={0.02} onChange={(v) => update({ idle: v })} />
      <div className="flex gap-2">
        <button data-testid="orb-reset-button" onClick={() => update(DEFAULT_ORB)} disabled={saving} className="flex-1 py-2 rounded-lg bg-[#1c1c1f] border border-white/10 text-sm text-zinc-300 disabled:opacity-50">Reset</button>
        <button data-testid="orb-save-button" onClick={apply} disabled={saving || locked}
          className={`flex-1 py-2 rounded-lg text-sm flex items-center justify-center gap-2 transition-colors ${locked ? "bg-[#16161c] border border-emerald-500/30 text-emerald-400 cursor-default" : "bg-orange-600 hover:bg-orange-500 text-white"}`}>
          {saving ? <Loader2 size={15} className="animate-spin" /> : locked ? <><Check size={15} /> Locked in</> : "Apply Changes"}
        </button>
      </div>
    </div>
  );
}

function VoiceTab() {
  const [voices, setVoices] = useState([]);
  const [current, setCurrent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [previewing, setPreviewing] = useState(null);

  useEffect(() => {
    Promise.all([api.get("/voice/voices"), api.get("/auth/me")])
      .then(([v, me]) => { setVoices(v.data.voices || []); setCurrent(me.data.voice_id); })
      .catch(() => toast.error("Could not load voices"))
      .finally(() => setLoading(false));
  }, []);

  const select = async (id) => {
    setSaving(id);
    try { await api.put("/settings", { voice_id: id }); setCurrent(id); toast.success("Voice updated"); }
    catch { toast.error("Failed to save"); } finally { setSaving(null); }
  };
  const preview = async (id, e) => {
    e.stopPropagation(); setPreviewing(id);
    try {
      const r = await api.post("/voice/tts", { text: "Greetings. I am Promethius, your fire of knowledge.", voice: id }, { responseType: "blob" });
      const audio = new Audio(URL.createObjectURL(r.data));
      audio.onended = () => setPreviewing(null);
      await audio.play();
    } catch { setPreviewing(null); toast.error("Preview failed"); }
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="animate-spin text-orange-500" /></div>;
  return (
    <div className="space-y-2">
      {voices.length === 0 && <p className="text-zinc-500 text-sm text-center py-6">No voices found. Check the ElevenLabs key.</p>}
      {voices.map((v) => (
        <div key={v.id} data-testid={`voice-option-${v.id}`} onClick={() => select(v.id)}
          className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${current === v.id ? "border-orange-500/50 bg-orange-500/10" : "border-white/5 bg-[#16161c] hover:border-white/15"}`}>
          <span className="flex-1 min-w-0 text-sm text-zinc-200 truncate">{v.name}</span>
          <button onClick={(e) => preview(v.id, e)} className="text-zinc-500 hover:text-orange-400" title="Preview">
            {previewing === v.id ? <Loader2 size={16} className="animate-spin" /> : <Volume2 size={16} />}
          </button>
          {saving === v.id ? <Loader2 size={16} className="animate-spin text-orange-500" /> : current === v.id ? <Check size={16} className="text-orange-500" /> : <span className="w-4" />}
        </div>
      ))}
    </div>
  );
}

function DirectivesTab() {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api.get("/directives").then((r) => setContent(r.data.content)).catch(() => {}).finally(() => setLoading(false));
  }, []);
  const save = async () => {
    setSaving(true);
    try { await api.put("/directives", { content }); toast.success("Prime Directives updated"); }
    catch { toast.error("Failed to save"); } finally { setSaving(false); }
  };
  if (loading) return <div className="flex justify-center py-8"><Loader2 className="animate-spin text-orange-500" /></div>;
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 text-xs text-zinc-500 leading-relaxed">
        <Shield size={14} className="text-orange-500 mt-0.5 shrink-0" />
        <span>Promethius's immutable core laws. Injected at the top of every interaction and obeyed above all else.</span>
      </div>
      <textarea data-testid="directives-input" value={content} onChange={(e) => setContent(e.target.value)} rows={10}
        className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm font-mono text-zinc-100 leading-relaxed focus:outline-none focus:border-orange-500/50 resize-none" />
      <button data-testid="save-directives-button" onClick={save} disabled={saving}
        className="w-full py-2.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-sm text-white flex items-center justify-center gap-2 disabled:opacity-60">
        {saving && <Loader2 size={15} className="animate-spin" />} Save Prime Directives
      </button>
    </div>
  );
}

function PeopleTab() {
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const load = () => api.get("/speakers").then((r) => setPeople(r.data)).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);
  const remove = async (id) => { await api.delete(`/speakers/${id}`); toast.success("Removed"); load(); };
  if (loading) return <div className="flex justify-center py-8"><Loader2 className="animate-spin text-orange-500" /></div>;
  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500 leading-relaxed">People Promethius recognizes by voice. To add someone, tell the orb: <span className="text-orange-400 font-mono">"Promethius, this is [name]"</span> — Promethius greets them, and their <span className="text-orange-300">very next words</span> are saved as their voiceprint. To remove by voice: <span className="text-orange-400 font-mono">"Promethius, forget [name]"</span>.</p>
      {people.length === 0 && <p className="text-zinc-600 text-sm py-4 text-center">No one enrolled yet.</p>}
      {people.map((p) => (
        <div key={p.id} data-testid={`person-${p.id}`} className="flex items-center gap-3 p-3 rounded-xl border border-white/5 bg-[#16161c]">
          <div className="w-9 h-9 rounded-full bg-orange-500/15 border border-orange-500/20 flex items-center justify-center text-orange-400 text-sm font-semibold">{p.name?.[0]?.toUpperCase()}</div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-zinc-200 truncate">{p.name}</p>
            <p className="text-[10px] text-zinc-600 font-mono">{p.memory_count} memories</p>
          </div>
          <button data-testid={`remove-person-${p.id}`} onClick={() => remove(p.id)} className="text-zinc-600 hover:text-red-400"><Trash2 size={15} /></button>
        </div>
      ))}
    </div>
  );
}

function SecurityTab() {
  const [creds, setCreds] = useState([]);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [editVal, setEditVal] = useState("");

  const load = () => Promise.all([api.get("/webauthn/credentials"), api.get("/auth/me")])
    .then(([c, me]) => { setCreds(c.data); setEmail(me.data.email); })
    .finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const addDevice = async () => {
    setAdding(true);
    try {
      const label = window.prompt("Name this device (e.g. My iPhone, Work laptop):", "New device");
      if (label === null) { setAdding(false); return; }
      const opt = await api.post("/webauthn/register/options", { email });
      const att = await startRegistration({ optionsJSON: opt.data.options });
      await api.post("/webauthn/register/verify", { flow_id: opt.data.flow_id, credential: att, label });
      toast.success("Device added");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || (e?.name === "NotAllowedError" ? "Prompt dismissed" : "Could not add device"));
    } finally { setAdding(false); }
  };

  const rename = async (id) => {
    try { await api.put(`/webauthn/credentials/${id}`, { label: editVal }); setEditing(null); load(); }
    catch { toast.error("Rename failed"); }
  };

  const remove = async (id) => {
    try { await api.delete(`/webauthn/credentials/${id}`); toast.success("Device removed"); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Remove failed"); }
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="animate-spin text-orange-500" /></div>;
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 text-xs text-zinc-500 leading-relaxed">
        <Shield size={14} className="text-orange-500 mt-0.5 shrink-0" />
        <span>Your registered passkeys. Add your phone and laptop so you're never locked out if one device is lost.</span>
      </div>
      <button data-testid="add-passkey-button" onClick={addDevice} disabled={adding}
        className="w-full py-2.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-sm text-white flex items-center justify-center gap-2 disabled:opacity-60">
        {adding ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Add this device
      </button>
      {creds.length === 0 && <p className="text-zinc-600 text-sm py-2 text-center">No passkeys yet.</p>}
      {creds.map((c) => (
        <div key={c.id} data-testid={`passkey-${c.id}`} className="flex items-center gap-3 p-3 rounded-xl border border-white/5 bg-[#16161c]">
          <Fingerprint size={18} className="text-orange-500/70 shrink-0" />
          <div className="flex-1 min-w-0">
            {editing === c.id ? (
              <div className="flex gap-1">
                <input autoFocus value={editVal} onChange={(e) => setEditVal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && rename(c.id)}
                  className="flex-1 bg-[#0d0d12] border border-white/10 rounded px-2 py-1 text-sm text-zinc-100 focus:outline-none focus:border-orange-500/50" />
                <button onClick={() => rename(c.id)} className="text-orange-500"><Check size={15} /></button>
              </div>
            ) : (
              <p className="text-sm text-zinc-200 truncate">{c.label || "Device"}</p>
            )}
            <p className="text-[10px] text-zinc-600 font-mono">added {(c.created_at || "").slice(0, 10)}{c.last_used_at ? ` · used ${c.last_used_at.slice(0, 10)}` : ""}</p>
          </div>
          <button onClick={() => { setEditing(c.id); setEditVal(c.label || ""); }} className="text-zinc-600 hover:text-orange-400" title="Rename"><Pencil size={14} /></button>
          <button data-testid={`remove-passkey-${c.id}`} onClick={() => remove(c.id)} className="text-zinc-600 hover:text-red-400" title="Remove"><Trash2 size={15} /></button>
        </div>
      ))}
    </div>
  );
}

export default function VoiceSettings({ onClose }) {
  const [tab, setTab] = useState("voice");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div data-testid="voice-settings-modal" onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-[#0d0d12] border border-white/10 rounded-2xl shadow-2xl max-h-[82vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <h2 className="font-heading text-xl font-medium tracking-tight text-zinc-100">Promethius Settings</h2>
          <button data-testid="close-settings-button" onClick={onClose} className="text-zinc-500 hover:text-zinc-200"><X size={18} /></button>
        </div>
        <div className="px-4 pt-3">
          <div className="grid grid-cols-5 gap-1 bg-[#16161c] rounded-lg p-1">
            {TABS.map((t) => (
              <button key={t.id} data-testid={`settings-tab-${t.id}`} onClick={() => setTab(t.id)}
                className={`flex flex-col items-center justify-center gap-1 py-2 rounded-md text-[10px] transition-colors ${tab === t.id ? "bg-orange-500/15 text-orange-400" : "text-zinc-500 hover:text-zinc-200"}`}>
                <t.icon size={15} /> {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {tab === "voice" && <VoiceTab />}
          {tab === "appearance" && <AppearanceTab />}
          {tab === "directives" && <DirectivesTab />}
          {tab === "people" && <PeopleTab />}
          {tab === "security" && <SecurityTab />}
        </div>
        <div className="px-4 py-3 border-t border-white/5">
          <InstallButton />
        </div>
      </div>
    </div>
  );
}
