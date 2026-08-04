import { useState, useEffect, useCallback } from "react";
import {
  Github, X, Loader2, Plus, Trash2, GitBranch, ShieldCheck,
  CheckCircle2, ExternalLink, FileCode2, Sparkles, ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import api from "../lib/api";

// Extract ```lang\ncode``` blocks from an assistant message.
function extractCodeBlocks(text) {
  if (!text) return [];
  const blocks = [];
  const re = /```([\w.\-/]*)\n([\s\S]*?)```/g;
  let m;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    const hint = (m[1] || "").trim();
    const code = m[2];
    // If the first line is a path comment (// path:, # path:, /* path */), use it.
    const firstLine = code.split("\n")[0].trim();
    const pathMatch = firstLine.match(/(?:\/\/|#|<!--|\/\*)\s*(?:path:)?\s*([\w.\-/]+\.\w+)/i);
    let path = pathMatch ? pathMatch[1] : "";
    if (!path && hint.includes(".")) path = hint; // sometimes the lang hint is a filename
    blocks.push({ path: path || `snippet-${++i}.txt`, content: code });
  }
  return blocks;
}

// Line-based LCS diff (capped for large files).
function diffLines(oldStr, newStr) {
  const a = (oldStr || "").split("\n");
  const b = (newStr || "").split("\n");
  const n = a.length, m = b.length;
  if (n > 700 || m > 700) return null; // too big to diff nicely
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const res = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { res.push({ t: "ctx", v: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { res.push({ t: "del", v: a[i] }); i++; }
    else { res.push({ t: "add", v: b[j] }); j++; }
  }
  while (i < n) res.push({ t: "del", v: a[i++] });
  while (j < m) res.push({ t: "add", v: b[j++] });
  return res;
}

export default function GithubPush({ open, onClose, lastAssistantMessage, initialProposal }) {
  const [status, setStatus] = useState(null); // {connected, login}
  const [tokenInput, setTokenInput] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [repos, setRepos] = useState([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [repo, setRepo] = useState(null); // {full_name, owner, name, default_branch}
  const [repoOpen, setRepoOpen] = useState(false);
  const [branch, setBranch] = useState("");
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState([]); // [{path, content}]
  const [createBranch, setCreateBranch] = useState(false);
  const [openPr, setOpenPr] = useState(false);
  const [step, setStep] = useState("compose"); // compose | review | done
  const [pushing, setPushing] = useState(false);
  const [result, setResult] = useState(null);
  const [selfFiles, setSelfFiles] = useState([]);
  const [selfOpen, setSelfOpen] = useState(false);
  const [diffs, setDiffs] = useState(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [expanded, setExpanded] = useState({});

  const loadStatus = useCallback(async () => {
    try {
      const r = await api.get("/github/status");
      setStatus(r.data);
      if (r.data.connected) loadRepos();
    } catch {
      setStatus({ connected: false });
    }
  }, []);

  const loadRepos = async () => {
    setLoadingRepos(true);
    try {
      const r = await api.get("/github/repos");
      setRepos(r.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load repositories");
    } finally {
      setLoadingRepos(false);
    }
  };

  useEffect(() => {
    if (open) {
      setResult(null);
      loadStatus();
      if (initialProposal) {
        setRepo({
          full_name: initialProposal.full_name,
          owner: initialProposal.owner,
          name: initialProposal.repo,
          default_branch: initialProposal.default_branch || "main",
        });
        setBranch(initialProposal.branch || "main");
        setMessage(initialProposal.message || "Update from Promethius");
        setFiles(initialProposal.files || []);
        setCreateBranch(!!initialProposal.create_branch);
        setOpenPr(!!initialProposal.open_pr);
        setStep("review");
      } else {
        setStep("compose");
      }
    }
  }, [open, loadStatus, initialProposal]);

  useEffect(() => {
    if (step !== "review" || !repo || files.length === 0) return;
    let cancelled = false;
    (async () => {
      setDiffLoading(true);
      setDiffs(null);
      try {
        const r = await api.post("/github/diff", {
          owner: repo.owner,
          repo: repo.name,
          base_branch: createBranch ? repo.default_branch : branch.trim(),
          files: files.map((f) => ({ path: f.path.trim(), content: f.content })),
        });
        if (!cancelled) setDiffs(r.data);
      } catch {
        if (!cancelled) setDiffs([]);
      } finally {
        if (!cancelled) setDiffLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [step, repo, files, branch, createBranch]);

  const connect = async () => {
    if (!tokenInput.trim()) return;
    setConnecting(true);
    try {
      const r = await api.post("/github/token", { token: tokenInput.trim() });
      setStatus({ connected: true, login: r.data.login });
      setTokenInput("");
      toast.success(`Connected as ${r.data.login}`);
      loadRepos();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Token rejected");
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    await api.delete("/github/token");
    setStatus({ connected: false });
    setRepos([]);
    setRepo(null);
    toast.success("GitHub disconnected");
  };

  const chooseRepo = (r) => {
    setRepo(r);
    setBranch(r.default_branch);
    setRepoOpen(false);
  };

  const addFromChat = () => {
    const blocks = extractCodeBlocks(lastAssistantMessage);
    if (blocks.length === 0) {
      toast.error("No code blocks found in Promethius's last reply");
      return;
    }
    setFiles((f) => [...f, ...blocks]);
    toast.success(`Added ${blocks.length} file(s) from the chat`);
  };

  const loadSelfSource = async () => {
    if (selfFiles.length === 0) {
      try {
        const r = await api.get("/github/self-source");
        setSelfFiles(r.data.files);
      } catch {
        toast.error("Could not list source files");
        return;
      }
    }
    setSelfOpen((o) => !o);
  };

  const addSelfFile = async (path) => {
    try {
      const r = await api.get("/github/self-file", { params: { path } });
      setFiles((f) => [...f.filter((x) => x.path !== path), { path: r.data.path, content: r.data.content }]);
      toast.success(`Loaded ${path}`);
      setSelfOpen(false);
    } catch {
      toast.error("Could not load file");
    }
  };

  const addBlank = () => setFiles((f) => [...f, { path: "", content: "" }]);
  const updateFile = (i, key, val) => setFiles((f) => f.map((x, idx) => (idx === i ? { ...x, [key]: val } : x)));
  const removeFile = (i) => setFiles((f) => f.filter((_, idx) => idx !== i));

  const canReview =
    repo && branch.trim() && message.trim() && files.length > 0 && files.every((f) => f.path.trim());

  const goReview = () => {
    if (!canReview) {
      toast.error("Pick a repo, a branch, a commit message, and at least one file with a path");
      return;
    }
    setStep("review");
  };

  const doPush = async () => {
    setPushing(true);
    try {
      const r = await api.post("/github/commit", {
        owner: repo.owner,
        repo: repo.name,
        branch: branch.trim(),
        base_branch: createBranch ? repo.default_branch : branch.trim(),
        create_branch: createBranch,
        open_pr: openPr && createBranch,
        message: message.trim(),
        pr_title: message.trim(),
        files: files.map((f) => ({ path: f.path.trim(), content: f.content })),
      });
      setResult(r.data);
      setStep("done");
      toast.success("Pushed to GitHub");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Push failed");
    } finally {
      setPushing(false);
    }
  };

  const resetForNext = () => {
    setFiles([]);
    setMessage("");
    setResult(null);
    setStep("compose");
  };

  if (!open) return null;

  return (
    <div
      data-testid="github-push-overlay"
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-up"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[88vh] flex flex-col bg-[#0e0e10] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        data-testid="github-push-dialog"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center">
              <Github size={18} className="text-orange-500" />
            </div>
            <div>
              <h3 className="text-zinc-100 font-medium leading-tight">Push to GitHub</h3>
              <p className="text-[11px] text-zinc-500 font-mono uppercase tracking-wider">
                {status?.connected ? `@${status.login}` : "not connected"}
              </p>
            </div>
          </div>
          <button data-testid="github-push-close" onClick={onClose} className="text-zinc-500 hover:text-zinc-200 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Not connected -> token entry */}
          {status && !status.connected && (
            <div className="space-y-4">
              <p className="text-sm text-zinc-400 leading-relaxed">
                Connect a GitHub <b className="text-zinc-200">Personal Access Token</b> so Promethius can commit &amp; push.
                It's encrypted at rest and never shown again. Create one at{" "}
                <a href="https://github.com/settings/tokens/new" target="_blank" rel="noreferrer" className="text-orange-400 hover:underline">
                  github.com/settings/tokens
                </a>{" "}
                with the <b className="text-zinc-200">repo</b> scope.
              </p>
              <input
                data-testid="github-token-input"
                type="password"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="ghp_… or github_pat_…"
                className="w-full bg-[#161619] border border-white/10 rounded-xl px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-orange-500/40 font-mono"
              />
              <button
                data-testid="github-connect-button"
                onClick={connect}
                disabled={connecting || !tokenInput.trim()}
                className="w-full h-11 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-medium disabled:opacity-40 flex items-center justify-center gap-2 transition-colors"
              >
                {connecting ? <Loader2 size={16} className="animate-spin" /> : <Github size={16} />}
                Connect GitHub
              </button>
            </div>
          )}

          {/* Connected + compose step */}
          {status?.connected && step === "compose" && (
            <div className="space-y-5">
              {/* Repo picker */}
              <div>
                <label className="text-[11px] text-zinc-500 font-mono uppercase tracking-wider">Repository</label>
                <div className="relative mt-1.5">
                  <button
                    data-testid="github-repo-trigger"
                    onClick={() => setRepoOpen((o) => !o)}
                    className="w-full flex items-center justify-between bg-[#161619] border border-white/10 rounded-xl px-4 py-3 text-sm text-zinc-200 hover:border-white/20 transition-colors"
                  >
                    <span className={repo ? "" : "text-zinc-600"}>
                      {repo ? repo.full_name : loadingRepos ? "Loading repositories…" : "Select a repository"}
                    </span>
                    <ChevronDown size={16} className="text-zinc-500" />
                  </button>
                  {repoOpen && (
                    <div className="absolute z-50 mt-2 w-full max-h-56 overflow-y-auto bg-[#161619] border border-white/10 rounded-xl shadow-2xl py-1">
                      {repos.map((r) => (
                        <button
                          key={r.full_name}
                          data-testid={`github-repo-option-${r.name}`}
                          onClick={() => chooseRepo(r)}
                          className="w-full text-left px-4 py-2.5 text-sm text-zinc-300 hover:bg-white/5 flex items-center justify-between transition-colors"
                        >
                          <span className="truncate">{r.full_name}</span>
                          <span className="text-[10px] font-mono uppercase text-zinc-600 ml-2">
                            {r.private ? "private" : "public"}
                          </span>
                        </button>
                      ))}
                      {repos.length === 0 && !loadingRepos && (
                        <p className="px-4 py-3 text-sm text-zinc-500">No repositories found for this token.</p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Branch + options */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-zinc-500 font-mono uppercase tracking-wider">Branch</label>
                  <div className="mt-1.5 flex items-center gap-2 bg-[#161619] border border-white/10 rounded-xl px-3 py-2.5">
                    <GitBranch size={15} className="text-zinc-500 shrink-0" />
                    <input
                      data-testid="github-branch-input"
                      value={branch}
                      onChange={(e) => setBranch(e.target.value)}
                      placeholder="main"
                      className="flex-1 bg-transparent text-sm text-zinc-100 focus:outline-none font-mono"
                    />
                  </div>
                </div>
                <div className="flex flex-col justify-end gap-1.5 pb-0.5">
                  <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
                    <input
                      data-testid="github-create-branch"
                      type="checkbox"
                      checked={createBranch}
                      onChange={(e) => setCreateBranch(e.target.checked)}
                      className="accent-orange-500"
                    />
                    Create as new branch
                  </label>
                  <label className={`flex items-center gap-2 text-xs cursor-pointer ${createBranch ? "text-zinc-400" : "text-zinc-700"}`}>
                    <input
                      data-testid="github-open-pr"
                      type="checkbox"
                      disabled={!createBranch}
                      checked={openPr}
                      onChange={(e) => setOpenPr(e.target.checked)}
                      className="accent-orange-500"
                    />
                    Open a pull request
                  </label>
                </div>
              </div>

              {/* Commit message */}
              <div>
                <label className="text-[11px] text-zinc-500 font-mono uppercase tracking-wider">Commit message</label>
                <input
                  data-testid="github-commit-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Update from Promethius"
                  className="mt-1.5 w-full bg-[#161619] border border-white/10 rounded-xl px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-orange-500/40"
                />
              </div>

              {/* Files */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[11px] text-zinc-500 font-mono uppercase tracking-wider">
                    Files ({files.length})
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      data-testid="github-add-from-chat"
                      onClick={addFromChat}
                      className="text-xs flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-orange-500/10 text-orange-300 border border-orange-500/20 hover:bg-orange-500/20 transition-colors"
                    >
                      <Sparkles size={12} /> From last reply
                    </button>
                    <div className="relative">
                      <button
                        data-testid="github-add-self"
                        onClick={loadSelfSource}
                        className="text-xs flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/5 text-zinc-300 border border-white/10 hover:bg-white/10 transition-colors"
                      >
                        <FileCode2 size={12} /> My source
                      </button>
                      {selfOpen && (
                        <div className="absolute right-0 z-50 mt-2 w-72 max-h-56 overflow-y-auto bg-[#161619] border border-white/10 rounded-xl shadow-2xl py-1">
                          {selfFiles.map((p) => (
                            <button
                              key={p}
                              onClick={() => addSelfFile(p)}
                              className="w-full text-left px-3 py-2 text-xs font-mono text-zinc-300 hover:bg-white/5 truncate transition-colors"
                            >
                              {p}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      data-testid="github-add-blank"
                      onClick={addBlank}
                      className="text-xs flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/5 text-zinc-300 border border-white/10 hover:bg-white/10 transition-colors"
                    >
                      <Plus size={12} /> Blank
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  {files.length === 0 && (
                    <p className="text-sm text-zinc-600 py-4 text-center border border-dashed border-white/10 rounded-xl">
                      Add files from Promethius's last reply, its own source, or a blank file.
                    </p>
                  )}
                  {files.map((f, i) => (
                    <div key={i} className="border border-white/10 rounded-xl overflow-hidden bg-[#161619]">
                      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5">
                        <input
                          data-testid={`github-file-path-${i}`}
                          value={f.path}
                          onChange={(e) => updateFile(i, "path", e.target.value)}
                          placeholder="path/to/file.py"
                          className="flex-1 bg-transparent text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
                        />
                        <button onClick={() => removeFile(i)} className="text-zinc-600 hover:text-red-400 transition-colors">
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <textarea
                        data-testid={`github-file-content-${i}`}
                        value={f.content}
                        onChange={(e) => updateFile(i, "content", e.target.value)}
                        rows={4}
                        placeholder="file contents…"
                        className="w-full bg-transparent text-xs font-mono text-zinc-300 placeholder:text-zinc-700 focus:outline-none resize-y px-3 py-2 max-h-52"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <button onClick={disconnect} className="text-xs text-zinc-600 hover:text-red-400 transition-colors font-mono uppercase tracking-wider">
                  Disconnect
                </button>
                <button
                  data-testid="github-review-button"
                  onClick={goReview}
                  disabled={!canReview}
                  className="h-10 px-5 rounded-xl bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium disabled:opacity-40 flex items-center gap-2 transition-colors"
                >
                  <ShieldCheck size={16} /> Review &amp; Push
                </button>
              </div>
            </div>
          )}

          {/* Review step — approval gate */}
          {step === "review" && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 rounded-xl bg-orange-500/10 border border-orange-500/20">
                <ShieldCheck size={18} className="text-orange-400 shrink-0 mt-0.5" />
                <div className="text-sm text-zinc-300">
                  <p className="font-medium text-zinc-100 mb-1">Confirm before pushing</p>
                  <p className="text-zinc-400 leading-relaxed">
                    Promethius will commit the following to{" "}
                    <b className="text-zinc-200 font-mono">{repo.full_name}</b> on branch{" "}
                    <b className="text-orange-300 font-mono">{branch}</b>
                    {createBranch ? " (new branch)" : ""}. Review, then approve.
                  </p>
                </div>
              </div>

              <div className="text-xs font-mono text-zinc-400 bg-[#161619] border border-white/10 rounded-xl px-4 py-3">
                <span className="text-zinc-600">message:</span> {message}
              </div>

              <div className="space-y-2">
                {files.map((f, i) => {
                  const d = diffs && diffs.find((x) => x.path === f.path);
                  const rows = d && d.status !== "binary" ? diffLines(d.old, d.new) : null;
                  const adds = rows ? rows.filter((r) => r.t === "add").length : f.content.split("\n").length;
                  const dels = rows ? rows.filter((r) => r.t === "del").length : 0;
                  const isOpen = expanded[f.path];
                  return (
                    <div key={i} className="rounded-xl bg-[#161619] border border-white/10 overflow-hidden">
                      <button
                        data-testid={`github-diff-toggle-${i}`}
                        onClick={() => setExpanded((e) => ({ ...e, [f.path]: !e[f.path] }))}
                        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <ChevronDown size={14} className={`text-zinc-500 shrink-0 transition-transform ${isOpen ? "" : "-rotate-90"}`} />
                          <FileCode2 size={14} className="text-orange-400 shrink-0" />
                          <span className="text-sm font-mono text-zinc-200 truncate">{f.path}</span>
                          <span className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded ml-1 shrink-0 ${
                            d?.status === "added" ? "bg-green-500/15 text-green-400" : d?.status === "modified" ? "bg-amber-500/15 text-amber-400" : "bg-zinc-500/15 text-zinc-400"
                          }`}>
                            {d ? d.status : "new"}
                          </span>
                        </div>
                        <span className="text-[11px] font-mono shrink-0 ml-3">
                          <span className="text-green-500">+{adds}</span>{" "}
                          <span className="text-red-500">−{dels}</span>
                        </span>
                      </button>
                      {isOpen && (
                        <div className="border-t border-white/5 max-h-72 overflow-auto bg-[#0c0c0e]">
                          {diffLoading && !d ? (
                            <div className="flex items-center justify-center py-6 text-zinc-600">
                              <Loader2 size={16} className="animate-spin" />
                            </div>
                          ) : rows ? (
                            <pre className="text-[11px] font-mono leading-relaxed py-1">
                              {rows.map((r, idx) => (
                                <div
                                  key={idx}
                                  className={`px-3 whitespace-pre-wrap break-all ${
                                    r.t === "add" ? "bg-green-500/10 text-green-300" :
                                    r.t === "del" ? "bg-red-500/10 text-red-300" : "text-zinc-500"
                                  }`}
                                >
                                  <span className="select-none opacity-60 mr-2">{r.t === "add" ? "+" : r.t === "del" ? "−" : " "}</span>
                                  {r.v || " "}
                                </div>
                              ))}
                            </pre>
                          ) : (
                            <pre className="text-[11px] font-mono text-green-300 leading-relaxed py-1 px-3 whitespace-pre-wrap break-all">
                              {(d?.new ?? f.content).split("\n").map((ln, idx) => (
                                <div key={idx}><span className="select-none opacity-60 mr-2">+</span>{ln || " "}</div>
                              ))}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  data-testid="github-back-button"
                  onClick={() => setStep("compose")}
                  className="h-10 px-4 rounded-xl bg-white/5 border border-white/10 text-zinc-300 text-sm hover:bg-white/10 transition-colors"
                >
                  Back
                </button>
                <button
                  data-testid="github-approve-push"
                  onClick={doPush}
                  disabled={pushing}
                  className="h-10 px-5 rounded-xl bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium disabled:opacity-40 flex items-center gap-2 transition-colors"
                >
                  {pushing ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                  Approve &amp; Push
                </button>
              </div>
            </div>
          )}

          {/* Done step */}
          {step === "done" && result && (
            <div className="space-y-5 text-center py-6">
              <div className="w-16 h-16 rounded-2xl bg-green-500/10 border border-green-500/20 flex items-center justify-center mx-auto">
                <CheckCircle2 size={30} className="text-green-400" />
              </div>
              <div>
                <h3 className="text-lg text-zinc-100 font-medium">Pushed to GitHub</h3>
                <p className="text-sm text-zinc-500 mt-1">
                  Committed to <span className="font-mono text-zinc-300">{repo.full_name}</span> · {branch}
                </p>
              </div>
              <div className="flex flex-col gap-2 max-w-xs mx-auto">
                <a
                  data-testid="github-commit-link"
                  href={result.commit_url}
                  target="_blank"
                  rel="noreferrer"
                  className="h-10 rounded-xl bg-white/5 border border-white/10 text-zinc-200 text-sm hover:bg-white/10 flex items-center justify-center gap-2 transition-colors"
                >
                  <ExternalLink size={14} /> View commit
                </a>
                {result.pr_url && (
                  <a
                    href={result.pr_url}
                    target="_blank"
                    rel="noreferrer"
                    className="h-10 rounded-xl bg-orange-600/20 border border-orange-500/30 text-orange-300 text-sm hover:bg-orange-600/30 flex items-center justify-center gap-2 transition-colors"
                  >
                    <ExternalLink size={14} /> View pull request #{result.pr_number}
                  </a>
                )}
                <button
                  onClick={resetForNext}
                  className="h-10 rounded-xl text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
                >
                  Push more files
                </button>
              </div>
            </div>
          )}

          {!status && (
            <div className="flex items-center justify-center py-10 text-zinc-600">
              <Loader2 size={20} className="animate-spin" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
