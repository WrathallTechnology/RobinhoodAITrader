import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchStrategies,
  enableStrategy,
  disableStrategy,
  updateStrategy,
  createStrategy,
  deleteStrategy,
  type Strategy,
} from "../api/client";
import { Plus, Pencil, Trash2, Play, Square, ChevronDown, ChevronUp } from "lucide-react";
import clsx from "clsx";

// ── Scan frequency helpers ────────────────────────────────────────────────────

const FREQUENCY_OPTIONS = [
  { label: "Every 5 minutes", cron: "*/5 * * * *" },
  { label: "Every 15 minutes", cron: "*/15 * * * *" },
  { label: "Every 30 minutes", cron: "*/30 * * * *" },
  { label: "Hourly", cron: "0 * * * *" },
  { label: "Every 4 hours", cron: "0 */4 * * *" },
  { label: "Daily at market open (9:30 AM ET)", cron: "30 14 * * 1-5" },
  { label: "Custom cron…", cron: "custom" },
];

function cronToLabel(cron: string): string {
  const match = FREQUENCY_OPTIONS.find((o) => o.cron === cron);
  return match ? match.label : `Custom: ${cron}`;
}

// ── Parse / serialize strategy YAML fields ────────────────────────────────────

interface StrategyFields {
  name: string;
  description: string;
  cron: string;
  customCron: string;
  watchlist: string;   // comma-separated
  maxPositionPct: string;
  maxDailyTrades: string;
  systemPrompt: string;
}

function parseYaml(yaml: string): StrategyFields {
  const get = (key: string, fallback = "") => {
    const m = yaml.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
    return m ? m[1].trim().replace(/^['"]|['"]$/g, "") : fallback;
  };
  const getMultiline = (key: string) => {
    const m = yaml.match(new RegExp(`^${key}:\\s*\\|\\n([\\s\\S]*?)(?=^\\w|$)`, "m"));
    if (m) return m[1].replace(/^  /gm, "").trim();
    const inline = get(key);
    return inline;
  };
  const getList = (key: string) => {
    const m = yaml.match(new RegExp(`^${key}:[\\s\\S]*?(?=^\\w|$)`, "m"));
    if (!m) return "";
    const items = [...m[0].matchAll(/^  - (.+)$/gm)].map((x) => x[1].trim());
    return items.join(", ");
  };

  const cron = get("schedule", "*/30 * * * *");
  const known = FREQUENCY_OPTIONS.find((o) => o.cron === cron);

  return {
    name: get("name"),
    description: get("description"),
    cron: known ? cron : "custom",
    customCron: known ? "" : cron,
    watchlist: getList("watchlist"),
    maxPositionPct: String(parseFloat(get("max_position_pct", "0.05")) * 100),
    maxDailyTrades: get("max_daily_trades", "10"),
    systemPrompt: getMultiline("system_prompt"),
  };
}

function buildYaml(f: StrategyFields): string {
  const cron = f.cron === "custom" ? f.customCron : f.cron;
  const watchlistItems = f.watchlist
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const watchlistYaml =
    watchlistItems.length > 0
      ? `watchlist:\n${watchlistItems.map((s) => `  - ${s}`).join("\n")}`
      : "watchlist: []";
  const maxPos = (parseFloat(f.maxPositionPct) / 100).toFixed(2);
  const promptLines = f.systemPrompt
    .split("\n")
    .map((l) => `  ${l}`)
    .join("\n");

  return `name: ${f.name}
description: ${f.description}
schedule: "${cron}"
${watchlistYaml}
max_position_pct: ${maxPos}
max_daily_trades: ${f.maxDailyTrades}

system_prompt: |
${promptLines}
`;
}

// ── Strategy editor modal ─────────────────────────────────────────────────────

function StrategyEditor({
  strategy,
  onSave,
  onClose,
}: {
  strategy?: Strategy;
  onSave: (yaml: string) => void;
  onClose: () => void;
}) {
  const defaults: StrategyFields = {
    name: "",
    description: "",
    cron: "*/30 * * * *",
    customCron: "",
    watchlist: "",
    maxPositionPct: "5",
    maxDailyTrades: "10",
    systemPrompt:
      "You are a trading AI. Each cycle:\n1. Check portfolio and buying power\n2. Analyze market conditions\n3. Place orders if criteria are met\n4. Summarize actions taken",
  };

  const [fields, setFields] = useState<StrategyFields>(
    strategy ? parseYaml(strategy.yaml_content) : defaults
  );

  const set = (key: keyof StrategyFields, value: string) =>
    setFields((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(buildYaml(fields));
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-5 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">
            {strategy ? "Edit Strategy" : "New Strategy"}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          {/* Name + Description */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Strategy Name</label>
              <input
                value={fields.name}
                onChange={(e) => set("name", e.target.value)}
                required
                disabled={strategy?.is_builtin}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Description</label>
              <input
                value={fields.description}
                onChange={(e) => set("description", e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
              />
            </div>
          </div>

          {/* Scan frequency */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Scan Frequency</label>
            <select
              value={fields.cron}
              onChange={(e) => set("cron", e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
            >
              {FREQUENCY_OPTIONS.map((opt) => (
                <option key={opt.cron} value={opt.cron}>
                  {opt.label}
                </option>
              ))}
            </select>
            {fields.cron === "custom" && (
              <input
                placeholder="e.g. */10 * * * *"
                value={fields.customCron}
                onChange={(e) => set("customCron", e.target.value)}
                className="mt-2 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-brand"
              />
            )}
            <p className="text-xs text-gray-600 mt-1">
              How often the AI wakes up to analyze markets and potentially trade
            </p>
          </div>

          {/* Risk parameters */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Max Position Size (%)</label>
              <input
                type="number"
                min="0.1"
                max="100"
                step="0.1"
                value={fields.maxPositionPct}
                onChange={(e) => set("maxPositionPct", e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
              />
              <p className="text-xs text-gray-600 mt-1">% of portfolio per position</p>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Max Daily Trades</label>
              <input
                type="number"
                min="1"
                max="100"
                value={fields.maxDailyTrades}
                onChange={(e) => set("maxDailyTrades", e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
              />
            </div>
          </div>

          {/* Watchlist */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Watchlist (optional)</label>
            <input
              placeholder="AAPL, MSFT, NVDA — leave blank to let AI choose"
              value={fields.watchlist}
              onChange={(e) => set("watchlist", e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
            />
          </div>

          {/* System prompt */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">AI Trading Instructions</label>
            <textarea
              value={fields.systemPrompt}
              onChange={(e) => set("systemPrompt", e.target.value)}
              rows={10}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-brand resize-y"
            />
            <p className="text-xs text-gray-600 mt-1">
              Tell the AI what trading strategy to follow. Be specific about entry/exit criteria.
            </p>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 text-sm">
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-brand text-black font-semibold text-sm hover:bg-brand-dark">
              Save Strategy
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Strategy card ─────────────────────────────────────────────────────────────

function StrategyCard({
  strategy,
  onEdit,
  onDelete,
}: {
  strategy: Strategy;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);

  const enableMutation = useMutation({
    mutationFn: enableStrategy,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["strategies"] }),
  });
  const disableMutation = useMutation({
    mutationFn: disableStrategy,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["strategies"] }),
  });

  return (
    <div className={clsx("bg-gray-900 border rounded-xl overflow-hidden transition-colors", strategy.enabled ? "border-brand/50" : "border-gray-800")}>
      <div className="px-5 py-4 flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-white font-semibold truncate">{strategy.name}</span>
            {strategy.is_builtin && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-700 text-gray-400 flex-shrink-0">Built-in</span>
            )}
            {strategy.enabled && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-brand/20 text-brand flex-shrink-0">Active</span>
            )}
          </div>
          <p className="text-sm text-gray-400 truncate">{strategy.description}</p>
          <p className="text-xs text-gray-600 mt-1">{cronToLabel(strategy.schedule)}</p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {strategy.enabled ? (
            <button
              onClick={() => disableMutation.mutate(strategy.id)}
              className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400 transition-colors"
            >
              <Square size={12} /> Disable
            </button>
          ) : (
            <button
              onClick={() => enableMutation.mutate(strategy.id)}
              className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-brand/20 hover:bg-brand/30 text-brand transition-colors"
            >
              <Play size={12} /> Enable
            </button>
          )}
          <button onClick={onEdit} className="p-1.5 text-gray-500 hover:text-white transition-colors">
            <Pencil size={14} />
          </button>
          {!strategy.is_builtin && (
            <button onClick={onDelete} className="p-1.5 text-gray-500 hover:text-red-400 transition-colors">
              <Trash2 size={14} />
            </button>
          )}
          <button onClick={() => setExpanded((p) => !p)} className="p-1.5 text-gray-500 hover:text-white">
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-5 pb-4 border-t border-gray-800 pt-3">
          <pre className="text-xs text-gray-400 font-mono whitespace-pre-wrap bg-gray-950 rounded-lg p-3 max-h-48 overflow-y-auto">
            {strategy.yaml_content}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Strategies() {
  const qc = useQueryClient();
  const { data: strategies = [], isLoading } = useQuery({ queryKey: ["strategies"], queryFn: fetchStrategies });
  const [editing, setEditing] = useState<Strategy | null | "new">(null);

  const saveMutation = useMutation({
    mutationFn: async (yaml: string) => {
      if (editing === "new") return createStrategy(yaml);
      if (editing) return updateStrategy(editing.id, yaml);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["strategies"] });
      setEditing(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteStrategy,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["strategies"] }),
  });

  const builtin = strategies.filter((s) => s.is_builtin);
  const custom = strategies.filter((s) => !s.is_builtin);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Strategies</h1>
        <button
          onClick={() => setEditing("new")}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand text-black font-semibold text-sm hover:bg-brand-dark"
        >
          <Plus size={16} /> New Strategy
        </button>
      </div>

      {isLoading && <div className="text-gray-500 text-sm">Loading…</div>}

      {builtin.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wider">Built-in Strategies</h2>
          {builtin.map((s) => (
            <StrategyCard
              key={s.id}
              strategy={s}
              onEdit={() => setEditing(s)}
              onDelete={() => {}}
            />
          ))}
        </div>
      )}

      {custom.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wider">Custom Strategies</h2>
          {custom.map((s) => (
            <StrategyCard
              key={s.id}
              strategy={s}
              onEdit={() => setEditing(s)}
              onDelete={() => {
                if (confirm(`Delete "${s.name}"?`)) deleteMutation.mutate(s.id);
              }}
            />
          ))}
        </div>
      )}

      {strategies.length === 0 && !isLoading && (
        <div className="text-center text-gray-500 py-16">No strategies found. Create one to get started.</div>
      )}

      {editing !== null && (
        <StrategyEditor
          strategy={editing === "new" ? undefined : editing}
          onSave={(yaml) => saveMutation.mutate(yaml)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
