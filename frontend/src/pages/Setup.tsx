import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { setupFirstUser } from "../api/client";

export default function Setup() {
  const qc = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: () => setupFirstUser(username, password),
    onSuccess: () => {
      setError("");
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["setupRequired"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setError("");
    mutation.mutate();
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
            <div className="text-gray-500 text-sm">First-time setup</div>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-gray-900 border border-gray-800 rounded-2xl p-8 space-y-4"
        >
          <div>
            <h1 className="text-white font-semibold text-lg mb-1">Create admin account</h1>
            <p className="text-gray-400 text-sm">
              This is the first login. Create your account — you can add more users later in Settings.
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
              placeholder="your name"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-brand"
              placeholder="at least 8 characters"
            />
          </div>

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

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={!username || !password || !confirm || mutation.isPending}
            className="w-full py-2.5 rounded-lg bg-brand text-black font-semibold hover:bg-brand-dark disabled:opacity-40 transition-colors"
          >
            {mutation.isPending ? "Creating account…" : "Create account & sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
