import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

async function loginRequest({ username, password }: { username: string; password: string }) {
  const res = await fetch("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error("Incorrect username or password");
  return res.json();
}

export default function Login() {
  const qc = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: loginRequest,
    onSuccess: () => {
      setError("");
      qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: () => setError("Incorrect username or password"),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (username && password) mutation.mutate({ username, password });
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-full bg-brand flex items-center justify-center text-black font-bold">
            AI
          </div>
          <div>
            <div className="text-white font-semibold text-lg">RH AI Trader</div>
            <div className="text-gray-500 text-sm">Autonomous trading</div>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-gray-900 border border-gray-800 rounded-2xl p-8 space-y-4"
        >
          <div>
            <h1 className="text-white font-semibold text-lg mb-1">Sign in</h1>
            <p className="text-gray-400 text-sm">Enter your account credentials</p>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-brand"
              placeholder="your username"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-brand"
              placeholder="••••••••"
            />
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={!username || !password || mutation.isPending}
            className="w-full py-2.5 rounded-lg bg-brand text-black font-semibold hover:bg-brand-dark disabled:opacity-40 transition-colors"
          >
            {mutation.isPending ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
