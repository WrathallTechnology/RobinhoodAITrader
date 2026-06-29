import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchPortfolio,
  fetchTrades,
  fetchRuns,
  fetchRobinhoodStatus,
  fetchPaperSummary,
  resetPaperPortfolio,
  updatePaperBalance,
  type Trade,
  type AgentRun,
  type PaperPosition,
  type PaperSummary,
} from "../api/client";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import {
  TrendingUp, TrendingDown, DollarSign, Activity, AlertTriangle,
  FlaskConical, RotateCcw, Settings2,
} from "lucide-react";
import clsx from "clsx";

// ── Formatters ────────────────────────────────────────────────────────────────

function fmt(n: number | undefined | null) {
  if (n == null) return "—";
  const abs = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `-$${abs}` : `$${abs}`;
}

function fmtPct(n: number) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, icon: Icon, sub, positive }: {
  label: string; value: string; icon: React.ElementType;
  sub?: string; positive?: boolean | null;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-gray-400 text-sm">{label}</span>
        <Icon size={16} className="text-gray-500" />
      </div>
      <div className={clsx("text-2xl font-bold",
        positive == null ? "text-white" : positive ? "text-brand" : "text-red-400"
      )}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

// ── Paper portfolio card ──────────────────────────────────────────────────────

function PaperPortfolioCard({ data }: { data: PaperSummary }) {
  const qc = useQueryClient();
  const [editingBalance, setEditingBalance] = useState(false);
  const [balanceInput, setBalanceInput] = useState(String(data.initial_balance));

  const resetMutation = useMutation({
    mutationFn: resetPaperPortfolio,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["paperSummary"] }),
  });

  const balanceMutation = useMutation({
    mutationFn: (v: number) => updatePaperBalance(v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["paperSummary"] });
      setEditingBalance(false);
    },
  });

  const profit = data.total_pnl >= 0;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FlaskConical size={16} className="text-brand" />
          <span className="text-white font-semibold">Paper Trading</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400">
            Dry-run simulation
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setEditingBalance(true)}
            title="Change starting balance"
            className="p-1.5 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-800"
          >
            <Settings2 size={14} />
          </button>
          <button
            onClick={() => { if (confirm("Reset paper portfolio? Trade history is preserved.")) resetMutation.mutate(); }}
            title="Reset to starting balance"
            className="p-1.5 rounded text-gray-500 hover:text-red-400 hover:bg-gray-800"
          >
            <RotateCcw size={14} />
          </button>
        </div>
      </div>

      {/* Balance input (when editing) */}
      {editingBalance && (
        <div className="px-5 py-3 border-b border-gray-800 flex items-center gap-2 bg-gray-800/40">
          <span className="text-xs text-gray-400">Starting balance:</span>
          <span className="text-gray-400 text-sm">$</span>
          <input
            type="number"
            value={balanceInput}
            onChange={(e) => setBalanceInput(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white w-28 focus:outline-none focus:border-brand"
          />
          <button
            onClick={() => balanceMutation.mutate(parseFloat(balanceInput))}
            disabled={balanceMutation.isPending}
            className="px-3 py-1 text-xs rounded bg-brand text-black font-medium"
          >Save</button>
          <button onClick={() => setEditingBalance(false)} className="px-3 py-1 text-xs rounded bg-gray-700 text-gray-300">Cancel</button>
        </div>
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-gray-800">
        {[
          { label: "Total Value", value: fmt(data.total_value) },
          { label: "Cash", value: fmt(data.cash) },
          { label: "Positions", value: fmt(data.positions_value) },
          {
            label: "Total P&L",
            value: `${fmt(data.total_pnl)} (${fmtPct(data.total_pnl_pct)})`,
            highlight: true,
          },
        ].map(({ label, value, highlight }) => (
          <div key={label} className="px-5 py-4">
            <div className="text-xs text-gray-500 mb-1">{label}</div>
            <div className={clsx("font-semibold text-sm",
              highlight ? (profit ? "text-brand" : "text-red-400") : "text-white"
            )}>
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* P&L breakdown */}
      {(data.realized_pnl !== 0 || data.unrealized_pnl !== 0) && (
        <div className="px-5 py-3 border-t border-gray-800 flex gap-6 text-xs text-gray-500">
          <span>
            Realized: <span className={data.realized_pnl >= 0 ? "text-brand" : "text-red-400"}>
              {fmt(data.realized_pnl)}
            </span>
          </span>
          <span>
            Unrealized: <span className={data.unrealized_pnl >= 0 ? "text-brand" : "text-red-400"}>
              {fmt(data.unrealized_pnl)}
            </span>
          </span>
          <span>{data.trade_count} paper trades since {new Date(data.reset_at).toLocaleDateString()}</span>
        </div>
      )}

      {/* Open positions */}
      {data.positions.length > 0 && (
        <div className="border-t border-gray-800">
          <div className="px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">
            Open Positions
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-xs border-b border-gray-800">
                  <th className="px-5 py-2 text-left">Symbol</th>
                  <th className="px-5 py-2 text-right">Qty</th>
                  <th className="px-5 py-2 text-right">Avg Cost</th>
                  <th className="px-5 py-2 text-right">Last Price</th>
                  <th className="px-5 py-2 text-right">Value</th>
                  <th className="px-5 py-2 text-right">Unrealized P&L</th>
                </tr>
              </thead>
              <tbody>
                {data.positions.map((p: PaperPosition) => (
                  <tr key={p.symbol} className="border-b border-gray-800/50 hover:bg-gray-800/20">
                    <td className="px-5 py-2.5 font-mono font-medium text-white">{p.symbol}</td>
                    <td className="px-5 py-2.5 text-right text-gray-300">{p.quantity.toFixed(4).replace(/\.?0+$/, "")}</td>
                    <td className="px-5 py-2.5 text-right text-gray-300">{fmt(p.avg_cost)}</td>
                    <td className="px-5 py-2.5 text-right text-gray-300">{fmt(p.last_price)}</td>
                    <td className="px-5 py-2.5 text-right text-gray-300">{fmt(p.market_value)}</td>
                    <td className={clsx("px-5 py-2.5 text-right font-medium", p.unrealized_pnl >= 0 ? "text-brand" : "text-red-400")}>
                      {fmt(p.unrealized_pnl)}{" "}
                      <span className="text-xs opacity-70">({fmtPct(p.unrealized_pnl_pct)})</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data.positions.length === 0 && data.trade_count === 0 && (
        <div className="px-5 py-6 text-center text-gray-500 text-sm border-t border-gray-800">
          No paper trades yet. Run the agent in dry-run mode to start tracking.
        </div>
      )}
    </div>
  );
}

// ── Main dashboard ────────────────────────────────────────────────────────────

function extractDetail(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  // API errors look like: "502: {"detail":"Failed to fetch..."}"
  const m = err.message.match(/"detail"\s*:\s*"([^"]+)"/);
  if (m) return m[1];
  return err.message;
}

export default function Dashboard() {
  const { data: auth } = useQuery({ queryKey: ["robinhoodStatus"], queryFn: fetchRobinhoodStatus, refetchInterval: 60_000 });
  const { data: portfolio, error: portfolioError } = useQuery({
    queryKey: ["portfolio"],
    queryFn: fetchPortfolio,
    enabled: !!auth?.authenticated,
    refetchInterval: 60_000,
    retry: 1,
  });
  const { data: trades } = useQuery({ queryKey: ["trades"], queryFn: () => fetchTrades(1, 100) });
  const { data: runs } = useQuery({ queryKey: ["runs"], queryFn: () => fetchRuns(1) });
  const { data: paper } = useQuery({ queryKey: ["paperSummary"], queryFn: fetchPaperSummary, refetchInterval: 30_000 });

  const chartData = (runs?.items ?? [])
    .slice().reverse().slice(-20)
    .map((r: AgentRun) => ({
      time: new Date(r.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      status: r.status === "done" ? 1 : 0,
    }));

  const recentTrades = trades?.items?.slice(0, 10) ?? [];

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-white">Dashboard</h1>

      {!auth?.authenticated && (
        <div className="bg-yellow-900/30 border border-yellow-700 rounded-xl p-4 flex items-center gap-3 text-yellow-300 text-sm">
          <AlertTriangle size={16} />
          Robinhood is not connected. Go to{" "}
          <a href="/settings" className="underline">Settings</a> to authenticate.
        </div>
      )}

      {portfolioError && auth?.authenticated && (
        <div className="bg-red-900/20 border border-red-800 rounded-xl p-4 flex items-start gap-3 text-red-300 text-sm">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            <span className="font-medium">Portfolio unavailable — </span>
            {extractDetail(portfolioError)}
          </div>
        </div>
      )}

      {/* Real portfolio stats */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Portfolio Value" value={fmt(portfolio?.total_value)} icon={DollarSign} />
        <StatCard label="Buying Power" value={fmt(portfolio?.buying_power)} icon={TrendingUp} />
        <StatCard label="Total Trades" value={String(trades?.total ?? "—")} icon={Activity} />
        <StatCard label="Agent Runs" value={String(runs?.total ?? "—")} icon={Activity} />
      </div>

      {/* Real holdings */}
      {portfolio?.holdings && portfolio.holdings.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl">
          <div className="px-5 py-4 border-b border-gray-800 font-semibold text-white">Live Positions</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-xs border-b border-gray-800">
                  <th className="px-5 py-3 text-left">Symbol</th>
                  <th className="px-5 py-3 text-right">Qty</th>
                  <th className="px-5 py-3 text-right">Price</th>
                  <th className="px-5 py-3 text-right">Market Value</th>
                  <th className="px-5 py-3 text-right">Unrealized P&L</th>
                </tr>
              </thead>
              <tbody>
                {portfolio.holdings.map((h, i) => (
                  <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="px-5 py-3 font-mono font-medium text-white">{h.symbol}</td>
                    <td className="px-5 py-3 text-right text-gray-300">{h.quantity}</td>
                    <td className="px-5 py-3 text-right text-gray-300">{fmt(h.current_price)}</td>
                    <td className="px-5 py-3 text-right text-gray-300">{fmt(h.market_value)}</td>
                    <td className={clsx("px-5 py-3 text-right font-medium", (h.unrealized_pnl ?? 0) >= 0 ? "text-brand" : "text-red-400")}>
                      {fmt(h.unrealized_pnl)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Paper portfolio */}
      {paper && <PaperPortfolioCard data={paper} />}

      {/* Last failed run error */}
      {(() => {
        const lastFailed = (runs?.items ?? []).find((r: AgentRun) => r.status === "error");
        if (!lastFailed) return null;
        return (
          <div className="bg-red-900/20 border border-red-800 rounded-xl p-4 flex items-start gap-3 text-red-300 text-sm">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>
              <span className="font-medium">Last agent run failed</span>
              <span className="text-gray-500 ml-2 text-xs">
                {new Date(lastFailed.started_at).toLocaleString()}
              </span>
              {lastFailed.summary && (
                <div className="mt-1 text-red-400/80">{lastFailed.summary}</div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Agent runs chart */}
      {chartData.length > 1 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="font-semibold text-white mb-4">Recent Agent Runs</div>
          <ResponsiveContainer width="100%" height={120}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="time" tick={{ fill: "#6b7280", fontSize: 11 }} />
              <YAxis hide />
              <Tooltip contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: 8 }} />
              <Line type="monotone" dataKey="status" stroke="#00c805" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Recent trades */}
      {recentTrades.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl">
          <div className="px-5 py-4 border-b border-gray-800 font-semibold text-white">Recent Activity</div>
          <div className="divide-y divide-gray-800">
            {recentTrades.map((t: Trade) => (
              <div key={t.id} className="px-5 py-3 flex items-center justify-between text-sm">
                <div className="flex items-center gap-3">
                  <span className={clsx("px-2 py-0.5 rounded text-xs font-medium",
                    t.dry_run
                      ? "bg-gray-700 text-gray-400"
                      : t.action === "buy" ? "bg-brand/20 text-brand" : "bg-red-500/20 text-red-400"
                  )}>
                    {t.dry_run ? "PAPER" : t.action.toUpperCase()}
                  </span>
                  <span className="font-mono text-white">{t.symbol}</span>
                  {t.quantity && <span className="text-gray-400">{t.quantity} shares</span>}
                  {t.price && <span className="text-gray-500">@ {fmt(t.price)}</span>}
                </div>
                <div className="text-gray-500 text-xs">{new Date(t.timestamp).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
