import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchTrades, fetchRuns, type Trade, type AgentRun } from "../api/client";
import { ChevronDown, ChevronUp } from "lucide-react";
import clsx from "clsx";
import { formatET } from "../utils/formatDate";

function TradeRow({ trade }: { trade: Trade }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <tr
        className="border-b border-gray-800/50 hover:bg-gray-800/20 cursor-pointer"
        onClick={() => trade.reasoning && setOpen((p) => !p)}
      >
        <td className="px-5 py-3 text-gray-500 text-xs">{formatET(trade.timestamp)}</td>
        <td className="px-5 py-3 font-mono text-white font-medium">{trade.symbol}</td>
        <td className="px-5 py-3">
          <span className={clsx("px-2 py-0.5 rounded text-xs font-medium", trade.dry_run ? "bg-gray-700 text-gray-400" : trade.action === "buy" || trade.action === "buy_stock" ? "bg-brand/20 text-brand" : trade.action === "sell" || trade.action === "sell_stock" ? "bg-red-500/20 text-red-400" : "bg-blue-500/20 text-blue-400")}>
            {trade.dry_run ? "DRY" : ""} {trade.action.toUpperCase()}
          </span>
        </td>
        <td className="px-5 py-3 text-right text-gray-300 text-sm">{trade.quantity ?? "—"}</td>
        <td className="px-5 py-3 text-right text-gray-300 text-sm">{trade.price ? `$${trade.price.toFixed(2)}` : "—"}</td>
        <td className="px-5 py-3 text-gray-500 text-xs truncate max-w-xs">{trade.strategy}</td>
        <td className="px-5 py-3 text-gray-600 text-xs">
          {trade.reasoning ? (open ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : null}
        </td>
      </tr>
      {open && trade.reasoning && (
        <tr className="bg-gray-950">
          <td colSpan={7} className="px-5 py-3">
            <pre className="text-xs text-gray-400 font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">{trade.reasoning}</pre>
          </td>
        </tr>
      )}
    </>
  );
}

function RunRow({ run }: { run: AgentRun }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr
        className="border-b border-gray-800/50 hover:bg-gray-800/20 cursor-pointer"
        onClick={() => run.summary && setOpen((p) => !p)}
      >
        <td className="px-5 py-3 text-gray-500 text-xs">{formatET(run.started_at)}</td>
        <td className="px-5 py-3 text-gray-300 text-sm truncate max-w-xs">{run.strategy}</td>
        <td className="px-5 py-3 text-gray-500 text-xs truncate max-w-xs">{run.model}</td>
        <td className="px-5 py-3">
          <span className={clsx("px-2 py-0.5 rounded text-xs", run.status === "done" ? "bg-brand/20 text-brand" : run.status === "error" ? "bg-red-500/20 text-red-400" : "bg-yellow-500/20 text-yellow-400")}>
            {run.status}
          </span>
        </td>
        <td className="px-5 py-3 text-gray-500 text-xs">{run.dry_run ? "Dry Run" : "Live"}</td>
        <td className="px-5 py-3 text-gray-600 text-xs">
          {run.summary ? (open ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : null}
        </td>
      </tr>
      {open && run.summary && (
        <tr className="bg-gray-950">
          <td colSpan={6} className="px-5 py-3">
            <p className="text-xs text-gray-400 whitespace-pre-wrap">{run.summary}</p>
          </td>
        </tr>
      )}
    </>
  );
}

type Tab = "trades" | "runs";

export default function History() {
  const [tab, setTab] = useState<Tab>("trades");
  const [page, setPage] = useState(1);

  const { data: tradesData } = useQuery({ queryKey: ["trades", page], queryFn: () => fetchTrades(page), enabled: tab === "trades" });
  const { data: runsData } = useQuery({ queryKey: ["runs", page], queryFn: () => fetchRuns(page), enabled: tab === "runs" });

  const totalPages = tab === "trades"
    ? Math.ceil((tradesData?.total ?? 0) / 50)
    : Math.ceil((runsData?.total ?? 0) / 20);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-white">History</h1>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1 w-fit">
        {(["trades", "runs"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setPage(1); }}
            className={clsx("px-4 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize", tab === t ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-300")}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {tab === "trades" ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-xs border-b border-gray-800">
                  <th className="px-5 py-3 text-left">Time</th>
                  <th className="px-5 py-3 text-left">Symbol</th>
                  <th className="px-5 py-3 text-left">Action</th>
                  <th className="px-5 py-3 text-right">Qty</th>
                  <th className="px-5 py-3 text-right">Price</th>
                  <th className="px-5 py-3 text-left">Strategy</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {(tradesData?.items ?? []).map((t) => <TradeRow key={t.id} trade={t} />)}
              </tbody>
            </table>
            {(tradesData?.items?.length ?? 0) === 0 && (
              <div className="text-center text-gray-600 py-12">No trades yet</div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-xs border-b border-gray-800">
                  <th className="px-5 py-3 text-left">Started</th>
                  <th className="px-5 py-3 text-left">Strategy</th>
                  <th className="px-5 py-3 text-left">Model</th>
                  <th className="px-5 py-3 text-left">Status</th>
                  <th className="px-5 py-3 text-left">Mode</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {(runsData?.items ?? []).map((r) => <RunRow key={r.id} run={r} />)}
              </tbody>
            </table>
            {(runsData?.items?.length ?? 0) === 0 && (
              <div className="text-center text-gray-600 py-12">No agent runs yet</div>
            )}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1.5 rounded bg-gray-800 text-gray-300 text-sm disabled:opacity-40">
            Previous
          </button>
          <span className="text-gray-500 text-sm">{page} / {totalPages}</span>
          <button disabled={page === totalPages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1.5 rounded bg-gray-800 text-gray-300 text-sm disabled:opacity-40">
            Next
          </button>
        </div>
      )}
    </div>
  );
}
