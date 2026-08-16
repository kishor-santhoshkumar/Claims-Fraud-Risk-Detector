import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { login } from "@/lib/auth";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(false);
    setTimeout(() => {
      if (login(username, password)) {
        navigate({ to: "/" });
      } else {
        setError(true);
        setLoading(false);
      }
    }, 300);
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-[360px]">
        <div className="mb-8 text-center">
          <div className="mb-3 inline-flex h-10 w-10 items-center justify-center border border-border">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-foreground">
              <path d="M3 5h14M3 10h14M3 15h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="16" cy="15" r="3" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </div>
          <h1 className="text-[15px] font-medium tracking-tight text-foreground">
            Payment Integrity
          </h1>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Claims Fraud Risk Detector
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-[12px] text-muted-foreground">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => { setUsername(e.target.value); setError(false); }}
              autoComplete="username"
              autoFocus
              required
              className="w-full border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground/40"
              placeholder="Username"
            />
          </div>

          <div>
            <label className="mb-1 block text-[12px] text-muted-foreground">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(false); }}
              autoComplete="current-password"
              required
              className="w-full border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground/40"
              placeholder="Password"
            />
          </div>

          {error && (
            <p className="text-[12px] text-risk">
              Invalid username or password.
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full border border-foreground/20 bg-foreground px-4 py-2 text-[13px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-8 text-center text-[11px] text-muted-foreground">
          Model v1.0 · 31 features · 5,410 providers
        </p>
      </div>
    </div>
  );
}
