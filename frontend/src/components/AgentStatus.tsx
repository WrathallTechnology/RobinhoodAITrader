import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchAgentStatus, fetchMe, runNow, stopAgent, startAgent } from "../api/client";
import { Play, Square, Zap } from "lucide-react";
import clsx from "clsx";

interface LiveEvent {
  type: string;
  [key: string]: unknown;
}

export default function AgentStatus() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["agentStatus"],
    queryFn: fetchAgentStatus,
    refetchInterval: 30_000,
  });

  // The session token is already in the React Query cache from the /auth/me check.
  // We use it as a WS query param because httpOnly cookies can't be read by JS.
  const { data: authData } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    staleTime: Infinity,
    retry: false,
  });

  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [running, setRunning] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!authData?.token) return;
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(
      `${proto}://${window.location.host}/ws/live?token=${authData.token}`
    );
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data) as LiveEvent;
        setEvents((prev) => [payload, ...prev].slice(0, 50));
        if (payload.type === "run_start") setRunning(true);
        if (payload.type === "run_end") {
          setRunning(false);
          qc.invalidateQueries({ queryKey: ["agentStatus"] });
          qc.invalidateQueries({ queryKey: ["runs"] });
          qc.invalidateQueries({ queryKey: ["trades"] });
        }
      } catch {}
    };

    ws.onopen = () => ws.send("ping");
    const ping = setInterval(() => ws.readyState === 1 && ws.send("ping"), 20_000);
    return () => {
      clearInterval(ping);
      ws.close();
    };
  }, [qc, authData?.token]);

  const handleRunNow = async () => {
    await runNow();
    setRunning(true);
  };

  const latestEvent = events[0];
  const statusLabel = running
    ? "Running…"
    : data?.scheduled
    ? `Next: ${data.next_run ? new Date(data.next_run).toLocaleTimeString() : "scheduled"}`
    : "Idle";

  return (
    <div className="space-y-2">
      {/* Status pill */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 text-xs">
        <span
          className={clsx(
            "w-2 h-2 rounded-full flex-shrink-0",
            running ? "bg-yellow-400 animate-pulse" : data?.scheduled ? "bg-brand" : "bg-gray-500"
          )}
        />
        <span className="text-gray-300 truncate">{statusLabel}</span>
      </div>

      {/* Controls */}
      <div className="flex gap-1">
        <button
          onClick={handleRunNow}
          disabled={running}
          title="Run now"
          className="flex-1 flex items-center justify-center gap-1 text-xs py-1.5 rounded bg-brand/20 hover:bg-brand/30 text-brand disabled:opacity-40 transition-colors"
        >
          <Zap size={12} /> Run
        </button>
        {data?.scheduled ? (
          <button
            onClick={() => stopAgent().then(() => qc.invalidateQueries({ queryKey: ["agentStatus"] }))}
            title="Stop scheduler"
            className="flex items-center justify-center px-2 py-1.5 rounded bg-red-500/20 hover:bg-red-500/30 text-red-400 transition-colors"
          >
            <Square size={12} />
          </button>
        ) : (
          <button
            onClick={() => startAgent().then(() => qc.invalidateQueries({ queryKey: ["agentStatus"] }))}
            title="Start scheduler"
            className="flex items-center justify-center px-2 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
          >
            <Play size={12} />
          </button>
        )}
      </div>

      {/* Latest event */}
      {latestEvent && (
        <div className="text-xs text-gray-500 px-1 truncate">
          {latestEvent.type === "tool_call" && `→ ${latestEvent.tool}`}
          {latestEvent.type === "run_end" && `✓ ${latestEvent.status}`}
          {latestEvent.type === "run_error" && `✗ ${latestEvent.error}`}
          {latestEvent.type === "run_start" && `▶ ${latestEvent.strategy}`}
        </div>
      )}
    </div>
  );
}
