import { useState, useRef, useEffect } from "react";
import {
  Send, Mic, Square, Paperclip, Globe, Image as ImageIcon, Loader2,
  Flame, X, FileText, Github, RefreshCw, Zap,
} from "lucide-react";
import { toast } from "sonner";
import api from "../lib/api";
import Markdown from "./Markdown";
import GithubPush from "./GithubPush";

const MODEL_LABELS = {
  "auto": "Auto",
  "gpt-4o-mini": "GPT-4o mini",
  "gpt-4o": "GPT-4o",
  "gpt-5.5": "GPT-5.5",
  "claude-sonnet-5-5": "Claude Sonnet 5.5",
  "claude-sonnet-5": "Claude Sonnet 5",
  "claude-opus-5-5": "Claude Opus 5.5",
  "claude-opus-4-8": "Claude Opus 4.8",
  "claude-sonnet-4-6": "Claude Sonnet 4.6",
  "claude-opus-4-7": "Claude Opus 4.7",
  "claude-haiku-4-5": "Claude Haiku 4.5",
  "grok-4.6": "Grok 4.6",
  "grok-4": "Grok 4",
  "llama3.1": "Llama 3.1 (Ollama)",
  "mistral": "Mistral (Ollama)",
  "qwen2.5": "Qwen 2.5 (Ollama)",
};

// Rough cost tier per model — green (free/local), yellow (moderate), red (premium).
const MODEL_COST = {
  "gpt-4o-mini": "moderate",
  "gpt-4o": "moderate",
  "gpt-5.5": "expensive",
  "claude-haiku-4-5": "moderate",
  "claude-sonnet-5-5": "moderate",
  "claude-sonnet-5": "moderate",
  "claude-sonnet-4-6": "moderate",
  "claude-opus-5-5": "expensive",
  "claude-opus-4-8": "expensive",
  "claude-opus-4-7": "expensive",
  "grok-4.6": "moderate",
  "grok-4": "moderate",
  "llama3.1": "free",
  "mistral": "free",
  "qwen2.5": "free",
};

const COST_STYLES = {
  free: { dot: "bg-emerald-500", text: "text-emerald-400", label: "Free" },
  moderate: { dot: "bg-amber-400", text: "text-amber-300", label: "Moderate" },
  expensive: { dot: "bg-red-500", text: "text-red-400", label: "Premium" },
};

const costOf = (p, m) =>
  MODEL_COST[m] ||
  (p === "ollama"
    ? "free"
    : String(m).includes("gpt-5") || String(m).includes("opus")
    ? "expensive"
    : "moderate");

// Approx USD per 1M tokens: [input, output]. Absent => local/free.
const MODEL_PRICING = {
  "gpt-4o-mini": [0.15, 0.6],
  "gpt-4o": [2.5, 10],
  "gpt-5.5": [10, 30],
  "claude-haiku-4-5": [1, 5],
  "claude-sonnet-5-5": [3, 15],
  "claude-sonnet-5": [3, 15],
  "claude-sonnet-4-6": [3, 15],
  "claude-opus-5-5": [15, 75],
  "claude-opus-4-8": [15, 75],
  "claude-opus-4-7": [15, 75],
  "grok-4.6": [2, 6],
  "grok-4": [3, 15],
};
// Representative message used for the dropdown estimate.
const EST_IN_TOKENS = 1000;
const EST_OUT_TOKENS = 500;
const approxTokens = (t) => Math.max(1, Math.ceil((t || "").length / 4));

const estMsgCost = (p, m) => {
  if (p === "ollama" || costOf(p, m) === "free") return 0;
  const pr = MODEL_PRICING[m];
  if (!pr) return null;
  return (pr[0] * EST_IN_TOKENS + pr[1] * EST_OUT_TOKENS) / 1e6;
};

const liveMsgCost = (p, m, inText, outText) => {
  if (p === "ollama" || costOf(p, m) === "free") return 0;
  const pr = MODEL_PRICING[m];
  if (!pr) return null;
  return (pr[0] * approxTokens(inText) + pr[1] * approxTokens(outText)) / 1e6;
};

const fmtCost = (c) =>
  c === 0 ? "Free" : c == null ? "" : c < 0.0001 ? "<$0.0001" : `~$${c < 0.001 ? c.toFixed(5) : c < 0.01 ? c.toFixed(4) : c.toFixed(3)}`;

const rateLabel = (p, m) => {
  if (p === "ollama" || costOf(p, m) === "free") return "Runs locally · no API cost";
  const pr = MODEL_PRICING[m];
  return pr ? `$${pr[0]}/M in · $${pr[1]}/M out` : "Pricing unavailable";
};

// Live provider reachability: online (green) if not explicitly reported offline.
const isOnline = (status, p) => (status || {})[p] !== false;

// Which key pays for a given model, mirroring the backend priority:
// Universal Key is primary for all cloud models; BYO keys are fallback-only.
const BILLING_STYLES = {
  universal: { label: "Universal", cls: "bg-orange-500/15 text-orange-300 border-orange-500/25", title: "Billed to your Emergent Universal Key" },
  byo: { label: "Your Key", cls: "bg-sky-500/15 text-sky-300 border-sky-500/25", title: "Billed to your own pasted API key" },
  local: { label: "Local", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25", title: "Runs locally — no API billing" },
  none: { label: "No key", cls: "bg-zinc-600/20 text-zinc-400 border-zinc-600/30", title: "No key configured — add one in Settings" },
};
const billingOf = (p, keys) => {
  if (p === "ollama") return "local";
  if (p === "xai") return keys?.xai?.set ? "byo" : "none";
  if (p === "auto") return keys?.universal_key?.set ? "universal" : (keys?.openai?.set || keys?.anthropic?.set ? "byo" : "none");
  if (keys?.universal_key?.set) return "universal";
  if (p === "openai" && keys?.openai?.set) return "byo";
  if (p === "anthropic" && keys?.anthropic?.set) return "byo";
  return "none";
};

export default function ChatPanel({
  conversationId, setConversationId, providers, modelStatus, refreshModelStatus, provider, model,
  onModelChange, refreshConversations,
}) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const [imageMode, setImageMode] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [recording, setRecording] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [statusRefreshing, setStatusRefreshing] = useState(false);
  const [showPush, setShowPush] = useState(false);
  const [pushProposal, setPushProposal] = useState(null);
  const [grokEffort, setGrokEffort] = useState(() => localStorage.getItem("promethius_grok_effort") || "high");
  const scrollRef = useRef(null);
  const fileRef = useRef(null);
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);
  const [keyStatus, setKeyStatus] = useState(null);

  // Running spend meter for this browser session (survives conversation switches).
  const SPEND_KEY = "promethius_session_spend";
  const [spend, setSpend] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(SPEND_KEY)) || { universal: 0, total: 0, n: 0 }; }
    catch { return { universal: 0, total: 0, n: 0 }; }
  });
  const bumpSpend = (p, m, inText, outText) => {
    const cost = liveMsgCost(p, m, inText, outText) || 0;
    if (!cost) return;
    const toUniversal = billingOf(p, keyStatus) === "universal";
    setSpend((s) => {
      const next = {
        universal: s.universal + (toUniversal ? cost : 0),
        total: s.total + cost,
        n: s.n + 1,
      };
      try { sessionStorage.setItem(SPEND_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };
  const resetSpend = () => {
    const zero = { universal: 0, total: 0, n: 0 };
    setSpend(zero);
    try { sessionStorage.setItem(SPEND_KEY, JSON.stringify(zero)); } catch {}
  };

  useEffect(() => {
    api.get("/settings/keys").then((r) => setKeyStatus(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    api.get(`/conversations/${conversationId}/messages`).then((r) => setMessages(r.data));
  }, [conversationId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  const handleFiles = async (files) => {
    for (const file of files) {
      const fd = new FormData();
      fd.append("file", file);
      try {
        const r = await api.post("/upload", fd);
        setAttachments((a) => [...a, { id: r.data.id, name: r.data.original_filename, type: r.data.content_type }]);
        toast.success(`Attached ${r.data.original_filename}`);
      } catch {
        toast.error("Upload failed");
      }
    }
  };

  const generateImage = async (prompt) => {
    setMessages((m) => [...m, { id: Date.now() + "u", role: "user", content: prompt, type: "text" }]);
    setSending(true);
    try {
      const r = await api.post("/image/generate", { prompt });
      const url = `${api.defaults.baseURL.replace(/\/api$/, "")}${r.data.url}`;
      const blob = await api.get(r.data.url, { responseType: "blob" });
      const localUrl = URL.createObjectURL(blob.data);
      setMessages((m) => [...m, { id: Date.now() + "a", role: "assistant", content: "", type: "image", media_url: localUrl }]);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Image generation failed");
    } finally {
      setSending(false);
      setImageMode(false);
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");

    if (imageMode) {
      await generateImage(text);
      return;
    }

    const sentAttachments = [...attachments];
    const optimistic = {
      id: Date.now() + "u",
      role: "user",
      content: text,
      type: "text",
      attachments: sentAttachments,
    };
    setMessages((m) => [...m, optimistic]);
    setSending(true);
    const attIds = attachments.map((a) => a.id);
    setAttachments([]);
    try {
      const r = await api.post("/chat", {
        conversation_id: conversationId,
        provider, model, message: text,
        use_web_search: webSearch,
        attachment_ids: attIds,
        reasoning_effort: (provider === "xai" && model === "grok-4.6") ? grokEffort : undefined,
      });
      if (!conversationId) {
        setConversationId(r.data.conversation_id);
        refreshConversations();
      }
      const usedProvider = r.data.provider || provider;
      const usedModel = r.data.model || model;
      setMessages((m) => [...m, {
        id: Date.now() + "a", role: "assistant", content: r.data.reply, type: "text",
        pushProposal: r.data.push_proposal || null,
        provider: usedProvider, model: usedModel, auto_selected: !!r.data.auto_selected,
        cache: r.data.cache || null,
      }]);
      bumpSpend(usedProvider, usedModel, text, r.data.reply);
      if (r.data.push_proposal) {
        toast.info("Promethius prepared a change — tap “Review & Push” to approve");
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Promethius could not respond");
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      setInput(text);
    } finally {
      setSending(false);
    }
  };

  const toggleRecord = async () => {
    if (recording) {
      mediaRef.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => chunksRef.current.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const fd = new FormData();
        fd.append("file", blob, "audio.webm");
        toast.loading("Transcribing...", { id: "tr" });
        try {
          const r = await api.post("/voice/transcribe", fd);
          setInput((v) => (v ? v + " " : "") + r.data.text);
          toast.success("Transcribed", { id: "tr" });
        } catch {
          toast.error("Transcription failed", { id: "tr" });
        }
      };
      mr.start();
      mediaRef.current = mr;
      setRecording(true);
    } catch {
      toast.error("Microphone access denied");
    }
  };

  const speak = async (text) => {
    try {
      const r = await api.post("/voice/tts", { text }, { responseType: "blob" });
      const url = URL.createObjectURL(r.data);
      new Audio(url).play();
    } catch {
      toast.error("Voice playback failed");
    }
  };

  const flat = Object.entries(providers || {}).flatMap(([p, ms]) => ms.map((m) => ({ p, m })));

  return (
    <div className="flex-1 flex flex-col h-full relative">
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 shrink-0">
        <div className="relative">
          <button
            data-testid="model-selector-trigger"
            onClick={() => setModelOpen((o) => !o)}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-[#121214] border border-white/10 hover:border-white/20 text-sm font-medium text-zinc-200 transition-colors"
          >
            {provider === "auto" ? (
              <>
                <Zap size={13} className="text-orange-400" strokeWidth={2} />
                Auto
                {(() => {
                  const b = BILLING_STYLES[billingOf("auto", keyStatus)];
                  return (
                    <span
                      data-testid="model-billing-current"
                      className={`px-1.5 py-0.5 rounded-full text-[9px] font-semibold border ${b.cls}`}
                      title={b.title}
                    >
                      {b.label}
                    </span>
                  );
                })()}
                <span className="font-mono text-[11px] text-zinc-500" title="Promethius diagnoses each message and picks the best model">
                  picks best
                </span>
              </>
            ) : (
              <>
                <span
                  className={`w-2 h-2 rounded-full ${COST_STYLES[costOf(provider, model)].dot}`}
                  title={`${COST_STYLES[costOf(provider, model)].label} cost`}
                />
                {MODEL_LABELS[model] || model}
                {(() => {
                  const b = BILLING_STYLES[billingOf(provider, keyStatus)];
                  return (
                    <span
                      data-testid="model-billing-current"
                      className={`px-1.5 py-0.5 rounded-full text-[9px] font-semibold border ${b.cls}`}
                      title={b.title}
                    >
                      {b.label}
                    </span>
                  );
                })()}
                <span className={`font-mono text-[11px] ${COST_STYLES[costOf(provider, model)].text}`} title={rateLabel(provider, model)}>
                  {fmtCost(estMsgCost(provider, model))}
                </span>
                <span
                  data-testid="model-status-current"
                  className={`w-1.5 h-1.5 rounded-full ${isOnline(modelStatus, provider) ? "bg-green-500" : "bg-red-500"}`}
                  title={isOnline(modelStatus, provider) ? "Online · reachable" : "Offline · unreachable"}
                />
              </>
            )}
          </button>
          {modelOpen && (
            <div className="absolute top-12 left-0 z-50 bg-[#121214] border border-white/10 rounded-xl shadow-2xl max-h-[72vh] flex flex-col w-80 backdrop-blur-xl py-1">
              <div className="overflow-y-auto overscroll-contain min-h-0">
              <button
                data-testid="model-option-auto"
                onClick={() => { onModelChange("auto", "auto"); setModelOpen(false); }}
                className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between gap-2 border-b border-white/5 hover:bg-white/5 ${provider === "auto" ? "bg-white/5" : ""}`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <Zap size={14} className="text-orange-400 shrink-0" strokeWidth={2} />
                  <span className="flex flex-col">
                    <span className={provider === "auto" ? "text-orange-400" : "text-zinc-200"}>Auto</span>
                    <span className="text-[10px] text-zinc-500">Promethius picks the best model per task</span>
                  </span>
                </span>
                <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold border bg-orange-500/15 text-orange-300 border-orange-500/25 shrink-0">
                  Smart
                </span>
              </button>
              {flat.map(({ p, m }) => {
                const cost = costOf(p, m);
                const cs = COST_STYLES[cost];
                const online = isOnline(modelStatus, p);
                return (
                  <button
                    key={p + m}
                    data-testid={`model-option-${m}`}
                    data-cost={cost}
                    data-online={online}
                    disabled={!online}
                    title={online ? rateLabel(p, m) : "Offline — provider unreachable"}
                    onClick={() => {
                      if (!online) return;
                      onModelChange(p, m);
                      setModelOpen(false);
                    }}
                    className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between gap-2 ${
                      !online
                        ? "opacity-40 cursor-not-allowed"
                        : `hover:bg-white/5 ${m === model && provider === p ? "bg-white/5" : ""}`
                    }`}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${cs.dot}`} title={`${cs.label} cost`} />
                      <span className={`whitespace-nowrap ${m === model && provider === p ? "text-orange-400" : cs.text}`}>
                        {MODEL_LABELS[m] || m}
                      </span>
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      {(() => {
                        const b = BILLING_STYLES[billingOf(p, keyStatus)];
                        return (
                          <span
                            data-testid={`model-billing-${m}`}
                            className={`px-1.5 py-0.5 rounded-full text-[9px] font-semibold border ${b.cls}`}
                            title={b.title}
                          >
                            {b.label}
                          </span>
                        );
                      })()}
                      <span data-testid={`model-price-${m}`} className={`font-mono text-[10px] ${cs.text}`}>
                        {fmtCost(estMsgCost(p, m))}
                      </span>
                      <span
                        data-testid={`model-status-${m}`}
                        className={`w-1.5 h-1.5 rounded-full ${online ? "bg-green-500" : "bg-red-500"}`}
                        title={online ? "Online · reachable" : "Offline · unreachable"}
                      />
                    </span>
                  </button>
                );
              })}
              </div>
              <div className="flex items-center justify-between px-4 py-2 mt-1 border-t border-white/5 text-[10px] text-zinc-500">
                <span className="flex items-center gap-3">
                  {Object.values(COST_STYLES).map((c) => (
                    <span key={c.label} className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${c.dot}`} />
                      {c.label}
                    </span>
                  ))}
                </span>
                <span className="text-zinc-600">est. / msg</span>
              </div>
              <div className="flex items-center gap-2 px-4 py-2 border-t border-white/5 text-[9px] text-zinc-500">
                <span className="px-1.5 py-0.5 rounded-full font-semibold border bg-orange-500/15 text-orange-300 border-orange-500/25">Universal</span>
                <span className="text-zinc-600">= Emergent key ·</span>
                <span className="px-1.5 py-0.5 rounded-full font-semibold border bg-sky-500/15 text-sky-300 border-sky-500/25">Your Key</span>
                <span className="text-zinc-600">= your own key</span>
              </div>
              <div className="flex items-center justify-between px-4 pb-2 text-[10px] text-zinc-500">
                <span className="flex items-center gap-3">
                  <span className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> Online
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500" /> Offline
                  </span>
                </span>
                <button
                  data-testid="refresh-model-status"
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!refreshModelStatus || statusRefreshing) return;
                    setStatusRefreshing(true);
                    try { await refreshModelStatus(); } finally { setStatusRefreshing(false); }
                  }}
                  disabled={statusRefreshing}
                  className="flex items-center gap-1 text-zinc-400 hover:text-orange-400 transition-colors disabled:opacity-50"
                  title="Refresh online/offline status"
                >
                  <RefreshCw size={11} className={statusRefreshing ? "animate-spin" : ""} /> Refresh
                </button>
              </div>
            </div>
          )}
        </div>
        {provider === "xai" && model === "grok-4.6" && (
          <div
            data-testid="grok-effort-control"
            title="Grok reasoning effort — higher = deeper thinking but slower & pricier"
            className="flex items-center gap-1 px-1.5 py-1 rounded-full bg-[#121214] border border-white/10"
          >
            <span className="text-[10px] font-mono text-zinc-500 pl-1.5 pr-0.5 flex items-center gap-1">
              <Zap size={11} className="text-sky-400" strokeWidth={2} /> effort
            </span>
            {["low", "medium", "high", "xhigh"].map((lvl) => (
              <button
                key={lvl}
                data-testid={`grok-effort-${lvl}`}
                onClick={() => { setGrokEffort(lvl); localStorage.setItem("promethius_grok_effort", lvl); }}
                className={`px-2 py-0.5 rounded-full text-[11px] font-mono transition-colors ${
                  grokEffort === lvl
                    ? "bg-sky-500/20 text-sky-300 border border-sky-500/30"
                    : "text-zinc-500 hover:text-zinc-300 border border-transparent"
                }`}
              >
                {lvl}
              </button>
            ))}
          </div>
        )}
        {spend.n > 0 && (
          <div
            data-testid="session-spend-meter"
            title={`Universal Key spend this session: ${fmtCost(spend.universal)} across ${spend.n} message${spend.n === 1 ? "" : "s"}.\nTotal session spend (all keys): ${fmtCost(spend.total)}.\nClick to reset.`}
            onClick={resetSpend}
            className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#121214] border border-white/10 text-xs font-mono text-zinc-400 cursor-pointer hover:border-orange-500/40 transition-colors"
          >
            <Zap size={12} className="text-orange-400" strokeWidth={2} />
            <span className="text-zinc-500">Universal Key</span>
            <span data-testid="session-spend-universal" className="text-orange-300">
              {fmtCost(spend.universal) || "$0"}
            </span>
            {spend.total > spend.universal + 1e-9 && (
              <span className="text-zinc-600" title="Total across all keys (incl. your own)">
                / {fmtCost(spend.total)} total
              </span>
            )}
          </div>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto w-full px-4 md:px-6 pt-8 pb-40">
          {messages.length === 0 && !sending && (
            <div className="flex flex-col items-center justify-center text-center pt-24 animate-fade-up">
              <div className="w-16 h-16 rounded-2xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center mb-6">
                <Flame size={28} className="text-orange-500" strokeWidth={1.5} />
              </div>
              <h2 className="font-heading text-3xl font-medium tracking-tight mb-2">How can I serve you?</h2>
              <p className="text-zinc-500 max-w-md">
                Ask anything, attach files, search the web, or generate images. Promethius remembers what matters.
              </p>
            </div>
          )}

          {messages.map((m, idx) => (
            <div key={m.id} className="mb-8 animate-fade-up">
              {m.role === "user" ? (
                <div className="max-w-[80%] ml-auto bg-[#1c1c1f] border border-white/5 text-zinc-100 rounded-3xl rounded-tr-md px-5 py-3.5">
                  {m.attachments && m.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {m.attachments.map((a) => (
                        <div key={a.id} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-black/30 border border-white/10 text-xs text-zinc-300">
                          {a.type?.startsWith("image/") ? (
                            <ImageIcon size={12} className="text-orange-400" />
                          ) : (
                            <FileText size={12} />
                          )}
                          <span className="max-w-[160px] truncate">{a.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {m.content && <p className="prose-promethius">{m.content}</p>}
                </div>
              ) : (
                <div className="flex gap-4">
                  <div className="w-8 h-8 rounded-full bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shrink-0">
                    <Flame size={15} className="text-orange-500" strokeWidth={1.5} />
                  </div>
                  <div className="flex-1 min-w-0">
                    {m.type === "image" ? (
                      <img src={m.media_url} alt="generated" className="rounded-2xl border border-white/10 max-w-md w-full" />
                    ) : (
                      <>
                        <Markdown>{m.content}</Markdown>
                        <div className="mt-2 flex items-center gap-3">
                          <button
                            data-testid="speak-button"
                            onClick={() => speak(m.content)}
                            className="text-xs text-zinc-600 hover:text-orange-400 font-mono uppercase tracking-wider transition-colors"
                          >
                            ▶ Speak
                          </button>
                          {m.auto_selected && m.model && (
                            <span
                              data-testid="auto-picked-model"
                              title="Promethius auto-selected this model for your request"
                              className="text-[11px] flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-300 border border-orange-500/20 font-mono"
                            >
                              <Zap size={10} strokeWidth={2} /> Auto → {MODEL_LABELS[m.model] || m.model}
                            </span>
                          )}
                          {m.cache && (m.cache.read > 0 || m.cache.created > 0) && (
                            <span
                              data-testid="cache-readout"
                              title={`Claude prompt cache — read ${m.cache.read} cached input tokens (billed ~90% cheaper), wrote ${m.cache.created} new cached tokens this turn`}
                              className="text-[11px] flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 font-mono"
                            >
                              <Zap size={10} strokeWidth={2} /> cache {m.cache.read > 0 ? `read ${m.cache.read.toLocaleString()}` : `new ${m.cache.created.toLocaleString()}`}
                            </span>
                          )}
                          {(() => {
                            const prev = idx > 0 && messages[idx - 1]?.role === "user" ? messages[idx - 1].content : "";
                            const mProv = m.provider || provider;
                            const mMod = m.model || model;
                            const c = liveMsgCost(mProv, mMod, prev, m.content);
                            if (c == null) return null;
                            return (
                              <span
                                data-testid="message-cost"
                                title={`Estimated with ${MODEL_LABELS[mMod] || mMod} · ${rateLabel(mProv, mMod)}`}
                                className={`text-[11px] font-mono ${COST_STYLES[costOf(mProv, mMod)].text}`}
                              >
                                {c === 0 ? "Free" : fmtCost(c)}
                              </span>
                            );
                          })()}
                          {(m.pushProposal || m.push_proposal) && (
                            <button
                              data-testid="review-push-button"
                              onClick={() => { setPushProposal(m.pushProposal || m.push_proposal); setShowPush(true); }}
                              className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-orange-500/10 text-orange-300 border border-orange-500/20 hover:bg-orange-500/20 transition-colors"
                            >
                              <Github size={12} /> Review &amp; Push
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}

          {sending && (
            <div className="flex gap-4 mb-8">
              <div className="w-8 h-8 rounded-full bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shrink-0">
                <Flame size={15} className="text-orange-500 animate-pulse" strokeWidth={1.5} />
              </div>
              <div className="flex items-center gap-1 pt-2">
                <span className="w-2 h-2 rounded-full bg-orange-500/60 animate-pulse" />
                <span className="w-2 h-2 rounded-full bg-orange-500/40 animate-pulse" style={{ animationDelay: "0.2s" }} />
                <span className="w-2 h-2 rounded-full bg-orange-500/20 animate-pulse" style={{ animationDelay: "0.4s" }} />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-full max-w-3xl px-4 z-40">
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {attachments.map((a) => (
              <div key={a.id} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#1c1c1f] border border-white/10 text-xs text-zinc-300">
                <FileText size={12} />
                <span className="max-w-[140px] truncate">{a.name}</span>
                <button onClick={() => setAttachments((x) => x.filter((y) => y.id !== a.id))}>
                  <X size={12} className="text-zinc-500 hover:text-zinc-300" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2 bg-[#121214]/90 backdrop-blur-2xl border border-white/10 rounded-3xl p-2 shadow-2xl focus-within:border-orange-500/30 transition-all">
          <div className="flex items-center gap-1 pl-1">
            <button
              data-testid="attach-button"
              onClick={() => fileRef.current?.click()}
              className="h-9 w-9 rounded-full flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-white/5 transition-colors"
              title="Attach file"
            >
              <Paperclip size={18} strokeWidth={1.5} />
            </button>
            <button
              data-testid="websearch-toggle"
              onClick={() => setWebSearch((w) => !w)}
              className={`h-9 w-9 rounded-full flex items-center justify-center transition-colors ${
                webSearch ? "text-orange-400 bg-orange-500/10" : "text-zinc-500 hover:text-zinc-200 hover:bg-white/5"
              }`}
              title="Web search"
            >
              <Globe size={18} strokeWidth={1.5} />
            </button>
            <button
              data-testid="image-toggle"
              onClick={() => setImageMode((i) => !i)}
              className={`h-9 w-9 rounded-full flex items-center justify-center transition-colors ${
                imageMode ? "text-orange-400 bg-orange-500/10" : "text-zinc-500 hover:text-zinc-200 hover:bg-white/5"
              }`}
              title="Generate image"
            >
              <ImageIcon size={18} strokeWidth={1.5} />
            </button>
            <button
              data-testid="github-push-button"
              onClick={() => setShowPush(true)}
              className="h-9 w-9 rounded-full flex items-center justify-center text-zinc-500 hover:text-orange-400 hover:bg-orange-500/10 transition-colors"
              title="Push to GitHub"
            >
              <Github size={18} strokeWidth={1.5} />
            </button>
          </div>
          <textarea
            data-testid="chat-input-textarea"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder={imageMode ? "Describe the image to generate..." : "Message Promethius..."}
            className="flex-1 bg-transparent border-none text-zinc-50 placeholder:text-zinc-600 focus:outline-none resize-none py-2 px-2 max-h-40 font-body"
          />
          <button
            data-testid="voice-record-button"
            onClick={toggleRecord}
            className={`h-11 w-11 rounded-full flex items-center justify-center shrink-0 border transition-colors ${
              recording
                ? "bg-orange-600 text-white border-orange-500 animate-ember"
                : "bg-[#1c1c1f] text-zinc-400 hover:text-zinc-100 border-white/5"
            }`}
          >
            {recording ? <Square size={16} /> : <Mic size={18} strokeWidth={1.5} />}
          </button>
          <button
            data-testid="send-button"
            onClick={send}
            disabled={sending || !input.trim()}
            className="h-11 w-11 rounded-full flex items-center justify-center shrink-0 bg-orange-600 hover:bg-orange-500 text-white disabled:opacity-40 disabled:hover:bg-orange-600 transition-colors"
          >
            {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} strokeWidth={1.5} />}
          </button>
        </div>
        {imageMode && (
          <p className="text-center text-xs text-orange-400/70 mt-2 font-mono uppercase tracking-wider">Image generation mode</p>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          handleFiles(Array.from(e.target.files));
          e.target.value = "";
        }}
      />

      <GithubPush
        open={showPush}
        onClose={() => { setShowPush(false); setPushProposal(null); }}
        initialProposal={pushProposal}
        lastAssistantMessage={[...messages].reverse().find((m) => m.role === "assistant" && m.type !== "image")?.content || ""}
      />
    </div>
  );
}
