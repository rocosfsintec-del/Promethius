import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Flame, ArrowLeft, Download, Copy, Check, Terminal, Database, KeyRound, Cpu, Rocket, Mic, Wrench } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";

const CodeBlock = ({ code, label }) => {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };
  return (
    <div className="relative group my-3" data-testid="guide-code-block">
      {label && <div className="text-[10px] uppercase tracking-[0.2em] text-orange-400/60 mb-1.5 font-mono">{label}</div>}
      <pre className="bg-[#0c0c12] border border-white/10 rounded-lg p-4 pr-12 overflow-x-auto text-[12.5px] leading-relaxed font-mono text-zinc-200 whitespace-pre">{code}</pre>
      <button
        data-testid="guide-copy-button"
        onClick={copy}
        title="Copy"
        className="absolute top-2 right-2 p-1.5 rounded-md bg-white/5 hover:bg-white/15 text-zinc-400 hover:text-white transition-colors opacity-0 group-hover:opacity-100"
      >
        {copied ? <Check size={15} className="text-emerald-400" /> : <Copy size={15} />}
      </button>
    </div>
  );
};

const Section = ({ icon: Icon, n, title, children }) => (
  <section className="mb-12 scroll-mt-24">
    <div className="flex items-center gap-3 mb-4">
      <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-orange-500/10 text-orange-400 border border-orange-500/20">
        <Icon size={18} strokeWidth={1.75} />
      </span>
      <h2 className="text-xl font-semibold text-white tracking-tight">
        {n != null && <span className="text-orange-400/70 mr-2 font-mono text-base">{n}</span>}
        {title}
      </h2>
    </div>
    <div className="pl-12 text-zinc-300 text-[15px] leading-relaxed space-y-3">{children}</div>
  </section>
);

const OsTabs = ({ win, mac, linux, defaultValue = "windows" }) => (
  <Tabs defaultValue={defaultValue} className="w-full">
    <TabsList className="bg-white/5 border border-white/10">
      <TabsTrigger data-testid="os-tab-windows" value="windows" className="data-[state=active]:bg-orange-500 data-[state=active]:text-black">Windows</TabsTrigger>
      <TabsTrigger data-testid="os-tab-macos" value="macos" className="data-[state=active]:bg-orange-500 data-[state=active]:text-black">macOS</TabsTrigger>
      <TabsTrigger data-testid="os-tab-linux" value="linux" className="data-[state=active]:bg-orange-500 data-[state=active]:text-black">Linux</TabsTrigger>
    </TabsList>
    <TabsContent value="windows">{win}</TabsContent>
    <TabsContent value="macos">{mac}</TabsContent>
    <TabsContent value="linux">{linux}</TabsContent>
  </Tabs>
);

export default function InstallGuide() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-[#070709] text-zinc-200" data-testid="install-guide-page">
      {/* header */}
      <div className="sticky top-0 z-30 backdrop-blur-xl bg-[#070709]/80 border-b border-white/10">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <button data-testid="guide-back-button" onClick={() => navigate("/")} className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors text-sm">
            <ArrowLeft size={16} /> Back to Orb
          </button>
          <a
            data-testid="guide-download-pdf"
            href="/instruction.pdf"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm px-3.5 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-300 transition-colors"
          >
            <Download size={15} /> Download PDF
          </a>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-12">
        {/* hero */}
        <div className="mb-14">
          <div className="flex items-center gap-2.5 mb-3 text-orange-400">
            <Flame size={22} />
            <span className="font-semibold text-lg tracking-tight text-white">Promethius</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-white mb-4">Run your own AI, locally.</h1>
          <p className="text-zinc-400 text-base max-w-xl">
            A complete guide to install &amp; run Promethius on your own machine — Windows, macOS or Linux.
            Your files, conversations and generated media stay on your disk.
          </p>
        </div>

        <Section icon={Cpu} title="What you are installing">
          <p>
            Promethius has three parts: a <b className="text-white">React</b> frontend, a{" "}
            <b className="text-white">FastAPI</b> (Python) backend, and a <b className="text-white">MongoDB</b> database.
            Uploads and generated media are stored on your own disk — nothing leaves your machine except calls you choose to make to AI providers.
          </p>
          <p>
            Power the intelligence two ways: <b className="text-orange-300">(A) 100% offline with Ollama</b> (free, runs on your
            hardware) or <b className="text-orange-300">(B) cloud API keys</b> (Anthropic, ElevenLabs, fal.ai, Tavily, OpenAI) for
            top-tier models, voice and video. You can mix both.
          </p>
        </Section>

        <Section icon={Terminal} n="1" title="Prerequisites">
          <p>Install these once. Choose your operating system below.</p>
          <OsTabs
            win={<CodeBlock label="Windows 10/11 (winget)" code={`winget install Git.Git\nwinget install Python.Python.3.11\nwinget install OpenJS.NodeJS.LTS\nwinget install MongoDB.Server\nnpm install -g yarn`} />}
            mac={<CodeBlock label="macOS (Homebrew — install from https://brew.sh)" code={`brew install git python@3.11 node\nbrew tap mongodb/brew && brew install mongodb-community\nnpm install -g yarn`} />}
            linux={<CodeBlock label="Debian / Ubuntu" code={`sudo apt update\nsudo apt install -y git python3.11 python3.11-venv python3-pip nodejs npm\n# MongoDB: follow https://www.mongodb.com/docs/manual/installation/\nsudo npm install -g yarn`} />}
          />
          <p className="text-sm text-zinc-400">Verify everything is on your PATH:</p>
          <CodeBlock code={`git --version\npython --version    # or python3 --version\nnode --version\nyarn --version\nmongod --version`} />
        </Section>

        <Section icon={Download} n="2" title="Get the code">
          <CodeBlock code={`git clone <YOUR_PROMETHIUS_REPO_URL> promethius\ncd promethius\n# You should see two folders: backend/ and frontend/`} />
        </Section>

        <Section icon={Rocket} title="Quick start (one command)">
          <div className="rounded-xl border border-orange-500/25 bg-orange-500/5 p-5">
            <p className="text-zinc-300">
              Already created your two <code className="text-orange-300">.env</code> files (steps 4 &amp; 7)
              and installed the prerequisites? Skip the manual steps below — the included launcher
              boots <b className="text-white">MongoDB + backend + frontend</b> together. Run it from the project root.
            </p>
            <OsTabs
              defaultValue="macos"
              win={<CodeBlock label="Windows" code={`start.bat`} />}
              mac={<CodeBlock label="macOS / Linux" code={`chmod +x start.sh   # first time only\n./start.sh`} />}
              linux={<CodeBlock label="macOS / Linux" code={`chmod +x start.sh   # first time only\n./start.sh`} />}
            />
            <p className="text-sm text-zinc-400">
              On first run it creates the Python venv and installs dependencies automatically, then opens
              <code className="text-orange-300"> http://localhost:3000</code>. Press <b className="text-white">Ctrl-C</b> (macOS/Linux)
              or close the two terminal windows (Windows) to stop. Prefer to do it by hand? Follow steps 3–7 below.
            </p>
          </div>
        </Section>

        <Section icon={Database} n="3" title="Start MongoDB">
          <p>Promethius stores conversations, memory and voiceprints in MongoDB.</p>
          <OsTabs
            win={<CodeBlock label="Windows (runs as a service automatically; manual run shown)" code={`"C:\\Program Files\\MongoDB\\Server\\7.0\\bin\\mongod.exe" --dbpath C:\\data\\db`} />}
            mac={<CodeBlock label="macOS" code={`brew services start mongodb-community`} />}
            linux={<CodeBlock label="Linux" code={`sudo systemctl start mongod`} />}
          />
          <p className="text-sm text-zinc-400">MongoDB will be available at <code className="text-orange-300">mongodb://localhost:27017</code>.</p>
        </Section>

        <Section icon={KeyRound} n="4" title="Configure the backend (backend/.env)">
          <p>Create a file named <code className="text-orange-300">.env</code> inside the <code className="text-orange-300">backend/</code> folder. Leave any provider key blank to disable that feature.</p>
          <CodeBlock label="backend/.env" code={`# --- Core (required) ---\nMONGO_URL=mongodb://localhost:27017\nDB_NAME=promethius\nCORS_ORIGINS=http://localhost:3000\nJWT_SECRET=change-me-to-a-long-random-string\nSTORAGE_DIR=./storage        # where uploads & generated media are saved\n\n# --- Passkey login (use localhost values for local) ---\nWEBAUTHN_RP_ID=localhost\nWEBAUTHN_RP_NAME=Promethius\nWEBAUTHN_EXPECTED_ORIGIN=http://localhost:3000\n\n# --- Option A: 100% offline with Ollama (free) ---\nOLLAMA_BASE_URL=http://localhost:11434\n\n# --- Option B: cloud keys (optional, for best quality) ---\nANTHROPIC_API_KEY=     # claude-sonnet-4-6 (recommended chat model)\nOPENAI_API_KEY=        # GPT, image gen, Whisper\nELEVENLABS_API_KEY=    # lifelike voice (TTS/STT)\nTAVILY_API_KEY=        # web search / deep research\nFAL_KEY=               # text/image-to-video generation\nRESEND_API_KEY=        # email recovery codes\nSENDER_EMAIL=you@yourdomain.com`} />
          <p className="text-sm text-zinc-300 font-medium mt-4 mb-1">Where to get the keys:</p>
          <ul className="text-sm text-zinc-400 space-y-1 list-disc pl-5">
            <li><b className="text-zinc-300">Anthropic</b> — console.anthropic.com</li>
            <li><b className="text-zinc-300">OpenAI</b> — platform.openai.com/api-keys</li>
            <li><b className="text-zinc-300">ElevenLabs</b> — elevenlabs.io (Profile → API Key)</li>
            <li><b className="text-zinc-300">Tavily</b> — tavily.com</li>
            <li><b className="text-zinc-300">fal.ai</b> — fal.ai/dashboard/keys</li>
            <li><b className="text-zinc-300">Resend</b> — resend.com/api-keys</li>
          </ul>
        </Section>

        <Section icon={Cpu} n="5" title="Option A — Run fully offline with Ollama">
          <p className="text-sm text-zinc-500 italic">Skip this section if you only use cloud keys.</p>
          <p>Download Ollama from <code className="text-orange-300">https://ollama.com/download</code> (Windows/macOS/Linux), then pull a model:</p>
          <CodeBlock code={`ollama pull llama3.1\n# optional alternatives:\nollama pull mistral\nollama pull qwen2.5\n# Ollama serves automatically at http://localhost:11434`} />
          <p>In the app's model selector, choose provider <b className="text-white">Ollama</b> and the model you pulled. No internet or API key required for chat.</p>
          <p className="text-sm text-zinc-400">Note: voice (ElevenLabs), video (fal.ai) and web search (Tavily) still need their cloud keys — they have no offline equivalent.</p>
        </Section>

        <Section icon={Rocket} n="6" title="Install & start the backend">
          <OsTabs
            defaultValue="macos"
            win={<CodeBlock label="Windows (PowerShell)" code={`cd backend\npython -m venv venv\n.\\venv\\Scripts\\Activate.ps1\npip install -r requirements.txt\nuvicorn server:app --host 0.0.0.0 --port 8001 --reload`} />}
            mac={<CodeBlock label="macOS / Linux" code={`cd backend\npython3 -m venv venv\nsource venv/bin/activate\npip install -r requirements.txt\nuvicorn server:app --host 0.0.0.0 --port 8001 --reload`} />}
            linux={<CodeBlock label="macOS / Linux" code={`cd backend\npython3 -m venv venv\nsource venv/bin/activate\npip install -r requirements.txt\nuvicorn server:app --host 0.0.0.0 --port 8001 --reload`} />}
          />
          <p className="text-sm text-zinc-400">Backend is now live at <code className="text-orange-300">http://localhost:8001</code> (health: /api/).</p>
        </Section>

        <Section icon={Rocket} n="7" title="Configure & start the frontend">
          <p>Create a file named <code className="text-orange-300">.env</code> inside the <code className="text-orange-300">frontend/</code> folder:</p>
          <CodeBlock label="frontend/.env" code={`REACT_APP_BACKEND_URL=http://localhost:8001`} />
          <p>Then, in a <b className="text-white">second terminal</b>:</p>
          <CodeBlock code={`cd frontend\nyarn install\nyarn start`} />
          <p>Your browser opens at <code className="text-orange-300">http://localhost:3000</code>. The orb appears — tap it to awaken Promethius.</p>
        </Section>

        <Section icon={Mic} n="8" title="First run">
          <ol className="list-decimal pl-5 space-y-2">
            <li>On the Auth screen, create your passkey (fingerprint / Face ID / Windows Hello). The first account becomes the admin.</li>
            <li>Open Settings to choose your AI model (Ollama for offline, or Anthropic/OpenAI).</li>
            <li>Say <span className="text-orange-300">"Promethius, this is &lt;your name&gt;"</span> to enroll your voiceprint.</li>
            <li>Start talking, or say <span className="text-orange-300">"open the prompt"</span> for the chat workspace.</li>
          </ol>
        </Section>

        <Section icon={Wrench} title="Troubleshooting">
          <div className="space-y-4">
            <div>
              <p className="font-semibold text-white">Passkey won't register</p>
              <p className="text-sm text-zinc-400">Passkeys need localhost or HTTPS. Set WEBAUTHN_RP_ID=localhost and WEBAUTHN_EXPECTED_ORIGIN=http://localhost:3000, and open the app at http://localhost:3000 (not 127.0.0.1).</p>
            </div>
            <div>
              <p className="font-semibold text-white">"Connection refused" in the UI</p>
              <p className="text-sm text-zinc-400">Backend isn't running or REACT_APP_BACKEND_URL is wrong. Confirm uvicorn is up on port 8001 and frontend/.env points to it.</p>
            </div>
            <div>
              <p className="font-semibold text-white">MongoDB errors on startup</p>
              <p className="text-sm text-zinc-400">Ensure mongod is running and MONGO_URL matches (default mongodb://localhost:27017).</p>
            </div>
            <div>
              <p className="font-semibold text-white">Microphone / wake-word not working</p>
              <p className="text-sm text-zinc-400">Use Google Chrome and allow microphone access. The Web Speech wake-word needs Chrome + a mic.</p>
            </div>
            <div>
              <p className="font-semibold text-white">OpenAI features error out</p>
              <p className="text-sm text-zinc-400">Add billing to your OpenAI account, or switch the model selector to Anthropic or Ollama. Image generation specifically requires a funded OpenAI key.</p>
            </div>
          </div>
        </Section>

        <div className="border-t border-white/10 pt-8 mt-8 flex items-center gap-2 text-orange-400">
          <Flame size={16} />
          <p className="text-sm text-zinc-400">That's it — Promethius now runs entirely on your machine. Bring knowledge like fire.</p>
        </div>
      </div>
    </div>
  );
}
