import { useState } from "react";
import { Flame, Loader2, Fingerprint, KeyRound } from "lucide-react";
import { startRegistration, startAuthentication } from "@simplewebauthn/browser";
import { toast } from "sonner";
import { useAuth } from "../context/AuthContext";
import api from "../lib/api";
import { APP_VERSION } from "../lib/version";

const BG = "https://images.pexels.com/photos/9665179/pexels-photo-9665179.jpeg";

export default function Auth() {
  const { applySession } = useAuth();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState("login"); // login | register | recover
  const [code, setCode] = useState("");
  const [recoverStep, setRecoverStep] = useState("email");
  const [restoring, setRestoring] = useState(false);

  const restore = async () => {
    if (restoring) return;
    if (!window.confirm("Restore Promethius to the last version that started cleanly? It will rebuild and restart (~30–60s).")) return;
    setRestoring(true);
    try {
      const r = await api.post("/system/restore");
      toast.success(`Restoring to ${r.data?.commit || "last good"}… Promethius will restart. Reload this page in ~45s.`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Restore unavailable here.");
    } finally {
      setRestoring(false);
    }
  };

  const supported = typeof window !== "undefined" && window.PublicKeyCredential;

  const requestCode = async () => {
    if (!email.trim()) { toast.error("Enter your email"); return; }
    setLoading(true);
    try {
      await api.post("/recovery/request", { email });
      setRecoverStep("code");
      toast.success("If that account exists, a code is on its way.");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not send code");
    } finally { setLoading(false); }
  };

  const verifyCode = async () => {
    if (!code.trim()) { toast.error("Enter the code"); return; }
    setLoading(true);
    try {
      const res = await api.post("/recovery/verify", { email, code });
      applySession(res.data);
      toast.success("Recovered. Add a new passkey in Settings → Passkeys.");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Invalid code");
    } finally { setLoading(false); }
  };

  const register = async () => {
    if (!email.trim()) { toast.error("Enter your email"); return; }
    setLoading(true);
    try {
      const opt = await api.post("/webauthn/register/options", { email, name });
      const att = await startRegistration({ optionsJSON: opt.data.options });
      const res = await api.post("/webauthn/register/verify", { flow_id: opt.data.flow_id, credential: att });
      applySession(res.data);
      toast.success("Passkey created. Welcome to Promethius.");
    } catch (e) {
      const msg = e?.response?.data?.detail || (e?.name === "NotAllowedError" ? "Passkey prompt was dismissed" : "Could not create passkey");
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const login = async () => {
    if (!email.trim()) { toast.error("Enter your email"); return; }
    setLoading(true);
    try {
      const opt = await api.post("/webauthn/login/options", { email });
      const asse = await startAuthentication({ optionsJSON: opt.data.options });
      const res = await api.post("/webauthn/login/verify", { flow_id: opt.data.flow_id, credential: asse });
      applySession(res.data);
      toast.success("Welcome back.");
    } catch (e) {
      const msg = e?.response?.data?.detail || (e?.name === "NotAllowedError" ? "Passkey prompt was dismissed" : "Passkey login failed");
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      <div className="hidden lg:block lg:w-1/2 relative bg-cover bg-center" style={{ backgroundImage: `url(${BG})` }}>
        <div className="absolute inset-0 bg-gradient-to-tr from-[#09090b] via-[#09090b]/60 to-transparent" />
        <div className="absolute bottom-16 left-16 right-16">
          <div className="flex items-center gap-3 mb-6">
            <Flame className="text-orange-500" size={32} strokeWidth={1.5} />
            <span className="font-heading text-3xl font-bold tracking-tight">Promethius</span>
            <span data-testid="app-version-auth" className="font-mono text-xs text-zinc-500 self-end mb-1">{APP_VERSION}</span>
          </div>
          <h2 className="font-heading text-4xl font-medium tracking-tighter leading-tight text-zinc-100">
            The fire of knowledge,
            <br /> sealed by your touch.
          </h2>
          <p className="font-body text-zinc-400 mt-4 max-w-md leading-relaxed">
            No passwords. Sign in with your fingerprint, Face ID, or device passkey — only you can wake Promethius.
          </p>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-6 py-12 relative">
        <div className="w-full max-w-sm animate-fade-up">
          <div className="lg:hidden flex items-center gap-3 mb-10 justify-center">
            <Flame className="text-orange-500" size={28} strokeWidth={1.5} />
            <span className="font-heading text-2xl font-bold">Promethius</span>
          </div>

          <div className="w-14 h-14 rounded-2xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center mb-6">
            <Fingerprint size={28} className="text-orange-500" strokeWidth={1.5} />
          </div>

          <h1 className="font-heading text-3xl font-medium tracking-tight mb-1">
            {mode === "recover" ? "Recover your account" : mode === "login" ? "Unlock with your passkey" : "Create your passkey"}
          </h1>
          <p className="text-zinc-500 text-sm mb-8 font-mono uppercase tracking-widest text-xs">
            {mode === "recover" ? "One-time email code" : mode === "login" ? "Fingerprint · Face ID · Device" : "One touch — no password ever"}
          </p>

          {!supported && mode !== "recover" && (
            <p className="text-amber-400/80 text-xs mb-4 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
              This browser/device doesn't support passkeys. Use a device with a fingerprint reader, Face ID, or Windows Hello.
            </p>
          )}

          {mode === "recover" ? (
            <div className="space-y-4">
              <input
                data-testid="recover-email-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                disabled={recoverStep === "code"}
                className="w-full bg-[#121214] border border-white/10 rounded-xl px-4 py-3 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-orange-500/50 transition-colors disabled:opacity-60"
              />
              {recoverStep === "code" && (
                <input
                  data-testid="recover-code-input"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="6-digit code"
                  inputMode="numeric"
                  maxLength={6}
                  className="w-full bg-[#121214] border border-white/10 rounded-xl px-4 py-3 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-orange-500/50 transition-colors tracking-[0.4em] text-center font-mono text-lg"
                />
              )}
              <button
                data-testid="recover-submit-button"
                onClick={recoverStep === "email" ? requestCode : verifyCode}
                disabled={loading}
                className="w-full bg-orange-600 hover:bg-orange-500 text-white rounded-xl py-3 font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {loading && <Loader2 className="animate-spin" size={18} />}
                {recoverStep === "email" ? "Send recovery code" : "Verify & sign in"}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {mode === "register" && (
                <input
                  data-testid="auth-name-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className="w-full bg-[#121214] border border-white/10 rounded-xl px-4 py-3 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-orange-500/50 transition-colors"
                />
              )}
              <input
                data-testid="auth-email-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                className="w-full bg-[#121214] border border-white/10 rounded-xl px-4 py-3 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-orange-500/50 transition-colors"
              />
              <button
                data-testid="auth-submit-button"
                onClick={mode === "login" ? login : register}
                disabled={loading || !supported}
                className="w-full bg-orange-600 hover:bg-orange-500 text-white rounded-xl py-3 font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {loading ? <Loader2 className="animate-spin" size={18} /> : mode === "login" ? <Fingerprint size={18} /> : <KeyRound size={18} />}
                {mode === "login" ? "Sign in with passkey" : "Create passkey"}
              </button>
            </div>
          )}

          {mode === "recover" ? (
            <p className="text-zinc-500 text-sm mt-6 text-center">
              <button data-testid="recover-back" onClick={() => { setMode("login"); setRecoverStep("email"); setCode(""); }} className="text-orange-500 hover:text-orange-400 font-medium">
                Back to sign in
              </button>
            </p>
          ) : (
            <>
              <p className="text-zinc-500 text-sm mt-6 text-center">
                {mode === "login" ? "First time here?" : "Already have a passkey?"}{" "}
                <button
                  data-testid="auth-toggle-mode"
                  onClick={() => setMode(mode === "login" ? "register" : "login")}
                  className="text-orange-500 hover:text-orange-400 font-medium"
                >
                  {mode === "login" ? "Create a passkey" : "Sign in"}
                </button>
              </p>
              {mode === "login" && (
                <p className="text-center mt-3">
                  <button data-testid="lost-devices-link" onClick={() => { setMode("recover"); setRecoverStep("email"); }} className="text-zinc-600 hover:text-zinc-400 text-xs font-mono uppercase tracking-wider">
                    Lost your devices?
                  </button>
                </p>
              )}
              {mode === "login" && (
                <p className="text-center mt-2">
                  <button data-testid="restore-last-good" onClick={restore} disabled={restoring} className="text-zinc-600 hover:text-orange-400 text-xs font-mono uppercase tracking-wider disabled:opacity-50">
                    {restoring ? "Restoring…" : "Restore last good version"}
                  </button>
                </p>
              )}
            </>
          )}

          <div data-testid="auth-credit" className="mt-12 text-center">
            <a data-testid="auth-install-guide-link" href="/install" className="font-mono text-[10px] uppercase tracking-[0.3em] text-orange-500/70 hover:text-orange-400 transition-colors">
              Install Promethius locally →
            </a>
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-600 mt-6">Built by Robert Corn</p>
            <p className="font-heading text-sm tracking-[0.2em] text-zinc-700 mt-1">MMXXVI</p>
          </div>
        </div>
      </div>
    </div>
  );
}
