import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Settings as SettingsIcon, MessageSquare, LogOut, BookDown, Maximize, Minimize } from "lucide-react";
import { toast } from "sonner";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import VoiceSettings from "../components/VoiceSettings";
import { createRollingRecorder } from "../lib/audio";
import { DEFAULT_ORB, hexToRgb } from "../lib/orbConfig";

// ---- Plasma orb canvas ----------------------------------------------------
function useOrbCanvas(canvasRef, energyRef, configRef, voiceRef, flashRef, standbyRef) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let raf;
    let t = 0;
    let smooth = 0;
    let voiceSmooth = 0;
    let flare = 0;        // fast-attack / slow-release envelope for syllable flares
    let embers = [];      // faint rising ember particles that drift off the flames
    let pool = 0;         // eased firelight glow that gathers beneath the orb

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const render = () => {
      const cfg = configRef.current || DEFAULT_ORB;
      let { r, g, b } = hexToRgb(cfg.color);
      const tipC = hexToRgb(cfg.tipColor || cfg.color);
      let tr = tipC.r, tg = tipC.g, tb = tipC.b;
      if (flashRef && flashRef.current > Date.now()) { r = 34; g = 211; b = 120; tr = 34; tg = 211; tb = 120; }
      t += 0.016;
      const target = energyRef.current;
      smooth += (target - smooth) * 0.08;
      voiceSmooth += ((voiceRef ? voiceRef.current : 0) - voiceSmooth) * 0.4;
      // Sharp flare: snap up on a syllable, ease back down.
      const vNow = voiceRef ? voiceRef.current : 0;
      flare += (vNow - flare) * (vNow > flare ? 0.6 : 0.12);
      const eff = Math.min(smooth + voiceSmooth * 1.7, 1.2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const cx = w / 2;
      const sb = standbyRef && standbyRef.current;
      const cy = h / 2 + Math.sin(t * (sb ? 0.12 : 0.6)) * 16 * (cfg.floatSpeed * 2) * (sb ? 0.6 : 1);

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#000005";
      ctx.fillRect(0, 0, w, h);

      const base = Math.min(w, h) * cfg.size;
      // Glow intensity multiplier (repurposed from the old "lightning" control).
      const glow = 0.55 + (cfg.lightning ?? 0.9) * 0.6;
      // Brightness rises with heavy thought (energy) and live speech amplitude.
      let bright = Math.min((eff + voiceSmooth * 0.5) * glow, 1.5);
      // In standby, dim right down to faint embers — but keep gently floating.
      if (standbyRef && standbyRef.current) bright = Math.min(bright, 0.12);

      const chaos = cfg.chaos ?? 1;
      const danceSpeed = 0.6 + (cfg.floatSpeed ?? 0.5) * 1.3;
      // Radius of the (invisible) sphere — gently breathes with thought/voice.
      const R = base * (1 + 0.04 * Math.sin(t * 1.6) + bright * 0.1);

      // Tapered, additive "flame tongue" from a base point out to a tip.
      const drawFlameTongue = (x0, y0, x1, y1, wBase, alpha) => {
        const steps = 4;
        for (let s = 0; s < steps; s++) {
          const tt = s / (steps - 1);
          const px = x0 + (x1 - x0) * tt;
          const py = y0 + (y1 - y0) * tt;
          const rad = wBase * (1 - tt * 0.82) + 0.6;
          const a = alpha * (1 - tt) * (1 - tt);
          if (a <= 0.003) continue;
          // Blend the hot core colour at the root into the cooler tip colour.
          const cr = r + (tr - r) * tt, cg = g + (tg - g) * tt, cb = b + (tb - b) * tt;
          const gg = ctx.createRadialGradient(px, py, 0, px, py, rad);
          gg.addColorStop(0, `rgba(${Math.min(cr + 90, 255)},${Math.min(cg + 72, 255)},${Math.min(cb + 60, 255)},${a})`);
          gg.addColorStop(0.5, `rgba(${cr},${cg},${cb},${a * 0.5})`);
          gg.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
          ctx.fillStyle = gg;
          ctx.beginPath();
          ctx.arc(px, py, rad, 0, Math.PI * 2);
          ctx.fill();
        }
      };

      // Faint spherical haze so the invisible orb still has a ghostly presence.
      const haze = ctx.createRadialGradient(cx, cy, R * 0.15, cx, cy, R * 1.18);
      haze.addColorStop(0, `rgba(${r},${g},${b},${0.015 + bright * 0.05})`);
      haze.addColorStop(0.7, `rgba(${r},${g},${b},${0.008 + bright * 0.03})`);
      haze.addColorStop(1, "rgba(0,0,10,0)");
      ctx.fillStyle = haze;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.18, 0, Math.PI * 2);
      ctx.fill();

      // Ember glow pool — firelight gathering beneath the orb (eases in, lingers).
      const poolTarget = Math.min(bright * 0.55 + flare * 0.5 + embers.length / 140, 1);
      pool += (poolTarget - pool) * (poolTarget > pool ? 0.05 : 0.02);
      if (pool > 0.01) {
        const pw = R * 2.6;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.translate(cx, cy + R * 1.55);
        ctx.scale(1, 0.26);
        const pg = ctx.createRadialGradient(0, 0, 0, 0, 0, pw);
        pg.addColorStop(0, `rgba(${Math.min(r + 45, 255)},${Math.min(g + 32, 255)},${Math.min(b + 26, 255)},${0.03 + pool * 0.2})`);
        pg.addColorStop(0.6, `rgba(${r},${g},${b},${0.015 + pool * 0.08})`);
        pg.addColorStop(1, "rgba(0,0,10,0)");
        ctx.fillStyle = pg;
        ctx.beginPath();
        ctx.arc(0, 0, pw, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Ghost flames licking around the sphere's rim/surface (additive glow).
      ctx.globalCompositeOperation = "lighter";
      const flameBright = 0.1 + bright * 0.5 + flare * 0.5;
      // Voice flare pushes tongues sharply outward on each spoken syllable.
      const flareOut = flare * R * 1.5;
      const N = Math.max(6, Math.min(48, Math.round(24 * (cfg.density ?? 1))));
      const tips = [];
      for (let i = 0; i < N; i++) {
        const a0 = (i / N) * Math.PI * 2;
        const sway = Math.sin(t * danceSpeed + i * 1.3) * 0.13 * chaos;
        const a = a0 + sway;
        const flick = 0.35 + 0.65 * Math.abs(Math.sin(t * (2.4 + danceSpeed) * chaos + i * 4.7));
        const len = R * (0.16 + 0.55 * flick * (0.45 + eff)) + flareOut * (0.6 + 0.4 * flick);
        const bx = cx + Math.cos(a) * R;
        const by = cy + Math.sin(a) * R;
        const tang = a + Math.PI / 2;
        // Straighten the sway when flaring so flames shoot outward sharply.
        const swayAmt = Math.sin(t * danceSpeed * 1.5 + i) * len * 0.4 * chaos * (1 - Math.min(flare * 1.2, 0.85));
        const tipx = bx + Math.cos(a) * len + Math.cos(tang) * swayAmt;
        const tipy = by + Math.sin(a) * len + Math.sin(tang) * swayAmt;
        drawFlameTongue(bx, by, tipx, tipy, R * 0.12 * (0.6 + flick), flameBright);
        tips.push({ x: tipx, y: tipy });
      }
      // A few faint licks across the FRONT surface so it feels wrapped in fire.
      const M = Math.max(4, Math.round(9 * (cfg.density ?? 1)));
      for (let i = 0; i < M; i++) {
        const ang = t * 0.35 * danceSpeed + i * ((Math.PI * 2) / M);
        const rr = R * (0.28 + 0.55 * Math.abs(Math.sin(t * 0.7 + i * 1.7)));
        const bx = cx + Math.cos(ang) * rr;
        const by = cy + Math.sin(ang) * rr;
        const flick = Math.abs(Math.sin(t * 3.6 * chaos + i * 2.3));
        const len = R * 0.13 * (0.5 + eff);
        drawFlameTongue(bx, by, bx + Math.sin(t * 2 + i) * len * 0.5, by - len * (0.5 + flick), R * 0.06, flameBright * 0.55);
      }

      // Faint rising embers that drift off the flame tips for a ghostly atmosphere.
      if (tips.length) {
        const spawnChance = 0.22 + bright * 0.45 + flare * 1.1;
        const spawns = (Math.random() < spawnChance ? 1 : 0) + (Math.random() < flare * 1.2 ? 1 : 0);
        for (let k = 0; k < spawns; k++) {
          const tip = tips[(Math.random() * tips.length) | 0];
          embers.push({
            x: tip.x + (Math.random() - 0.5) * R * 0.15,
            y: tip.y + (Math.random() - 0.5) * R * 0.1,
            vx: (Math.random() - 0.5) * 0.4,
            vy: -(0.25 + Math.random() * 0.55) - flare * 1.8,
            life: 1,
            rad: 0.8 + Math.random() * (1.6 + flare * 2),
          });
        }
      }
      // Idle whisper — a few lone embers rise slowly even at rest, so it's never fully still.
      if (tips.length && Math.random() < 0.03) {
        const tip = tips[(Math.random() * tips.length) | 0];
        embers.push({
          x: tip.x, y: tip.y,
          vx: (Math.random() - 0.5) * 0.15,
          vy: -(0.12 + Math.random() * 0.18),
          life: 1, rad: 0.7 + Math.random() * 1,
        });
      }
      if (embers.length > 100) embers = embers.slice(embers.length - 100);
      for (const e of embers) {
        e.x += e.vx;
        e.y += e.vy;
        e.vy -= 0.006;        // buoyancy — keep rising
        e.vx *= 0.99;
        e.life -= 0.014;
        if (e.life <= 0) continue;
        const a = e.life * e.life * (0.12 + bright * 0.14);
        const gr = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, e.rad + 1.2);
        gr.addColorStop(0, `rgba(${Math.min(tr + 80, 255)},${Math.min(tg + 60, 255)},${Math.min(tb + 50, 255)},${a})`);
        gr.addColorStop(1, `rgba(${tr},${tg},${tb},0)`);
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.rad + 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
      embers = embers.filter((e) => e.life > 0 && e.y > -20);
      ctx.globalCompositeOperation = "source-over";

      raf = requestAnimationFrame(render);
    };
    render();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [canvasRef, energyRef, configRef]);
}

function energyFor(m, c) {
  if (m === "listening") return Math.max(c.idle + 0.25, 0.45);
  if (m === "thinking") return 0.55 + c.chaos * 0.65;
  if (m === "speaking") return 0.55;
  return c.idle;
}

const CONV_KEY = "promethius_orb_conv";

export default function Orb() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const canvasRef = useRef(null);
  const energyRef = useRef(0.12);
  const voiceRef = useRef(0);
  const flashRef = useRef(0);
  const configRef = useRef(DEFAULT_ORB);
  const [state, setState] = useState("dormant"); // dormant|idle|listening|thinking|speaking
  const [status, setStatus] = useState("Listening — just speak to Promethius");
  const [showSettings, setShowSettings] = useState(false);
  const [fs, setFs] = useState(false);
  const modelRef = useRef({ provider: "anthropic", model: "claude-sonnet-4-6" });

  const recogRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const armedRef = useRef(false);
  const busyRef = useRef(false);
  const mediaRecRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const rollingRef = useRef(null);
  const pendingEnrollRef = useRef(null);
  const standbyRef = useRef(false);
  const supportsSR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);

  useOrbCanvas(canvasRef, energyRef, configRef, voiceRef, flashRef, standbyRef);

  useEffect(() => {
    api.get("/auth/me").then((r) => {
      if (r.data.orb) configRef.current = { ...DEFAULT_ORB, ...r.data.orb };
      if (r.data.provider) modelRef.current.provider = r.data.provider;
      if (r.data.model) modelRef.current.model = r.data.model;
    }).catch(() => {});
    const onCfg = (e) => { configRef.current = { ...DEFAULT_ORB, ...e.detail }; };
    window.addEventListener("orb-config", onCfg);
    const onFs = () => setFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      window.removeEventListener("orb-config", onCfg);
      document.removeEventListener("fullscreenchange", onFs);
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      document.documentElement.requestFullscreen?.().catch(() => {});
    }
  }, []);

  const setMode = useCallback((m, msg) => {
    setState(m);
    energyRef.current = energyFor(m, configRef.current);
    if (msg !== undefined) setStatus(msg);
  }, []);

  const speak = useCallback(async (text) => {
    try {
      setMode("speaking", "Promethius speaks");
      const r = await api.post("/voice/tts", { text }, { responseType: "blob" });
      const url = URL.createObjectURL(r.data);
      const audio = new Audio(url);
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      const actx = audioCtxRef.current;
      const src = actx.createMediaElementSource(audio);
      const analyser = actx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      analyser.connect(actx.destination);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      let raf;
      const spk = energyFor("speaking", configRef.current);
      const tick = () => {
        analyser.getByteFrequencyData(buf);
        const avg = buf.reduce((a, b) => a + b, 0) / buf.length / 255;
        energyRef.current = spk;
        voiceRef.current = avg;
        raf = requestAnimationFrame(tick);
      };
      tick();
      await new Promise((resolve) => {
        audio.onended = () => { cancelAnimationFrame(raf); voiceRef.current = 0; URL.revokeObjectURL(url); resolve(); };
        audio.play().catch(() => { cancelAnimationFrame(raf); voiceRef.current = 0; resolve(); });
      });
      return true;
    } catch (e) {
      // Voice (ElevenLabs) failed — surface the text so the user still gets the reply
      const detail = e?.response?.status === 503 || e?.response?.status === 401
        ? "Voice is unavailable (check your ElevenLabs API key)."
        : "Voice playback failed.";
      toast.error(detail, { description: typeof text === "string" ? text.slice(0, 180) : undefined, duration: 8000 });
      return false;
    }
  }, [setMode]);

  const ask = useCallback(async (query, speaker = null) => {
    if (!query || busyRef.current) return;
    busyRef.current = true;
    armedRef.current = false;
    pauseListening();
    setMode("thinking", speaker ? `Promethius is thinking (with ${speaker})...` : "Promethius is thinking...");
    try {
      const r = await api.post("/chat", {
        conversation_id: localStorage.getItem(CONV_KEY) || null,
        provider: modelRef.current.provider, model: modelRef.current.model, message: query, speaker,
      });
      localStorage.setItem(CONV_KEY, r.data.conversation_id);
      const spoke = await speak(r.data.reply);
      if (!spoke && r.data.reply) {
        toast("Promethius", { description: r.data.reply.slice(0, 240), duration: 9000 });
      }
    } catch (e) {
      const msg = e?.response?.data?.detail || e?.message || "Unknown error";
      setMode("idle", "Promethius hit an error");
      toast.error("Promethius couldn't respond", { description: String(msg).slice(0, 200), duration: 9000 });
    } finally {
      busyRef.current = false;
      resumeListening();
    }
  }, [setMode, speak]);

  const enroll = useCallback(async (name) => {
    busyRef.current = true;
    pauseListening();
    setMode("speaking", `Greeting ${name}...`);
    await speak(`Hello, ${name}.`);
    pendingEnrollRef.current = name;
    busyRef.current = false;
    setMode("listening", `Go ahead and speak, ${name} — I'll remember your voice.`);
    resumeListening();
  }, [setMode, speak]);

  const commitEnrollment = useCallback(async (name, utterance) => {
    try {
      const wav = rollingRef.current ? rollingRef.current.snapshot() : null;
      if (wav) {
        const fd = new FormData();
        fd.append("name", name);
        fd.append("file", wav, "voice.wav");
        await api.post("/speakers/enroll", fd);
        flashRef.current = Date.now() + 1800;
        setMode("speaking", `✓ ${name} remembered`);
        toast.success(`Learned ${name}'s voice`);
      }
    } catch (e) {
      // enrollment failed — still respond to what they said
    }
    ask(utterance, name);
  }, [ask, setMode]);

  const forget = useCallback(async (name) => {
    busyRef.current = true;
    pauseListening();
    setMode("thinking", `Forgetting ${name}...`);
    try {
      const list = await api.get("/speakers");
      const match = (list.data || []).find((s) => s.name.toLowerCase() === name.toLowerCase());
      if (match) {
        await api.delete(`/speakers/${match.id}`);
        await speak(`I've forgotten ${match.name} and everything I knew about them.`);
        toast.success(`Removed ${match.name}`);
      } else {
        await speak(`I don't have anyone named ${name} enrolled.`);
      }
    } catch (e) {
      // ignore
    } finally {
      busyRef.current = false;
      resumeListening();
    }
  }, [setMode, speak]);

  const identifyThenAsk = useCallback(async (query) => {
    let speaker = null;
    try {
      if (rollingRef.current) {
        const wav = rollingRef.current.snapshot();
        const fd = new FormData();
        fd.append("file", wav, "utt.wav");
        const r = await api.post("/speakers/identify", fd);
        speaker = r.data.speaker || null;
      }
    } catch (e) {}
    ask(query, speaker);
  }, [ask]);

  const isOpenChatCommand = (text) =>
    /(open|show|go to|enter|switch to|take me to).*(prompt|chat|forge|text|keyboard)/.test(text) ||
    /prompt window|text mode|the forge/.test(text);

  const titleCase = (s) => s.trim().replace(/\b\w/g, (c) => c.toUpperCase());

  const interpret = useCallback((q) => {
    const ql = q.trim().toLowerCase();
    let m;
    if ((m = ql.match(/^this is ([a-z][a-z'’\- ]{1,30})/))) { enroll(titleCase(m[1])); return; }
    if ((m = ql.match(/^(?:forget|remove|delete|erase) ([a-z][a-z'’\- ]{1,30})/))) { forget(titleCase(m[1])); return; }
    identifyThenAsk(q.trim());
  }, [enroll, forget, identifyThenAsk]);

  const handleFinal = useCallback((raw) => {
    const text = raw.trim().toLowerCase();
    if (!text || text.length < 2 || busyRef.current) return;

    // Standby mode: ignore everything until the name "Promethius" is spoken.
    if (standbyRef.current) {
      if (/prom[ae]th[a-z]*/.test(text)) {
        standbyRef.current = false;
        pauseListening();
        setMode("listening", "I'm here.");
        speak("I'm here.").finally(() => resumeListening());
      }
      return;
    }

    // "Promethius, standby" (or just "standby") -> enter standby.
    if (/\bstand\s?by\b/.test(text)) {
      standbyRef.current = true;
      pauseListening();
      setMode("idle", "");
      speak("Standing by.").finally(() => resumeListening());
      return;
    }

    // A pending introduction: the next thing this person says commits their voiceprint.
    if (pendingEnrollRef.current) {
      const name = pendingEnrollRef.current;
      pendingEnrollRef.current = null;
      commitEnrollment(name, raw.trim());
      return;
    }
    if (isOpenChatCommand(text)) {
      setMode("thinking", "Opening the prompt...");
      setTimeout(() => navigate("/chat"), 400);
      return;
    }
    // No wake word needed — every spoken phrase is treated as a request.
    interpret(raw.trim());
  }, [interpret, navigate, setMode, speak, commitEnrollment]);

  const pauseListening = () => {
    try { recogRef.current && recogRef.current.stop(); } catch (e) {}
  };
  const resumeListening = () => {
    if (!supportsSR) { setMode("idle", "Tap the orb to speak"); return; }
    setMode("idle", standbyRef.current ? "" : "Listening — just speak");
    try { recogRef.current && recogRef.current.start(); } catch (e) {}
  };

  const startWakeWord = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recog = new SR();
    recog.continuous = true;
    recog.interimResults = true;
    recog.lang = "en-US";
    recog.onresult = (ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) handleFinal(ev.results[i][0].transcript);
      }
    };
    recog.onend = () => {
      if (!busyRef.current) {
        try { recog.start(); } catch (e) {}
      }
    };
    recog.onerror = () => {};
    recogRef.current = recog;
    try { recog.start(); } catch (e) {}
    setMode("idle", "Listening — just speak");
  }, [handleFinal, setMode]);

  // Fallback: push-to-talk via MediaRecorder when SpeechRecognition is unavailable
  const togglePushToTalk = async () => {
    if (busyRef.current) return;
    if (mediaRecRef.current && mediaRecRef.current.state === "recording") {
      mediaRecRef.current.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => chunksRef.current.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((tk) => tk.stop());
        setMode("thinking", "Transcribing...");
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const fd = new FormData();
        fd.append("file", blob, "audio.webm");
        try {
          const r = await api.post("/voice/transcribe", fd);
          if (r.data.text?.trim()) ask(r.data.text.trim());
          else setMode("idle", "Tap the orb to speak");
        } catch { setMode("idle", "Tap the orb to speak"); }
      };
      mr.start();
      mediaRecRef.current = mr;
      setMode("listening", "Listening... tap again to send");
    } catch {
      toast.error("Microphone access denied");
    }
  };

  const awaken = async () => {
    if (state !== "dormant") {
      if (!supportsSR) togglePushToTalk();
      return;
    }
    try {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      await audioCtxRef.current.resume();
    } catch (e) {}
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      if (audioCtxRef.current) rollingRef.current = createRollingRecorder(stream, audioCtxRef.current, 5);
    } catch (e) {}
    if (supportsSR) {
      startWakeWord();
      toast.success("Promethius is listening. Just speak.");
    } else {
      setMode("idle", "Tap the orb to speak (voice needs Chrome)");
      toast.info("Continuous voice needs Chrome. Tap the orb to talk.");
    }
  };

  // Start listening automatically on load — no tap, no wake word.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    awaken();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the screen awake so the orb stays on and the device won't sleep
  // while Promethius is up (including standby). Re-acquires when tab regains focus.
  useEffect(() => {
    let lock = null;
    const acquire = async () => {
      try {
        if ("wakeLock" in navigator && document.visibilityState === "visible") {
          lock = await navigator.wakeLock.request("screen");
        }
      } catch (e) { /* wake lock unavailable */ }
    };
    acquire();
    const onVis = () => { if (document.visibilityState === "visible") acquire(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      try { lock && lock.release(); } catch (e) {}
    };
  }, []);

  useEffect(() => () => {
    try { recogRef.current && recogRef.current.stop(); } catch (e) {}
    try { rollingRef.current && rollingRef.current.stop(); } catch (e) {}
    try { streamRef.current && streamRef.current.getTracks().forEach((t) => t.stop()); } catch (e) {}
  }, []);

  return (
    <div className="relative h-screen w-screen bg-black overflow-hidden select-none">
      <canvas
        ref={canvasRef}
        data-testid="orb-canvas"
        onClick={awaken}
        className="absolute inset-0 w-full h-full cursor-pointer"
      />

      {/* top controls */}
      <div className="absolute top-5 right-5 z-20 flex items-center gap-3">
        <a data-testid="orb-install-guide-link" href="/install" className="text-white/30 hover:text-white/80 transition-colors" title="Local install guide">
          <BookDown size={20} strokeWidth={1.5} />
        </a>
        <button data-testid="orb-fullscreen-button" onClick={toggleFullscreen} className="text-white/30 hover:text-white/80 transition-colors" title={fs ? "Exit fullscreen" : "Fullscreen"}>
          {fs ? <Minimize size={20} strokeWidth={1.5} /> : <Maximize size={20} strokeWidth={1.5} />}
        </button>
        <button data-testid="orb-settings-button" onClick={() => setShowSettings(true)} className="text-white/30 hover:text-white/80 transition-colors" title="Voice & settings">
          <SettingsIcon size={20} strokeWidth={1.5} />
        </button>
        <button data-testid="orb-open-chat-button" onClick={() => navigate("/chat")} className="text-white/30 hover:text-white/80 transition-colors" title="Open prompt window">
          <MessageSquare size={20} strokeWidth={1.5} />
        </button>
        <button data-testid="orb-logout-button" onClick={logout} className="text-white/30 hover:text-white/80 transition-colors" title="Logout">
          <LogOut size={20} strokeWidth={1.5} />
        </button>
      </div>

      {/* status hint */}
      <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-20 text-center pointer-events-none">
        <p data-testid="orb-status" className="font-mono text-xs uppercase tracking-[0.3em] text-white/35">{status}</p>
        {state !== "dormant" && (
          <p className="font-body text-[11px] text-white/20 mt-2">Say "Promethius..." &nbsp;·&nbsp; "open the prompt" to type</p>
        )}
      </div>

      {showSettings && <VoiceSettings onClose={() => setShowSettings(false)} />}
    </div>
  );
}
