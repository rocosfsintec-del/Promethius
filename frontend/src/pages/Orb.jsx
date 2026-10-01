import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Settings as SettingsIcon, MessageSquare, LogOut, BookDown, Maximize, Minimize } from "lucide-react";
import { toast } from "sonner";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import VoiceSettings from "../components/VoiceSettings";
import { createRollingRecorder } from "../lib/audio";
import { DEFAULT_ORB, hexToRgb } from "../lib/orbConfig";

// ---- Personal LLM plasma orb (WebGL, user's shader + live settings) --------
function useOrbCanvas(canvasRef, energyRef, configRef, voiceRef, flashRef, standbyRef) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl =
      canvas.getContext("webgl", { antialias: false, premultipliedAlpha: false }) ||
      canvas.getContext("experimental-webgl");
    if (!gl) return;

    const VS = `attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`;
    const FS = `
precision highp float;
uniform vec2 uRes;
uniform float uTime, uState, uEnergy, uVoice, uFlare;
uniform float uHue, uTipHue, uSize, uDensity, uChaos, uGlow, uFloat, uStandby;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  float a = hash(i), b = hash(i+vec2(1.0,0.0)), c = hash(i+vec2(0.0,1.0)), d = hash(i+vec2(1.0,1.0));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p=p*2.07+11.3; a*=0.5; } return v; }
vec3 hueRotate(vec3 c, float deg){
  float a=radians(deg), s=sin(a), co=cos(a);
  mat3 m = mat3(
    0.299+0.701*co+0.168*s, 0.587-0.587*co+0.330*s, 0.114-0.114*co-0.497*s,
    0.299-0.299*co-0.328*s, 0.587+0.413*co+0.035*s, 0.114-0.114*co+0.292*s,
    0.299-0.300*co+1.250*s, 0.587-0.588*co-1.050*s, 0.114+0.886*co-0.203*s);
  return clamp(m*c, 0.0, 1.0);
}
void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5*uRes) / min(uRes.y, uRes.x);
  float t = uTime;
  float act = clamp(uEnergy + uVoice*1.4, 0.0, 1.6);
  if (uStandby > 0.5) act = min(act, 0.1);
  uv.y -= sin(t*(0.4 + uFloat*1.2)) * 0.02 * (0.5 + uFloat);
  float chaos = 0.6 + uChaos;
  float breath = 1.0 + (0.012 + act*0.03) * sin(t*(0.9 + uState*0.4 + act));
  float R = clamp(uSize*2.0, 0.12, 0.42) * breath;
  vec3 col = vec3(0.0);
  float r = length(uv);
  if (r < R - 0.001) {
    float z = sqrt(max(0.0, R*R - r*r));
    vec3 n = normalize(vec3(uv, z));
    float lon = atan(n.x, n.z) + t*(0.08 + uState*0.1 + act*0.12);
    float lat = asin(clamp(n.y,-1.0,1.0));
    vec2 suv = vec2(lon*2.1, lat*3.1);
    float v1 = fbm(suv*4.0 + vec2(t*0.12*chaos, -t*0.05));
    float v2 = fbm(suv*8.0 - vec2(t*0.18*chaos, t*0.04));
    float filaments = (smoothstep(0.52,0.78,v1)*0.7 + smoothstep(0.62,0.88,v2)*0.35) * (0.55 + 0.75*uDensity);
    vec2 corePos = vec2(-0.025, 0.015);
    float core = exp(-pow(length(uv-corePos)/0.055, 2.0)) * (1.0 + uFlare*0.5 + act*0.12);
    float limb = smoothstep(0.15, 1.0, r/R);
    float bright = uGlow * (0.8 + act*0.5 + uVoice*0.6);
    vec3 deep = vec3(0.0,0.03,0.12);
    vec3 body = vec3(0.0,0.12,0.42);
    body = mix(body, deep, limb*0.65);
    body += vec3(0.15,0.45,0.95) * filaments * (1.0-limb*0.35) * bright;
    body += vec3(0.75,0.9,1.0) * core * (0.6 + uGlow*0.5);
    body += vec3(0.2,0.45,0.9) * exp(-pow(r/(R*0.42),2.0)) * 0.25 * bright;
    float edge = smoothstep(0.92,1.0, r/R);
    body = mix(body, vec3(0.35,0.62,1.0), edge*0.55);
    col = body;
  }
  float ang = atan(uv.y, uv.x);
  float outside = r - R;
  if (outside > 0.0 && outside < 0.14) {
    float n1 = fbm(vec2(ang*4.0, t*(0.55 + uState*0.35 + act*0.4)*chaos));
    float up = pow(max(sin(ang),0.0), 0.65);
    float reach = (0.02 + pow(n1,1.6)*0.09*(0.6+uDensity)) * (0.35 + 0.65*up) * (1.0 + uFlare*0.6);
    float f = smoothstep(reach, 0.0, outside);
    f *= smoothstep(reach, reach*0.55, outside);
    vec3 flame = mix(vec3(0.02,0.18,0.55), vec3(0.55,0.78,1.0), f);
    flame = hueRotate(flame, uTipHue - uHue);
    col += flame * f * 0.7 * uGlow;
  }
  col = hueRotate(col, uHue);
  if (uStandby > 0.5) col *= 0.4;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(s));
      }
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const aLoc = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(aLoc);
    gl.vertexAttribPointer(aLoc, 2, gl.FLOAT, false, 0, 0);
    const U = (n) => gl.getUniformLocation(prog, n);
    const u = {
      res: U("uRes"), time: U("uTime"), state: U("uState"), energy: U("uEnergy"),
      voice: U("uVoice"), flare: U("uFlare"), hue: U("uHue"), tipHue: U("uTipHue"),
      size: U("uSize"), density: U("uDensity"), chaos: U("uChaos"), glow: U("uGlow"),
      float: U("uFloat"), standby: U("uStandby"),
    };

    const hexToHue = (hex) => {
      const { r, g, b } = hexToRgb(hex);
      const rn = r/255, gn = g/255, bn = b/255;
      const mx = Math.max(rn,gn,bn), mn = Math.min(rn,gn,bn), d = mx-mn;
      let hh = 0;
      if (d) {
        if (mx === rn) hh = ((gn-bn)/d) % 6;
        else if (mx === gn) hh = (bn-rn)/d + 2;
        else hh = (rn-gn)/d + 4;
        hh *= 60; if (hh < 0) hh += 360;
      }
      return hh;
    };
    const BASE_HUE = 210; // the shader's natural blue

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    window.addEventListener("resize", resize);

    let raf, smooth = 0, voiceSmooth = 0, flare = 0;
    const t0 = performance.now();
    const render = (now) => {
      const cfg = configRef.current || DEFAULT_ORB;
      smooth += ((energyRef.current ?? 0.12) - smooth) * 0.08;
      const vNow = voiceRef ? (voiceRef.current || 0) : 0;
      voiceSmooth += (vNow - voiceSmooth) * 0.4;
      flare += (vNow - flare) * (vNow > flare ? 0.6 : 0.12);

      const sb = standbyRef && standbyRef.current ? 1 : 0;
      let act = Math.min(smooth + voiceSmooth * 1.6, 1.6);
      if (sb) act = Math.min(act, 0.1);
      const flashing = flashRef && flashRef.current > Date.now();
      const targetHue = flashing ? 140 : hexToHue(cfg.color);
      const tipHue = hexToHue(cfg.tipColor || "#e8eeff");

      gl.uniform2f(u.res, canvas.width, canvas.height);
      gl.uniform1f(u.time, (now - t0) / 1000);
      gl.uniform1f(u.state, Math.min(act, 2));
      gl.uniform1f(u.energy, smooth);
      gl.uniform1f(u.voice, voiceSmooth);
      gl.uniform1f(u.flare, Math.min(flare, 1.2));
      gl.uniform1f(u.hue, targetHue - BASE_HUE);
      gl.uniform1f(u.tipHue, tipHue - BASE_HUE);
      gl.uniform1f(u.size, Math.min(Math.max(cfg.size ?? 0.16, 0.08), 0.2));
      gl.uniform1f(u.density, cfg.density ?? 1);
      gl.uniform1f(u.chaos, cfg.chaos ?? 1);
      gl.uniform1f(u.glow, 0.55 + (cfg.lightning ?? 0.5) * 0.9 + (flashing ? 0.3 : 0));
      gl.uniform1f(u.float, cfg.floatSpeed ?? 0.5);
      gl.uniform1f(u.standby, sb);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      try { gl.deleteProgram(prog); gl.deleteBuffer(buf); } catch (e) {}
    };
  }, [canvasRef, energyRef, configRef, voiceRef, flashRef, standbyRef]);
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
