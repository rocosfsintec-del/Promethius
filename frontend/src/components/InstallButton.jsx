import { useEffect, useState } from "react";
import { MonitorDown, Check } from "lucide-react";
import { toast } from "sonner";

const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches ||
  window.matchMedia?.("(display-mode: fullscreen)").matches ||
  window.navigator.standalone === true;

export default function InstallButton() {
  const [installable, setInstallable] = useState(!!window.__promethiusInstallPrompt);
  const [installed, setInstalled] = useState(isStandalone());

  useEffect(() => {
    const onCan = () => setInstallable(true);
    const onDone = () => { setInstalled(true); setInstallable(false); };
    window.addEventListener("pwa-installable", onCan);
    window.addEventListener("pwa-installed", onDone);
    return () => {
      window.removeEventListener("pwa-installable", onCan);
      window.removeEventListener("pwa-installed", onDone);
    };
  }, []);

  const install = async () => {
    const prompt = window.__promethiusInstallPrompt;
    if (!prompt) {
      toast("Install from your browser", {
        description: "Open the browser menu (⋮) → \"Install Promethius\" / \"Install app\". On iPhone: Share → Add to Home Screen.",
        duration: 9000,
      });
      return;
    }
    prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "accepted") {
      window.__promethiusInstallPrompt = null;
      setInstallable(false);
      toast.success("Promethius is installing to your desktop");
    }
  };

  if (installed) {
    return (
      <div data-testid="install-app-status" className="flex items-center justify-center gap-2 py-2.5 text-sm text-emerald-400">
        <Check size={15} /> Installed as a desktop app
      </div>
    );
  }

  return (
    <button
      data-testid="install-app-button"
      onClick={install}
      className="w-full py-2.5 rounded-lg bg-[#16161c] border border-orange-500/30 hover:border-orange-500/60 text-sm text-orange-300 hover:text-orange-200 flex items-center justify-center gap-2 transition-colors"
    >
      <MonitorDown size={16} /> Install Desktop App
    </button>
  );
}
