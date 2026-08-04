"""Generate instruction.pdf — a detailed guide to install & run Promethius locally."""
from pathlib import Path
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Preformatted, HRFlowable, PageBreak,
)

OUT = Path(__file__).resolve().parents[1] / "frontend" / "public" / "instruction.pdf"

EMBER = HexColor("#ff6a2b")
DARK = HexColor("#101018")
GREY = HexColor("#444")
CODEBG = HexColor("#0d0d14")

styles = getSampleStyleSheet()
H1 = ParagraphStyle("H1", parent=styles["Title"], textColor=EMBER, fontSize=26, leading=30, spaceAfter=6)
SUB = ParagraphStyle("SUB", parent=styles["Normal"], textColor=GREY, fontSize=12, leading=16, spaceAfter=18)
H2 = ParagraphStyle("H2", parent=styles["Heading1"], textColor=DARK, fontSize=16, leading=20, spaceBefore=16, spaceAfter=6)
H3 = ParagraphStyle("H3", parent=styles["Heading2"], textColor=EMBER, fontSize=12.5, leading=16, spaceBefore=10, spaceAfter=4)
BODY = ParagraphStyle("BODY", parent=styles["Normal"], fontSize=10.5, leading=15, spaceAfter=6)
NOTE = ParagraphStyle("NOTE", parent=styles["Normal"], fontSize=9.5, leading=13, textColor=GREY, spaceAfter=6)
CODE = ParagraphStyle("CODE", parent=styles["Code"], fontName="Courier", fontSize=8.6, leading=11.5,
                      textColor=HexColor("#e8e8ff"), backColor=CODEBG, borderPadding=8,
                      leftIndent=4, rightIndent=4, spaceBefore=4, spaceAfter=10)


def code(t):
    return Preformatted(t.strip("\n"), CODE)


def rule():
    return HRFlowable(width="100%", thickness=0.6, color=HexColor("#dddddd"), spaceBefore=8, spaceAfter=8)


story = []
story += [
    Paragraph("Promethius", H1),
    Paragraph("Install &amp; run your own AI on your laptop — Windows, macOS &amp; Linux", SUB),
    rule(),
    Paragraph("What you are installing", H2),
    Paragraph(
        "Promethius is a local-first AI assistant made of three parts: a <b>React</b> frontend, "
        "a <b>FastAPI</b> (Python) backend, and a <b>MongoDB</b> database. Files you upload and "
        "media Promethius generates are now stored on your own disk — nothing leaves your machine "
        "except calls you choose to make to AI providers.", BODY),
    Paragraph(
        "You have two ways to power the intelligence: <b>(A) 100% offline with Ollama</b> (free, "
        "runs on your hardware) or <b>(B) cloud API keys</b> (Anthropic, ElevenLabs, fal.ai, "
        "Tavily, OpenAI) for the most capable models, voice and video. You can mix both.", BODY),
]

story += [
    Paragraph("1 &nbsp;Prerequisites", H2),
    Paragraph("Install these once. Run the commands for your operating system.", BODY),
    Paragraph("Windows", H3),
    code(
        "# Install via winget (Windows 10/11)\n"
        "winget install Git.Git\n"
        "winget install Python.Python.3.11\n"
        "winget install OpenJS.NodeJS.LTS\n"
        "winget install MongoDB.Server\n"
        "npm install -g yarn"),
    Paragraph("macOS", H3),
    code(
        "# Install Homebrew first if needed: https://brew.sh\n"
        "brew install git python@3.11 node\n"
        "brew tap mongodb/brew && brew install mongodb-community\n"
        "npm install -g yarn"),
    Paragraph("Linux (Debian/Ubuntu)", H3),
    code(
        "sudo apt update\n"
        "sudo apt install -y git python3.11 python3.11-venv python3-pip nodejs npm\n"
        "# MongoDB: follow https://www.mongodb.com/docs/manual/installation/\n"
        "sudo npm install -g yarn"),
    Paragraph("Verify everything is on your PATH:", BODY),
    code("git --version\npython --version   # or python3 --version\nnode --version\nyarn --version\nmongod --version"),
]

story += [
    PageBreak(),
    Paragraph("2 &nbsp;Get the code", H2),
    code(
        "git clone <YOUR_PROMETHIUS_REPO_URL> promethius\n"
        "cd promethius\n"
        "# You should see two folders: backend/ and frontend/"),

    Paragraph("Quick start (one command)", H3),
    Paragraph("Once your two .env files (sections 4 &amp; 7) and prerequisites are in place, the "
              "included launcher boots MongoDB + backend + frontend together. Run it from the "
              "project root:", BODY),
    code("# macOS / Linux\nchmod +x start.sh   # first time only\n./start.sh\n\n# Windows\nstart.bat"),
    Paragraph("Prefer to do it manually? Follow sections 3-7 below.", NOTE),

    Paragraph("3 &nbsp;Start MongoDB", H2),
    Paragraph("Promethius stores conversations, memory and voiceprints in MongoDB.", BODY),
    Paragraph("Windows", H3),
    code("# Runs as a service automatically after install. To run manually:\n"
         "\"C:\\Program Files\\MongoDB\\Server\\7.0\\bin\\mongod.exe\" --dbpath C:\\data\\db"),
    Paragraph("macOS", H3),
    code("brew services start mongodb-community"),
    Paragraph("Linux", H3),
    code("sudo systemctl start mongod"),
    Paragraph("MongoDB will now be available at <b>mongodb://localhost:27017</b>.", NOTE),
]

story += [
    Paragraph("4 &nbsp;Configure the backend (backend/.env)", H2),
    Paragraph("Create a file named <b>.env</b> inside the <b>backend/</b> folder with the following. "
              "Leave a provider key blank to disable that feature.", BODY),
    code(
        "# --- Core (required) ---\n"
        "MONGO_URL=mongodb://localhost:27017\n"
        "DB_NAME=promethius\n"
        "CORS_ORIGINS=http://localhost:3000\n"
        "JWT_SECRET=change-me-to-a-long-random-string\n"
        "STORAGE_DIR=./storage          # where uploads & generated media are saved\n"
        "\n"
        "# --- Passkey login (use localhost values for local) ---\n"
        "WEBAUTHN_RP_ID=localhost\n"
        "WEBAUTHN_RP_NAME=Promethius\n"
        "WEBAUTHN_EXPECTED_ORIGIN=http://localhost:3000\n"
        "\n"
        "# --- Option A: 100% offline with Ollama (free) ---\n"
        "OLLAMA_BASE_URL=http://localhost:11434\n"
        "\n"
        "# --- Option B: cloud keys (optional, for best quality) ---\n"
        "ANTHROPIC_API_KEY=          # claude-sonnet-4-6 (recommended chat model)\n"
        "OPENAI_API_KEY=             # GPT, image gen, Whisper\n"
        "ELEVENLABS_API_KEY=         # lifelike voice (TTS/STT)\n"
        "TAVILY_API_KEY=             # web search / deep research\n"
        "FAL_KEY=                    # text/image-to-video generation\n"
        "RESEND_API_KEY=             # email recovery codes\n"
        "SENDER_EMAIL=you@yourdomain.com"),
    Paragraph("Where to get the keys:", H3),
    Paragraph(
        "• Anthropic — console.anthropic.com<br/>"
        "• OpenAI — platform.openai.com/api-keys<br/>"
        "• ElevenLabs — elevenlabs.io (Profile &rarr; API Key)<br/>"
        "• Tavily — tavily.com<br/>"
        "• fal.ai — fal.ai/dashboard/keys<br/>"
        "• Resend — resend.com/api-keys", BODY),
]

story += [
    PageBreak(),
    Paragraph("5 &nbsp;Option A — Run fully offline with Ollama", H2),
    Paragraph("Skip this section if you only use cloud keys.", NOTE),
    Paragraph("Download Ollama from <b>https://ollama.com/download</b> (Windows/macOS/Linux), then pull a model:", BODY),
    code("ollama pull llama3.1\n# optional alternatives:\nollama pull mistral\nollama pull qwen2.5\n\n# Ollama serves automatically at http://localhost:11434"),
    Paragraph("In the app's model selector, choose provider <b>Ollama</b> and the model you pulled. "
              "No internet or API key required for chat.", BODY),
    Paragraph("Note: voice (ElevenLabs), video (fal.ai) and web search (Tavily) still need their "
              "respective cloud keys — they have no offline equivalent.", NOTE),

    Paragraph("6 &nbsp;Install &amp; start the backend", H2),
    Paragraph("Windows (PowerShell)", H3),
    code(
        "cd backend\n"
        "python -m venv venv\n"
        ".\\venv\\Scripts\\Activate.ps1\n"
        "pip install -r requirements.txt\n"
        "uvicorn server:app --host 0.0.0.0 --port 8001 --reload"),
    Paragraph("macOS / Linux", H3),
    code(
        "cd backend\n"
        "python3 -m venv venv\n"
        "source venv/bin/activate\n"
        "pip install -r requirements.txt\n"
        "uvicorn server:app --host 0.0.0.0 --port 8001 --reload"),
    Paragraph("The backend is now live at <b>http://localhost:8001</b> "
              "(health check: http://localhost:8001/api/).", NOTE),
]

story += [
    Paragraph("7 &nbsp;Configure &amp; start the frontend", H2),
    Paragraph("Create a file named <b>.env</b> inside the <b>frontend/</b> folder:", BODY),
    code("REACT_APP_BACKEND_URL=http://localhost:8001"),
    Paragraph("Then, in a <b>second terminal</b>:", BODY),
    code("cd frontend\nyarn install\nyarn start"),
    Paragraph("Your browser opens at <b>http://localhost:3000</b>. The orb appears — tap it to awaken Promethius.", BODY),

    Paragraph("8 &nbsp;First run", H2),
    Paragraph(
        "1. On the Auth screen, create your passkey (fingerprint / Face ID / Windows Hello). "
        "The first account becomes the admin.<br/>"
        "2. Open Settings to choose your AI model (Ollama for offline, or Anthropic/OpenAI).<br/>"
        "3. Say &ldquo;Promethius, this is &lt;your name&gt;&rdquo; to enroll your voiceprint.<br/>"
        "4. Start talking, or say &ldquo;open the prompt&rdquo; for the chat workspace.", BODY),
]

story += [
    PageBreak(),
    Paragraph("Troubleshooting", H2),
    Paragraph("Passkey won't register", H3),
    Paragraph("Passkeys require <b>localhost</b> or HTTPS. Make sure WEBAUTHN_RP_ID=localhost and "
              "WEBAUTHN_EXPECTED_ORIGIN=http://localhost:3000 in backend/.env, and that you open the "
              "app at http://localhost:3000 (not 127.0.0.1).", BODY),
    Paragraph("&ldquo;Connection refused&rdquo; in the UI", H3),
    Paragraph("The backend isn't running or REACT_APP_BACKEND_URL is wrong. Confirm uvicorn is up on "
              "port 8001 and frontend/.env points to it.", BODY),
    Paragraph("MongoDB errors on startup", H3),
    Paragraph("Ensure mongod is running and MONGO_URL matches (default mongodb://localhost:27017).", BODY),
    Paragraph("Microphone / wake-word not working", H3),
    Paragraph("Use Google Chrome and allow microphone access. The Web Speech wake-word needs Chrome + a mic.", BODY),
    Paragraph("OpenAI features error out", H3),
    Paragraph("Either add billing to your OpenAI account or switch the model selector to Anthropic or Ollama. "
              "Image generation specifically requires a funded OpenAI key.", BODY),
    rule(),
    Paragraph("That's it — Promethius now runs entirely on your machine. Bring knowledge like fire. 🔥", BODY),
]

OUT.parent.mkdir(parents=True, exist_ok=True)
doc = SimpleDocTemplate(str(OUT), pagesize=LETTER,
                        leftMargin=0.9 * inch, rightMargin=0.9 * inch,
                        topMargin=0.8 * inch, bottomMargin=0.8 * inch,
                        title="Promethius — Local Install Guide", author="Promethius")
doc.build(story)
print(f"Wrote {OUT} ({OUT.stat().st_size} bytes)")
