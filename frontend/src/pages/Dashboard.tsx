import { useQuery } from "@tanstack/react-query";
import {
  fetchPortfolio,
  fetchTrades,
  fetchRuns,
  fetchAuthStatusDirect,
  type Trade,
  type AgentRun,
} from "../api/client";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { TrendingUp, DollarSign, Activity, AlertTriangle } from "lucide-react";
import clsx from "clsx";

function StatCard({
  label,
  value,
  icon: Icon,
  color = "brand",
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  color?: string;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-gray-400 text-sm">{label}</span>
        <Icon size={16} className={`text-${color}-400`} />
      </div>
      <div className="text-2xl font-bold text-white">{value}</div>
    </div>
  );
}

function fmt(n: number | undefined | null) {
  if (n == null) return "—";
  return n >= 0
    ? `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `-$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function Dashboard() {
  const { data: auth } = useQuery({ queryKey: ["authStatus"], queryFn: fetchAuthStatusDirect, refetchInterval: 60_000 });
  const { data: portfolio } = useQuery({ queryKey: ["portfolio"], queryFn: fetchPortfolio, enabled: !!auth?.authenticated, refetchInterval: 60_000 });
  const { data: trades } = useQuery({ queryKey: ["trades"], queryFn: () => fetchTrades(1, 100) });
  const { data: runs } = useQuery({ queryKey: ["runs"], queryFn: () => fetchRuns(1) });

  // Build a simple chart from recent runs
  const chartData = (runs?.items ?? [])
    .slice()
    .reverse()
    .slice(-20)
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

      {/* Stats row */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Portfolio Value" value={fmt(portfolio?.total_value)} icon={DollarSign} />
        <StatCard label="Buying Power" value={fmt(portfolio?.buying_power)} icon={TrendingUp} />
        <StatCard label="Total Trades" value={String(trades?.total ?? "—")} icon={Activity} color="blue" />
        <StatCard label="Agent Runs" value={String(runs?.total ?? "—")} icon={Activity} color="purple" />
      </div>

      {/* Holdings table */}
      {portfolio?.holdings && portfolio.holdings.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl">
          <div className="px-5 py-4 border-b border-gray-800 font-semibold text-white">Current Positions</div>
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

      {/* Recent agent runs chart */}
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
                  <span className={clsx("px-2 py-0.5 rounded text-xs font-medium", t.dry_run ? "bg-gray-700 text-gray-400" : t.action === "buy" ? "bg-brand/20 text-brand" : "bg-red-500/20 text-red-400")}>
                    {t.dry_run ? "DRY" : t.action.toUpperCase()}
                  </span>
                  <span className="font-mono text-white">{t.symbol}</span>
                  {t.quantity && <span className="text-gray-400">{t.quantity} shares</span>}
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
