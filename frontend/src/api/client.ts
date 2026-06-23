const BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    credentials: "include",   // always send session cookie
    ...options,
  });
  if (res.status === 401) {
    // Session expired — force a re-check of auth state
    window.dispatchEvent(new Event("auth:expired"));
    throw new Error("Session expired");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ── Session auth ──────────────────────────────────────────────────────────────

export interface MeResponse {
  authenticated: boolean;
  token: string;
  username: string;
  is_admin: boolean;
  user_id: number;
}

export const fetchMe = () =>
  fetch("/auth/me", { credentials: "include" }).then((r) =>
    r.ok ? (r.json() as Promise<MeResponse>) : Promise.reject(r.status)
  );

export const logout = () =>
  fetch("/auth/logout", { method: "POST", credentials: "include" });

export const fetchSetupRequired = () =>
  fetch("/auth/setup-required").then((r) => r.json() as Promise<{ required: boolean }>);

export const fetchCanRegister = () =>
  fetch("/auth/can-register").then((r) => r.json() as Promise<{ open: boolean }>);

export const fetchRegistrationOpen = () => request<{ open: boolean }>("/users/registration-open");
export const setRegistrationOpen = (open: boolean) =>
  request<{ open: boolean }>("/users/registration-open", {
    method: "POST",
    body: JSON.stringify({ open }),
  });

export const registerUser = (username: string, password: string) =>
  fetch("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ username, password }),
  }).then(async (r) => {
    if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
    return r.json();
  });

export const setupFirstUser = (username: string, password: string) =>
  fetch("/auth/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ username, password }),
  }).then(async (r) => {
    if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
    return r.json();
  });

// ── Robinhood OAuth status (separate from web UI session) ─────────────────────

export const fetchRobinhoodStatus = () =>
  fetch("/auth/status", { credentials: "include" }).then((r) =>
    r.json() as Promise<{ authenticated: boolean; expires_at: string | null }>
  );

// ── User management (admin) ───────────────────────────────────────────────────

export interface AppUser {
  id: number;
  username: string;
  is_admin: boolean;
  created_at: string;
}

export const fetchUsers = () => request<AppUser[]>("/users");

export const createUser = (username: string, password: string, is_admin: boolean) =>
  request<AppUser>("/users", {
    method: "POST",
    body: JSON.stringify({ username, password, is_admin }),
  });

export const deleteUser = (id: number) =>
  request<void>(`/users/${id}`, { method: "DELETE" });

export const changeOwnPassword = (current_password: string, new_password: string) =>
  request<{ ok: boolean }>("/users/me/password", {
    method: "POST",
    body: JSON.stringify({ current_password, new_password }),
  });

export const adminSetPassword = (user_id: number, new_password: string) =>
  request<{ ok: boolean }>(`/users/${user_id}/password`, {
    method: "POST",
    body: JSON.stringify({ new_password }),
  });

// ── Paper trading ─────────────────────────────────────────────────────────────

export interface PaperPosition {
  symbol: string;
  quantity: number;
  avg_cost: number;
  last_price: number;
  market_value: number;
  unrealized_pnl: number;
  unrealized_pnl_pct: number;
}

export interface PaperSummary {
  initial_balance: number;
  cash: number;
  positions_value: number;
  total_value: number;
  realized_pnl: number;
  unrealized_pnl: number;
  total_pnl: number;
  total_pnl_pct: number;
  trade_count: number;
  positions: PaperPosition[];
  reset_at: string;
}

export const fetchPaperSummary = () => request<PaperSummary>("/paper/summary");
export const updatePaperBalance = (initial_balance: number) =>
  request<{ initial_balance: number }>("/paper/settings", {
    method: "PUT",
    body: JSON.stringify({ initial_balance }),
  });
export const resetPaperPortfolio = () =>
  request<{ reset_at: string; message: string }>("/paper/reset", { method: "POST" });

// ── Portfolio ─────────────────────────────────────────────────────────────────

export interface Holding {
  symbol: string;
  quantity: number;
  avg_cost?: number;
  current_price?: number;
  market_value?: number;
  unrealized_pnl?: number;
}

export interface Portfolio {
  buying_power?: number;
  total_value?: number;
  holdings?: Holding[];
  raw?: string;
}

export const fetchPortfolio = () => request<Portfolio>("/portfolio");

// ── Trades ───────────────────────────────────────────────────────────────────

export interface Trade {
  id: number;
  timestamp: string;
  symbol: string;
  action: string;
  quantity: number | null;
  price: number | null;
  reasoning: string | null;
  strategy: string;
  model: string;
  dry_run: boolean;
  run_id: number | null;
}

export interface TradesResponse {
  total: number;
  page: number;
  page_size: number;
  items: Trade[];
}

export const fetchTrades = (page = 1, pageSize = 50) =>
  request<TradesResponse>(`/trades?page=${page}&page_size=${pageSize}`);

export interface AgentRun {
  id: number;
  started_at: string;
  finished_at: string | null;
  strategy: string;
  model: string;
  status: string;
  summary: string | null;
  dry_run: boolean;
}

export const fetchRuns = (page = 1) =>
  request<{ total: number; items: AgentRun[] }>(`/runs?page=${page}`);

// ── Strategies ────────────────────────────────────────────────────────────────

export interface Strategy {
  id: number;
  name: string;
  description: string;
  schedule: string;
  enabled: boolean;
  is_builtin: boolean;
  created_at: string;
  yaml_content: string;
}

export const fetchStrategies = () => request<Strategy[]>("/strategies");

export const createStrategy = (yaml_content: string) =>
  request<Strategy>("/strategies", {
    method: "POST",
    body: JSON.stringify({ yaml_content }),
  });

export const updateStrategy = (id: number, yaml_content: string) =>
  request<Strategy>(`/strategies/${id}`, {
    method: "PUT",
    body: JSON.stringify({ yaml_content }),
  });

export const deleteStrategy = (id: number) =>
  request<void>(`/strategies/${id}`, { method: "DELETE" });

export const enableStrategy = (id: number) =>
  request<{ message: string; schedule: string }>(`/strategies/${id}/enable`, { method: "POST" });

export const disableStrategy = (id: number) =>
  request<{ message: string }>(`/strategies/${id}/disable`, { method: "POST" });

// ── Agent ─────────────────────────────────────────────────────────────────────

export interface AgentStatus {
  scheduled: boolean;
  next_run: string | null;
}

export const fetchAgentStatus = () => request<AgentStatus>("/agent/status");
export const startAgent = () => request<{ message: string }>("/agent/start", { method: "POST" });
export const stopAgent = () => request<{ message: string }>("/agent/stop", { method: "POST" });
export const runNow = () => request<{ message: string }>("/agent/run-now", { method: "POST" });

// ── LLM ──────────────────────────────────────────────────────────────────────

export interface LLMProvider {
  provider: string;
  default_model: string;
  models: string[];
}

export interface LLMConfigItem {
  id: number;
  provider: string;
  model_name: string;
  model_string: string;
  is_active: boolean;
  created_at: string;
  api_key_set: boolean;
}

export const fetchLLMProviders = () => request<LLMProvider[]>("/llm/providers");
export const fetchLLMConfigs = () => request<LLMConfigItem[]>("/llm/config");

export const createLLMConfig = (provider: string, model_name: string, api_key: string) =>
  request<LLMConfigItem>("/llm/config", {
    method: "POST",
    body: JSON.stringify({ provider, model_name, api_key }),
  });

export const activateLLM = (id: number) =>
  request<{ message: string }>(`/llm/config/${id}/activate`, { method: "POST" });

export const deleteLLMConfig = (id: number) =>
  request<void>(`/llm/config/${id}`, { method: "DELETE" });

export const testLLM = (provider: string, model_name: string, api_key: string) =>
  request<{ success: boolean; model: string; reply: string }>("/llm/test", {
    method: "POST",
    body: JSON.stringify({ provider, model_name, api_key }),
  });
