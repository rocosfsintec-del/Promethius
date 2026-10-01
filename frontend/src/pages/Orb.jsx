import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Settings as SettingsIcon, MessageSquare, LogOut, BookDown, Maximize, Minimize } from "lucide-react";
import { toast } from "sonner";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import VoiceSettings from "../components/VoiceSettings";
import { createRollingRecorder } from "../lib/audio";
import { DEFAULT_ORB, hexToRgb } from "../lib/orbConfig";

// ---- Personal LLM plasma orb (ported from user's LLMOrb) -------------------
function useOrbCanvas(canvasRef, energyRef, configRef, voiceRef, flashRef, standbyRef) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let raf;
    let t = 0;
    let smooth = 0;
    let voiceSmooth = 0;
    let flare = 0;

    const MAXF = 60;
    const flames = Array.from({ length: MAXF }, () => ({
      len: 0.72 + Math.random() * 0.18,
      speed: 0.8 + Math.random() * 1.4,
      phase: Math.random() * Math.PI * 2,
      width: 8 + Math.random() * 10,
    }));

    const hexToHue = (hex) => {
      const { r, g, b } = hexToRgb(hex);
      const rn = r / 255, gn = g / 255, bn = b / 255;
      const mx = Math.max(rn, gn, bn), mn = Math.min(rn, gn, bn), d = mx - mn;
      let hh = 0;
      if (d) {
        if (mx === rn) hh = ((gn - bn) / d) % 6;
        else if (mx === gn) hh = (bn - rn) / d + 2;
        else hh = (rn - gn) / d + 4;
        hh *= 60;
        if (hh < 0) hh += 360;
      }
      return hh;
    };

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
      t += 0.016;
      smooth += (energyRef.current - smooth) * 0.08;
      voiceSmooth += ((voiceRef ? voiceRef.current : 0) - voiceSmooth) * 0.4;
      const vNow = voiceRef ? voiceRef.current : 0;
      flare += (vNow - flare) * (vNow > flare ? 0.6 : 0.12);

      const sb = standbyRef && standbyRef.current;
      const w = canvas.clientWidth, h = canvas.clientHeight, cx = w / 2;
      const cy = h / 2 + Math.sin(t * (sb ? 0.12 : 0.6)) * 16 * (cfg.floatSpeed * 2) * (sb ? 0.6 : 1);

      ctx.clearRect(0, 0, w, h);
      // Pure black background — orb is the only light source
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, w, h);

      let act = Math.min(smooth + voiceSmooth * 1.6, 1.3);
      if (sb) act = Math.min(act, 0.12);
      const flashing = flashRef && flashRef.current > Date.now();
      const hue = flashing ? 140 : hexToHue(cfg.color);
      const lightMul = 0.55 + (cfg.lightning ?? 0.9) * 0.6;
      const p = {
        pulse: 0.035 + act * 0.12,
        swirl: 1.1 + act * 2.6,
        brightness: (1.0 + act * 0.5 + voiceSmooth * 0.6) * lightMul,
        flicker: (0.8 + act * 1.8 + flare * 2.2) * (cfg.chaos ?? 1),
        hue,
      };

      const breath = 1 + Math.sin(t * (act < 0.2 ? 1.2 : 3.4)) * p.pulse;
      const base = Math.min(w, h) * (cfg.size ?? 0.16);
      const radius = base * breath;

      // ── DEEP OUTER HALO ──────────────────────────────────────────────
      const deepGlow = ctx.createRadialGradient(cx, cy, radius * 0.5, cx, cy, radius * 2.8);
      deepGlow.addColorStop(0, `hsla(${hue}, 100%, 70%, ${0.12 * p.brightness})`);
      deepGlow.addColorStop(0.4, `hsla(${hue}, 100%, 55%, 0.06)`);
      deepGlow.addColorStop(1, `hsla(${hue}, 100%, 40%, 0)`);
      ctx.fillStyle = deepGlow;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 2.8, 0, Math.PI * 2);
      ctx.fill();

      // ── ROTATING ENERGY BANDS (plasma turbulence) ────────────────────
      const bands = 5;
      for (let b = 0; b < bands; b++) {
        const bAngle = (b / bands) * Math.PI * 2 + t * 0.18 * (b % 2 === 0 ? 1 : -1);
        const bRadius = radius * (0.55 + b * 0.09);
        const bAlpha = (0.06 + act * 0.08) * p.brightness * (1 - b * 0.12);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(bAngle);
        const bandGrad = ctx.createLinearGradient(-bRadius, 0, bRadius, 0);
        bandGrad.addColorStop(0, `hsla(${hue + b * 8}, 100%, 75%, 0)`);
        bandGrad.addColorStop(0.5, `hsla(${hue + b * 8}, 100%, 80%, ${bAlpha})`);
        bandGrad.addColorStop(1, `hsla(${hue + b * 8}, 100%, 75%, 0)`);
        ctx.strokeStyle = bandGrad;
        ctx.lineWidth = 2 + b * 0.8;
        ctx.beginPath();
        ctx.ellipse(0, 0, bRadius, bRadius * (0.3 + b * 0.05), 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // ── ELECTRIC ARC TRACES (lightning lattice) ───────────────────────
      const arcCount = Math.round(4 + act * 8 + flare * 6);
      const drawArc = (x1, y1, depth, energy) => {
        if (depth === 0 || energy < 0.015) return;
        const angle = Math.atan2(y1 - cy, x1 - cx) + (Math.random() - 0.5) * 1.2;
        const len = (radius * 0.25 + Math.random() * radius * 0.35) * energy;
        const x2 = x1 + Math.cos(angle) * len;
        const y2 = y1 + Math.sin(angle) * len;
        const dx2 = x2 - cx, dy2 = y2 - cy;
        const dist2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
        const clampR = Math.min(dist2, radius * 1.05);
        const cx2 = cx + (dx2 / dist2) * clampR;
        const cy2 = cy + (dy2 / dist2) * clampR;
        const alpha = 0.35 + act * 0.45 + Math.random() * 0.2;
        ctx.strokeStyle = `hsla(${hue}, 100%, 92%, ${alpha})`;
        ctx.lineWidth = 0.5 + depth * 0.3;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(cx2, cy2);
        ctx.stroke();
        if (Math.random() > 0.45) drawArc(cx2, cy2, depth - 1, energy * 0.6);
      };

      const arcSeed = act > 0.1 || flare > 0.05;
      if (arcSeed) {
        for (let a = 0; a < arcCount; a++) {
          const seedAngle = Math.random() * Math.PI * 2;
          const seedR = radius * (0.25 + Math.random() * 0.55);
          const sx = cx + Math.cos(seedAngle) * seedR;
          const sy = cy + Math.sin(seedAngle) * seedR;
          drawArc(sx, sy, 3, 0.6 + act * 0.8 + flare);
        }
      }

      // ── FIRE TENDRILS (rising from top, concentrated) ─────────────────
      const nF = Math.max(10, Math.min(MAXF, Math.round(26 * (cfg.density ?? 1))));
      const flareOut = flare * 0.5;
      for (let i = 0; i < nF; i++) {
        const f = flames[i];
        const spread = 1.22;
        const fa = (Math.PI * 1.5 - spread) + (i / nF) * spread * 2;
        const flicker = 1 + Math.sin(t * f.speed * p.flicker + f.phase) * 0.22;
        const a = fa + Math.sin(t * 0.8 + i * 0.4) * 0.12;
        const inner = radius * 0.88;
        const outer = radius * f.len * flicker * ((act < 0.2 ? 1.3 : 1.65) + flareOut);
        const x1 = cx + Math.cos(a) * inner;
        const y1 = cy + Math.sin(a) * inner;
        const x2 = cx + Math.cos(a) * outer;
        const y2 = cy + Math.sin(a) * outer - 22 * flicker;
        const gg = ctx.createLinearGradient(x1, y1, x2, y2);
        gg.addColorStop(0, `hsla(${hue}, 100%, 85%, 0)`);
        gg.addColorStop(0.2, `hsla(${hue}, 100%, 75%, ${0.65 * p.brightness})`);
        gg.addColorStop(0.7, `hsla(${hue + 15}, 100%, 88%, ${0.35 * p.brightness})`);
        gg.addColorStop(1, `hsla(${hue + 20}, 100%, 95%, 0)`);
        ctx.strokeStyle = gg;
        ctx.lineWidth = f.width * (0.5 + 0.5 * flicker);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        const midX = (x1 + x2) / 2 + Math.sin(t * 2.2 + i) * 10;
        const midY = (y1 + y2) / 2 + Math.cos(t * 1.8 + i) * 7;
        ctx.quadraticCurveTo(midX, midY, x2, y2);
        ctx.stroke();
      }

      // ── PLASMA SPHERE BODY ───────────────────────────────────────────
      const sphere = ctx.createRadialGradient(cx - radius * 0.28, cy - radius * 0.32, radius * 0.05, cx, cy, radius);
      sphere.addColorStop(0, `hsla(${hue}, 60%, 98%, 0.98)`);
      sphere.addColorStop(0.12, `hsla(${hue}, 90%, 80%, 0.75)`);
      sphere.addColorStop(0.38, `hsla(${hue}, 100%, 55%, 0.5)`);
      sphere.addColorStop(0.68, `hsla(${hue + 10}, 100%, 32%, 0.6)`);
      sphere.addColorStop(0.88, `hsla(${hue}, 100%, 18%, 0.7)`);
      sphere.addColorStop(1, `hsla(${hue}, 100%, 65%, 0.9)`);
      ctx.fillStyle = sphere;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();

      // ── INNER PLASMA TURBULENCE OVERLAY ──────────────────────────────
      const noiseLayers = 3;
      for (let nl = 0; nl < noiseLayers; nl++) {
        const nAngle = t * (0.4 + nl * 0.25) * (nl % 2 === 0 ? 1 : -1);
        const nR = radius * (0.35 + nl * 0.18);
        const nAlpha = (0.06 + act * 0.07) * p.brightness;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(nAngle);
        const noiseGrad = ctx.createRadialGradient(nR * 0.3, -nR * 0.2, 0, 0, 0, nR);
        noiseGrad.addColorStop(0, `hsla(${hue + nl * 15}, 100%, 90%, ${nAlpha})`);
        noiseGrad.addColorStop(1, `hsla(${hue + nl * 15}, 100%, 60%, 0)`);
        ctx.fillStyle = noiseGrad;
        ctx.beginPath();
        ctx.ellipse(0, 0, nR, nR * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // ── WHITE-HOT CORE ───────────────────────────────────────────────
      const corePulse = 1 + Math.sin(t * 5.5) * (act > 0.5 ? 0.22 : 0.07) + flare * 0.25;
      // Outer bloom ring
      const coreBloom = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 0.55 * corePulse);
      coreBloom.addColorStop(0, "rgba(255,255,255,0.0)");
      coreBloom.addColorStop(0.55, `hsla(${hue}, 100%, 75%, ${0.18 * p.brightness})`);
      coreBloom.addColorStop(0.75, `hsla(${hue}, 100%, 60%, ${0.10 * p.brightness})`);
      coreBloom.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = coreBloom;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.55 * corePulse, 0, Math.PI * 2);
      ctx.fill();

      // Inner blinding core
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 0.3 * corePulse);
      core.addColorStop(0, "rgba(255,255,255,1.0)");
      core.addColorStop(0.15, "rgba(235,248,255,0.95)");
      core.addColorStop(0.45, `hsla(${hue}, 100%, 88%, 0.6)`);
      core.addColorStop(0.8, `hsla(${hue}, 100%, 70%, 0.2)`);
      core.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.3 * corePulse, 0, Math.PI * 2);
      ctx.fill();

      // ── BRIGHT CYAN RIM RING ─────────────────────────────────────────
      ctx.shadowBlur = 18;
      ctx.shadowColor = `hsla(${hue}, 100%, 75%, 0.9)`;
      ctx.strokeStyle = `hsla(${hue}, 100%, 85%, 0.75)`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;

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
        if (wav) {
          const fd = new FormData();
          fd.append("file", wav, "voice.wav");
          const res = await api.post("/speakers/identify", fd);
          if (res.data?.name) speaker = res.data.name;
        }
      }
    } catch (e) { /* identification optional */ }
    ask(query, speaker);
  }, [ask]);

  // ── SPEECH RECOGNITION ────────────────────────────────────────────────────
  const pauseListening = useCallback(() => {
    if (recogRef.current) { try { recogRef.current.stop(); } catch (e) {} }
  }, []);

  const resumeListening = useCallback(() => {
    armedRef.current = true;
    setMode("listening", "Listening — just speak to Promethius");
    if (recogRef.current) { try { recogRef.current.start(); } catch (e) {} }
  }, [setMode]);

  useEffect(() => {
    if (!supportsSR) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recog = new SR();
    recog.lang = "en-US";
    recog.continuous = true;
    recog.interimResults = false;
    recogRef.current = recog;

    recog.onresult = (e) => {
      if (!armedRef.current || busyRef.current) return;
      const transcript = Array.from(e.results)
        .slice(e.resultIndex)
        .filter((r) => r.isFinal)
        .map((r) => r[0].transcript.trim())
        .join(" ");
      if (!transcript) return;

      const lower = transcript.toLowerCase();

      // ── WAKE WORD ──
      const wakeWords = ["promethius", "prometheus", "hey promethius", "hey prometheus"];
      if (wakeWords.some((w) => lower.includes(w))) {
        if (!standbyRef.current) {
          standbyRef.current = true;
          setMode("idle", "Promethius active");
          return;
        }
      }

      if (!standbyRef.current) return;

      // ── ENROLLMENT COMMANDS ──
      const enrollMatch = lower.match(/(?:my name is|i(?:'m| am)|call me)\s+([a-z]+)/i);
      if (enrollMatch && !pendingEnrollRef.current) {
        enroll(enrollMatch[1]);
        return;
      }

      // ── FORGET COMMAND ──
      const forgetMatch = lower.match(/forget\s+([a-z]+)/i);
      if (forgetMatch) {
        forget(forgetMatch[1]);
        return;
      }

      // ── PENDING ENROLLMENT ──
      if (pendingEnrollRef.current) {
        const name = pendingEnrollRef.current;
        pendingEnrollRef.current = null;
        commitEnrollment(name, transcript);
        return;
      }

      identifyThenAsk(transcript);
    };

    recog.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      toast.error(`Speech error: ${e.error}`);
    };

    recog.onend = () => {
      if (armedRef.current && !busyRef.current) {
        setTimeout(() => { try { recog.start(); } catch (e) {} }, 300);
      }
    };

    // Auto-start
    armedRef.current = true;
    setMode("listening", "Listening — just speak to Promethius");
    try { recog.start(); } catch (e) {}

    // Rolling recorder for voice identification
    navigator.mediaDevices?.getUserMedia({ audio: true }).then((stream) => {
      streamRef.current = stream;
      rollingRef.current = createRollingRecorder(stream, 6000);
    }).catch(() => {});

    return () => {
      armedRef.current = false;
      try { recog.stop(); } catch (e) {}
      streamRef.current?.getTracks().forEach((t) => t.stop());
      rollingRef.current?.stop?.();
    };
  }, [supportsSR, setMode, enroll, forget, commitEnrollment, identifyThenAsk]);

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div className="relative w-full h-screen bg-black flex flex-col items-center justify-center overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-6 py-4 z-10">
        <span className="text-cyan-400 font-bold text-lg tracking-widest select-none">PROMETHIUS</span>
        <div className="flex gap-3">
          <button onClick={toggleFullscreen} className="text-cyan-400/60 hover:text-cyan-300 transition-colors">
            {fs ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
          <button onClick={() => navigate("/chat")} className="text-cyan-400/60 hover:text-cyan-300 transition-colors">
            <MessageSquare size={18} />
          </button>
          <button onClick={() => navigate("/memories")} className="text-cyan-400/60 hover:text-cyan-300 transition-colors">
            <BookDown size={18} />
          </button>
          <button onClick={() => setShowSettings(true)} className="text-cyan-400/60 hover:text-cyan-300 transition-colors">
            <SettingsIcon size={18} />
          </button>
          <button onClick={logout} className="text-cyan-400/60 hover:text-cyan-300 transition-colors">
            <LogOut size={18} />
          </button>
        </div>
      </div>

      {/* Status */}
      <div className="absolute bottom-10 left-0 right-0 flex flex-col items-center gap-2 z-10">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            state === "listening" ? "bg-cyan-400 animate-pulse" :
            state === "thinking" ? "bg-yellow-400 animate-spin" :
            state === "speaking" ? "bg-green-400 animate-pulse" :
            "bg-gray-600"
          }`} />
          <p className="text-cyan-300/70 text-sm font-mono tracking-wide">{status}</p>
        </div>
        {user && (
          <p className="text-cyan-400/30 text-xs font-mono">{user.username}</p>
        )}
      </div>

      {showSettings && (
        <VoiceSettings
          configRef={configRef}
          modelRef={modelRef}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
