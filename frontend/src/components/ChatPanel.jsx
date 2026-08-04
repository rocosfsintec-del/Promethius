import { useState, useRef, useEffect } from "react";
import {
  Send, Mic, Square, Paperclip, Globe, Image as ImageIcon, Loader2,
  Flame, X, FileText, Github,
} from "lucide-react";
import { toast } from "sonner";
import api from "../lib/api";
import Markdown from "./Markdown";
import GithubPush from "./GithubPush";

const MODEL_LABELS = {
  "gpt-4o-mini": "GPT-4o mini",
  "gpt-4o": "GPT-4o",
  "gpt-5.5": "GPT-5.5",
  "claude-sonnet-4-6": "Claude Sonnet 4.6",
  "claude-opus-4-7": "Claude Opus 4.7",
  "claude-haiku-4-5": "Claude Haiku 4.5",
  "llama3.1": "Llama 3.1 (Ollama)",
  "mistral": "Mistral (Ollama)",
  "qwen2.5": "Qwen 2.5 (Ollama)",
};

export default function ChatPanel({
  conversationId, setConversationId, providers, provider, model,
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
  const [showPush, setShowPush] = useState(false);
  const scrollRef = useRef(null);
  const fileRef = useRef(null);
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);

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
      });
      if (!conversationId) {
        setConversationId(r.data.conversation_id);
        refreshConversations();
      }
      setMessages((m) => [...m, { id: Date.now() + "a", role: "assistant", content: r.data.reply, type: "text" }]);
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
            <Flame size={15} className="text-orange-500" strokeWidth={1.5} />
            {MODEL_LABELS[model] || model}
          </button>
          {modelOpen && (
            <div className="absolute top-12 left-0 z-50 bg-[#121214] border border-white/10 rounded-xl shadow-2xl overflow-hidden w-60 backdrop-blur-xl py-1">
              {flat.map(({ p, m }) => (
                <button
                  key={p + m}
                  data-testid={`model-option-${m}`}
                  onClick={() => {
                    onModelChange(p, m);
                    setModelOpen(false);
                  }}
                  className={`w-full text-left px-4 py-2.5 text-sm hover:bg-white/5 transition-colors flex items-center justify-between ${
                    m === model ? "text-orange-400" : "text-zinc-300"
                  }`}
                >
                  {MODEL_LABELS[m] || m}
                  <span className="font-mono text-[10px] uppercase text-zinc-600">{p}</span>
                </button>
              ))}
            </div>
          )}
        </div>
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

          {messages.map((m) => (
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
                        <button
                          data-testid="speak-button"
                          onClick={() => speak(m.content)}
                          className="mt-2 text-xs text-zinc-600 hover:text-orange-400 font-mono uppercase tracking-wider transition-colors"
                        >
                          ▶ Speak
                        </button>
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
        onClose={() => setShowPush(false)}
        lastAssistantMessage={[...messages].reverse().find((m) => m.role === "assistant" && m.type !== "image")?.content || ""}
      />
    </div>
  );
}
