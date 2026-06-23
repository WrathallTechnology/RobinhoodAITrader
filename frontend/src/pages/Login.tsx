import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchCanRegister, registerUser } from "../api/client";

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
  const [mode, setMode] = useState<"login" | "register">("login");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");

  const { data: regStatus } = useQuery({
    queryKey: ["canRegister"],
    queryFn: fetchCanRegister,
    staleTime: 30_000,
  });
  const registrationOpen = regStatus?.open ?? false;

  const loginMutation = useMutation({
    mutationFn: loginRequest,
    onSuccess: () => { setError(""); qc.invalidateQueries({ queryKey: ["me"] }); },
    onError: () => setError("Incorrect username or password"),
  });

  const registerMutation = useMutation({
    mutationFn: () => registerUser(username, password),
    onSuccess: () => { setError(""); qc.invalidateQueries({ queryKey: ["me"] }); },
    onError: (e: Error) => setError(e.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (mode === "login") {
      if (username && password) loginMutation.mutate({ username, password });
    } else {
      if (password !== confirm) { setError("Passwords don't match"); return; }
      if (password.length < 8) { setError("Password must be at least 8 characters"); return; }
      registerMutation.mutate();
    }
  };

  const switchMode = (next: "login" | "register") => {
    setMode(next);
    setError("");
    setPassword("");
    setConfirm("");
  };

  const isPending = loginMutation.isPending || registerMutation.isPending;

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
            <h1 className="text-white font-semibold text-lg mb-1">
              {mode === "login" ? "Sign in" : "Create account"}
            </h1>
            <p className="text-gray-400 text-sm">
              {mode === "login" ? "Enter your account credentials" : "Choose a username and password"}
            </p>
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
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-brand"
              placeholder="••••••••"
            />
          </div>

          {mode === "register" && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Confirm password</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-brand"
                placeholder="••••••••"
              />
            </div>
          )}

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={!username || !password || (mode === "register" && !confirm) || isPending}
            className="w-full py-2.5 rounded-lg bg-brand text-black font-semibold hover:bg-brand-dark disabled:opacity-40 transition-colors"
          >
            {isPending
              ? mode === "login" ? "Signing in…" : "Creating account…"
              : mode === "login" ? "Sign in" : "Create account"}
          </button>

          {registrationOpen && (
            <div className="text-center pt-1">
              {mode === "login" ? (
                <button
                  type="button"
                  onClick={() => switchMode("register")}
                  className="text-sm text-brand hover:text-brand-dark"
                >
                  Create an account
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => switchMode("login")}
                  className="text-sm text-gray-400 hover:text-gray-300"
                >
                  Back to sign in
                </button>
              )}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
