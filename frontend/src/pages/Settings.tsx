import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchMe,
  fetchRobinhoodStatus,
  fetchLLMProviders,
  fetchLLMConfigs,
  createLLMConfig,
  activateLLM,
  deleteLLMConfig,
  testLLM,
  fetchUsers,
  createUser,
  deleteUser,
  adminSetPassword,
  changeOwnPassword,
  fetchRegistrationOpen,
  setRegistrationOpen,
  type LLMConfigItem,
  type LLMProvider,
  type AppUser,
} from "../api/client";
import { CheckCircle, XCircle, Trash2, ExternalLink, ShieldAlert, Info, UserPlus, Key } from "lucide-react";
import clsx from "clsx";
import { formatET, formatETDate } from "../utils/formatDate";

// ── Provider API key guides ───────────────────────────────────────────────────

const PROVIDER_GUIDES: Record<string, { label: string; url: string; note: string; free: boolean }> = {
  anthropic: {
    label: "Get key from Anthropic Console",
    url: "https://console.anthropic.com/settings/keys",
    note: "Recommended — Claude is Robinhood's primary MCP integration. Requires a paid account (~$5 minimum load).",
    free: false,
  },
  openai: {
    label: "Get key from OpenAI Platform",
    url: "https://platform.openai.com/api-keys",
    note: "Widely supported. Requires a paid account. GPT-4o works well for trading tasks.",
    free: false,
  },
  google: {
    label: "Get key from Google AI Studio",
    url: "https://aistudio.google.com/app/apikey",
    note: "Gemini has a free tier (rate-limited). Good starting point if you want to try for free.",
    free: true,
  },
  groq: {
    label: "Get key from Groq Console",
    url: "https://console.groq.com/keys",
    note: "Free tier available with generous limits. Very fast inference. Great for frequent scans.",
    free: true,
  },
  mistral: {
    label: "Get key from Mistral Console",
    url: "https://console.mistral.ai/api-keys/",
    note: "Free trial credits available on sign-up. Mistral Large is capable for trading tasks.",
    free: true,
  },
  cohere: {
    label: "Get key from Cohere Dashboard",
    url: "https://dashboard.cohere.com/api-keys",
    note: "Free trial key available. Rate-limited but good for testing.",
    free: true,
  },
};

// ── LLM Configuration section ────────────────────────────────────────────────

function LLMSection() {
  const qc = useQueryClient();
  const { data: providers = [] } = useQuery({ queryKey: ["llmProviders"], queryFn: fetchLLMProviders });
  const { data: configs = [] } = useQuery({ queryKey: ["llmConfigs"], queryFn: fetchLLMConfigs });

  const [provider, setProvider] = useState("anthropic");
  const [model, setModel] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; reply?: string; error?: string } | null>(null);

  const providerInfo = providers.find((p: LLMProvider) => p.provider === provider);
  const defaultModel = providerInfo?.default_model ?? "";
  const availableModels = providerInfo?.models ?? [];
  const effectiveModel = model === "__custom__" ? customModel : (model || defaultModel);

  const addMutation = useMutation({
    mutationFn: () => createLLMConfig(provider, effectiveModel, apiKey),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["llmConfigs"] });
      setApiKey("");
      setTestResult(null);
    },
  });

  const activateMutation = useMutation({
    mutationFn: activateLLM,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["llmConfigs"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteLLMConfig,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["llmConfigs"] }),
  });

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testLLM(provider, effectiveModel, apiKey);
      setTestResult({ success: true, reply: res.reply });
    } catch (err) {
      setTestResult({ success: false, error: String(err) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl">
      <div className="px-6 py-5 border-b border-gray-800">
        <h2 className="text-white font-semibold">AI Model</h2>
        <p className="text-gray-400 text-sm mt-1">Configure which LLM provider and model drives the trading agent.</p>
      </div>
      <div className="px-6 py-5 space-y-5">
        {/* Existing configs */}
        {configs.length > 0 && (
          <div className="space-y-2">
            {configs.map((c: LLMConfigItem) => (
              <div key={c.id} className={clsx("flex items-center justify-between px-4 py-3 rounded-lg border", c.is_active ? "border-brand/50 bg-brand/5" : "border-gray-800 bg-gray-800/30")}>
                <div>
                  <div className="text-sm text-white font-medium">{c.model_string}</div>
                  <div className="text-xs text-gray-500">{c.api_key_set ? "API key saved" : "No API key"}</div>
                </div>
                <div className="flex items-center gap-2">
                  {c.is_active ? (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-brand/20 text-brand">Active</span>
                  ) : (
                    <button onClick={() => activateMutation.mutate(c.id)} className="text-xs px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300">
                      Set Active
                    </button>
                  )}
                  <button onClick={() => deleteMutation.mutate(c.id)} className="text-gray-600 hover:text-red-400">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add new */}
        <div className="space-y-3 pt-2">
          <h3 className="text-sm font-medium text-gray-400">Add Provider</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Provider</label>
              <select
                value={provider}
                onChange={(e) => { setProvider(e.target.value); setModel(""); setCustomModel(""); setTestResult(null); }}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
              >
                {providers.map((p: LLMProvider) => (
                  <option key={p.provider} value={p.provider}>{p.provider}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Model</label>
              <select
                value={model || defaultModel}
                onChange={(e) => { setModel(e.target.value); setTestResult(null); }}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-brand"
              >
                {availableModels.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
                <option value="__custom__">Custom model name…</option>
              </select>
              {model === "__custom__" && (
                <input
                  placeholder="Enter model name"
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                  className="w-full mt-1.5 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-brand"
                />
              )}
            </div>
          </div>

          {/* Provider guide */}
          {PROVIDER_GUIDES[provider] && (() => {
            const guide = PROVIDER_GUIDES[provider];
            return (
              <div className="bg-gray-800/60 border border-gray-700 rounded-lg px-4 py-3 space-y-2">
                <div className="flex items-start gap-2">
                  <Info size={14} className="text-gray-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-gray-300">{guide.note}</p>
                </div>
                <div className="flex items-center justify-between">
                  <a
                    href={guide.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs text-brand hover:text-brand-dark font-medium"
                  >
                    <ExternalLink size={11} />
                    {guide.label}
                  </a>
                  {guide.free && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-brand/10 text-brand border border-brand/20">
                      Free tier available
                    </span>
                  )}
                </div>
              </div>
            );
          })()}

          <div>
            <label className="block text-xs text-gray-500 mb-1">API Key</label>
            <input
              type="password"
              placeholder="Paste your API key here"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
            />
          </div>

          {testResult && (
            <div className={clsx("flex items-center gap-2 text-sm rounded-lg px-3 py-2", testResult.success ? "bg-brand/10 text-brand" : "bg-red-500/10 text-red-400")}>
              {testResult.success ? <CheckCircle size={14} /> : <XCircle size={14} />}
              {testResult.success ? `OK — model replied: "${testResult.reply}"` : testResult.error}
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleTest}
              disabled={!apiKey || testing}
              className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm disabled:opacity-40"
            >
              {testing ? "Testing…" : "Test Connection"}
            </button>
            <button
              onClick={() => addMutation.mutate()}
              disabled={!apiKey || addMutation.isPending}
              className="px-4 py-2 rounded-lg bg-brand text-black font-semibold text-sm hover:bg-brand-dark disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Robinhood Auth section ────────────────────────────────────────────────────

function RobinhoodSection() {
  const qc = useQueryClient();
  const { data: auth } = useQuery({ queryKey: ["robinhoodStatus"], queryFn: fetchRobinhoodStatus, refetchInterval: 5_000 });
  const params = new URLSearchParams(window.location.search);
  const authError = params.get("auth_error");
  const authErrorDesc = params.get("desc");

  // "idle" | "waiting" | "pasting" | "submitting" | "done" | "error"
  const [step, setStep] = useState<"idle" | "waiting" | "pasting" | "submitting" | "done" | "error">("idle");
  const [pasteUrl, setPasteUrl] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const popupRef = useState<Window | null>(null);

  function openOAuth() {
    setStep("waiting");
    setPasteUrl("");
    setErrorMsg(null);

    const popup = window.open("/auth/robinhood/start", "robinhoodOAuth", "width=520,height=680,left=200,top=100");
    popupRef[1](popup);

    // Poll the popup: when it goes cross-origin (Robinhood login page or
    // localhost error), we know the user is mid-flow. We can't read the URL
    // from a cross-origin popup, so we just advance the UI to the paste step.
    const poll = setInterval(() => {
      if (!popup || popup.closed) {
        clearInterval(poll);
        if (step !== "done") setStep("pasting");
        return;
      }
      try {
        // Readable only if popup is on our origin
        const url = popup.location.href;
        if (url.includes("auth=success")) {
          clearInterval(poll);
          popup.close();
          setStep("done");
          qc.invalidateQueries({ queryKey: ["robinhoodStatus"] });
        } else if (url.includes("auth_error")) {
          clearInterval(poll);
          popup.close();
          setStep("error");
          setErrorMsg("Robinhood returned an error. Check the popup for details.");
        }
      } catch {
        // Cross-origin — user is on Robinhood or the localhost error page
        setStep("pasting");
      }
    }, 600);
  }

  async function handlePaste() {
    setStep("submitting");
    setErrorMsg(null);
    try {
      const res = await fetch("/auth/robinhood/paste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ callback_url: pasteUrl.trim() }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.detail || `Error ${res.status}`);
      }
      setStep("done");
      qc.invalidateQueries({ queryKey: ["robinhoodStatus"] });
      const p = popupRef[0];
      if (p && !p.closed) p.close();
    } catch (e: any) {
      setErrorMsg(e.message);
      setStep("pasting");
    }
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl">
      <div className="px-6 py-5 border-b border-gray-800">
        <h2 className="text-white font-semibold">Robinhood Connection</h2>
        <p className="text-gray-400 text-sm mt-1">Connect your Robinhood account via Robinhood's official login.</p>
      </div>
      <div className="px-6 py-5 space-y-4">
        {authError && (
          <div className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-3 text-sm text-red-300">
            <strong>OAuth error:</strong> {authError}{authErrorDesc && ` — ${authErrorDesc}`}
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={clsx("w-3 h-3 rounded-full", auth?.authenticated ? "bg-brand" : "bg-gray-600")} />
            <div>
              <div className="text-sm text-white font-medium">{auth?.authenticated ? "Connected" : "Not connected"}</div>
              {auth?.authenticated && auth.expires_at && (
                <div className="text-xs text-gray-500">Expires: {formatET(auth.expires_at)}</div>
              )}
            </div>
          </div>
          <button
            onClick={openOAuth}
            disabled={step === "submitting"}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand text-black font-semibold text-sm hover:bg-brand-dark disabled:opacity-50"
          >
            <ExternalLink size={14} />
            {auth?.authenticated ? "Re-authenticate" : "Connect Robinhood"}
          </button>
        </div>

        {step === "waiting" && (
          <div className="bg-gray-800 rounded-lg px-4 py-3 text-sm text-gray-300 animate-pulse">
            Waiting for Robinhood login in the popup…
          </div>
        )}

        {(step === "pasting" || step === "submitting") && (
          <div className="bg-gray-800 rounded-lg p-4 space-y-3 text-sm">
            <p className="text-white font-medium">Almost there — one manual step required</p>
            <p className="text-gray-400">
              After logging in, your popup will show <span className="text-white font-mono text-xs">"This site can't be reached"</span>.
              That's normal — Robinhood redirected to your local machine instead of our server.
            </p>
            <p className="text-gray-400">
              Copy the full URL from the <span className="text-white">popup's address bar</span> and paste it below:
            </p>
            {errorMsg && (
              <div className="bg-red-900/30 border border-red-700 rounded px-3 py-2 text-red-300">{errorMsg}</div>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                value={pasteUrl}
                onChange={e => setPasteUrl(e.target.value)}
                onKeyDown={e => e.key === "Enter" && pasteUrl.trim() && handlePaste()}
                placeholder="http://localhost/auth/robinhood/callback?code=…"
                autoFocus
                className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-xs focus:outline-none focus:border-brand"
              />
              <button
                onClick={handlePaste}
                disabled={!pasteUrl.trim() || step === "submitting"}
                className="px-4 py-2 rounded bg-brand text-black font-semibold text-xs hover:bg-brand-dark disabled:opacity-50"
              >
                {step === "submitting" ? "…" : "Complete"}
              </button>
            </div>
          </div>
        )}

        {step === "done" && (
          <div className="bg-green-900/30 border border-green-700 rounded-lg px-4 py-3 text-sm text-green-300">
            Robinhood connected successfully!
          </div>
        )}
      </div>
    </div>
  );
}


// ── Trading safety section ────────────────────────────────────────────────────

function SafetySection() {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl">
      <div className="px-6 py-5 border-b border-gray-800">
        <h2 className="text-white font-semibold">Trading Mode</h2>
        <p className="text-gray-400 text-sm mt-1">Control whether the agent places real orders or just simulates them.</p>
      </div>
      <div className="px-6 py-5 space-y-4">
        <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-xl p-4 flex gap-3">
          <ShieldAlert size={18} className="text-yellow-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-yellow-200">
            <strong>Dry-run mode is the default.</strong> The agent will analyze markets and describe trades it would make, but will NOT place real orders. Enable live trading only after thorough testing. This setting is controlled by the <code className="bg-gray-800 px-1 rounded text-xs">TRADING_ENABLED</code> environment variable in your <code className="bg-gray-800 px-1 rounded text-xs">.env</code> file. Restart the backend after changing it.
          </div>
        </div>

        <div className="bg-gray-800/50 rounded-xl p-4 space-y-2">
          <div className="text-sm font-medium text-white">To enable live trading:</div>
          <ol className="text-sm text-gray-400 list-decimal list-inside space-y-1">
            <li>Test thoroughly in dry-run mode first</li>
            <li>Set <code className="bg-gray-900 px-1 rounded text-xs">TRADING_ENABLED=true</code> in your <code className="bg-gray-900 px-1 rounded text-xs">.env</code> file</li>
            <li>Restart the backend container: <code className="bg-gray-900 px-1 rounded text-xs">docker compose restart backend</code></li>
          </ol>
        </div>
      </div>
    </div>
  );
}

// ── Users section (admin only) ────────────────────────────────────────────────

function UsersSection() {
  const qc = useQueryClient();
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: fetchMe, staleTime: Infinity, retry: false });
  const { data: users = [] } = useQuery({ queryKey: ["users"], queryFn: fetchUsers, enabled: !!me?.is_admin });
  const { data: regStatus } = useQuery({ queryKey: ["registrationOpen"], queryFn: fetchRegistrationOpen, enabled: !!me?.is_admin });

  const regToggleMutation = useMutation({
    mutationFn: (open: boolean) => setRegistrationOpen(open),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["registrationOpen"] }),
  });

  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newIsAdmin, setNewIsAdmin] = useState(false);
  const [addError, setAddError] = useState("");

  const [resetTargetId, setResetTargetId] = useState<number | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetError, setResetError] = useState("");
  const [resetSuccess, setResetSuccess] = useState(false);

  const resetPwMutation = useMutation({
    mutationFn: () => adminSetPassword(resetTargetId!, resetPassword),
    onSuccess: () => {
      setResetTargetId(null); setResetPassword(""); setResetError("");
      setResetSuccess(true); setTimeout(() => setResetSuccess(false), 3000);
    },
    onError: (e: Error) => setResetError(e.message),
  });

  // Change own password
  const [ownCurrent, setOwnCurrent] = useState("");
  const [ownNew, setOwnNew] = useState("");
  const [ownConfirm, setOwnConfirm] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState(false);

  const createMutation = useMutation({
    mutationFn: () => createUser(newUsername, newPassword, newIsAdmin),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      setNewUsername(""); setNewPassword(""); setNewIsAdmin(false); setAddError("");
    },
    onError: (e: Error) => setAddError(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteUser,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  const changePwMutation = useMutation({
    mutationFn: () => changeOwnPassword(ownCurrent, ownNew),
    onSuccess: () => {
      setOwnCurrent(""); setOwnNew(""); setOwnConfirm(""); setPwError(""); setPwSuccess(true);
      setTimeout(() => setPwSuccess(false), 3000);
    },
    onError: (e: Error) => setPwError(e.message),
  });

  const handleChangePw = (e: React.FormEvent) => {
    e.preventDefault();
    if (ownNew !== ownConfirm) { setPwError("Passwords don't match"); return; }
    if (ownNew.length < 8) { setPwError("Must be at least 8 characters"); return; }
    setPwError("");
    changePwMutation.mutate();
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl space-y-0 divide-y divide-gray-800">
      <div className="px-6 py-5">
        <h2 className="text-white font-semibold">Users</h2>
        <p className="text-gray-400 text-sm mt-1">Manage who can access this instance.</p>
      </div>

      {/* User list (admin only) */}
      {me?.is_admin && (
        <div className="px-6 py-5 space-y-3">
          <h3 className="text-sm font-medium text-gray-400">Accounts</h3>
          <div className="space-y-2">
            {(users as AppUser[]).map((u) => (
              <div key={u.id} className="rounded-lg bg-gray-800/50 border border-gray-800 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5">
                  <div>
                    <span className="text-sm text-white font-medium">{u.username}</span>
                    {u.is_admin && <span className="ml-2 text-xs text-brand">(admin)</span>}
                    <div className="text-xs text-gray-500 mt-0.5">
                      Joined {formatETDate(u.created_at)}
                    </div>
                  </div>
                  {u.id !== me.user_id && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => { setResetTargetId(resetTargetId === u.id ? null : u.id); setResetPassword(""); setResetError(""); }}
                        className={clsx("p-1", resetTargetId === u.id ? "text-brand" : "text-gray-600 hover:text-brand")}
                        title="Reset password"
                      >
                        <Key size={14} />
                      </button>
                      <button
                        onClick={() => deleteMutation.mutate(u.id)}
                        className="text-gray-600 hover:text-red-400 p-1"
                        title="Remove user"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
                {resetTargetId === u.id && (
                  <div className="px-4 pb-3 flex gap-2 items-center border-t border-gray-700 pt-3">
                    <input
                      type="password"
                      placeholder="New password (8+ chars)"
                      value={resetPassword}
                      onChange={(e) => setResetPassword(e.target.value)}
                      className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-brand"
                    />
                    <button
                      onClick={() => resetPwMutation.mutate()}
                      disabled={resetPassword.length < 8 || resetPwMutation.isPending}
                      className="px-3 py-1.5 rounded-lg bg-brand text-black text-xs font-semibold disabled:opacity-40"
                    >
                      {resetPwMutation.isPending ? "Setting…" : "Set"}
                    </button>
                    <button
                      onClick={() => { setResetTargetId(null); setResetError(""); }}
                      className="px-3 py-1.5 rounded-lg bg-gray-700 text-gray-300 text-xs"
                    >
                      Cancel
                    </button>
                  </div>
                )}
                {resetError && resetTargetId === u.id && (
                  <p className="px-4 pb-2 text-red-400 text-xs">{resetError}</p>
                )}
              </div>
            ))}
          </div>

          {/* Add user */}
          <div className="space-y-2 pt-1">
            <h3 className="text-sm font-medium text-gray-400 flex items-center gap-1.5">
              <UserPlus size={14} /> Add user
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <input
                placeholder="Username"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
              />
              <input
                type="password"
                placeholder="Password (8+ chars)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={newIsAdmin}
                onChange={(e) => setNewIsAdmin(e.target.checked)}
                className="rounded"
              />
              Admin (can manage users)
            </label>
            {resetSuccess && <p className="text-brand text-xs flex items-center gap-1"><CheckCircle size={12} /> Password reset successfully</p>}
          {addError && <p className="text-red-400 text-xs">{addError}</p>}
            <button
              onClick={() => createMutation.mutate()}
              disabled={!newUsername || !newPassword || createMutation.isPending}
              className="px-4 py-2 rounded-lg bg-brand text-black font-semibold text-sm hover:bg-brand-dark disabled:opacity-40"
            >
              {createMutation.isPending ? "Adding…" : "Add user"}
            </button>
          </div>
        </div>
      )}

      {/* Registration toggle (admin only) */}
      {me?.is_admin && (
        <div className="px-6 py-4 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-gray-300">Allow self-registration</div>
            <div className="text-xs text-gray-500 mt-0.5">
              {regStatus?.open
                ? "Registration is open — anyone can create an account"
                : "Registration is closed — only admins can add users"}
            </div>
          </div>
          <button
            onClick={() => regToggleMutation.mutate(!regStatus?.open)}
            disabled={regToggleMutation.isPending}
            className={clsx(
              "relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40",
              regStatus?.open ? "bg-brand" : "bg-gray-700"
            )}
          >
            <span
              className={clsx(
                "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                regStatus?.open ? "translate-x-6" : "translate-x-1"
              )}
            />
          </button>
        </div>
      )}

      {/* Change own password */}
      <form onSubmit={handleChangePw} className="px-6 py-5 space-y-3">
        <h3 className="text-sm font-medium text-gray-400 flex items-center gap-1.5">
          <Key size={14} /> Change your password
        </h3>
        <input
          type="password"
          placeholder="Current password"
          value={ownCurrent}
          onChange={(e) => setOwnCurrent(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            type="password"
            placeholder="New password"
            value={ownNew}
            onChange={(e) => setOwnNew(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
          />
          <input
            type="password"
            placeholder="Confirm new password"
            value={ownConfirm}
            onChange={(e) => setOwnConfirm(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
          />
        </div>
        {pwError && <p className="text-red-400 text-xs">{pwError}</p>}
        {pwSuccess && <p className="text-brand text-xs flex items-center gap-1"><CheckCircle size={12} /> Password updated</p>}
        <button
          type="submit"
          disabled={!ownCurrent || !ownNew || !ownConfirm || changePwMutation.isPending}
          className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm disabled:opacity-40"
        >
          {changePwMutation.isPending ? "Updating…" : "Update password"}
        </button>
      </form>
    </div>
  );
}


// ── Page ──────────────────────────────────────────────────────────────────────

export default function Settings() {
  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-white">Settings</h1>
      <RobinhoodSection />
      <LLMSection />
      <UsersSection />
      <SafetySection />
    </div>
  );
}
