import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Shield } from "lucide-react";
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
  const [shaking, setShaking] = useState(false);

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
        setShaking(true);
        setTimeout(() => setShaking(false), 450);
      }
    }, 300);
  };

  return (
    <div style={{ position: "relative", minHeight: "100svh", overflow: "hidden" }}>
      {/* Ambient blobs */}
      <div className="ambient-bg" aria-hidden="true">
        <div className="ambient-blob ambient-blob--a" />
        <div className="ambient-blob ambient-blob--b" />
        <div className="ambient-blob ambient-blob--c" />
      </div>

      {/* Content */}
      <div style={{
        position: "relative", zIndex: 2,
        minHeight: "100svh",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        padding: "64px 20px 96px",
        gap: 0,
      }}>
        {/* Glass card */}
        <div style={{
          width: "min(440px, 100%)",
          padding: "48px",
          background: "linear-gradient(160deg, rgba(255,255,255,0.85) 0%, rgba(219,234,254,0.72) 55%, rgba(191,219,254,0.62) 100%)",
          backdropFilter: "blur(28px) saturate(180%)",
          WebkitBackdropFilter: "blur(28px) saturate(180%)",
          border: "1px solid rgba(255,255,255,0.85)",
          borderRadius: 20,
          boxShadow: "0 24px 60px rgba(59,130,246,0.18), 0 2px 8px rgba(15,23,42,0.05), inset 0 1px 0 rgba(255,255,255,0.9)",
          animation: shaking ? "cardShake 0.4s ease-in-out" : "cardEntrance 0.4s ease-out",
        }}>
          {/* Header */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", marginBottom: 32 }}>
            <div style={{
              width: 56, height: 56, borderRadius: "50%",
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "linear-gradient(135deg, #3b82f6, #6366f1)",
              boxShadow: "0 8px 24px rgba(59,130,246,0.4)",
              marginBottom: 18,
            }}>
              <Shield size={24} color="#fff" />
            </div>
            <h1 style={{ fontSize: 26, fontWeight: 600, color: "#161b2e", margin: 0, letterSpacing: "-0.01em" }}>
              Payment Integrity
            </h1>
            <p style={{ fontSize: 14, color: "#667088", letterSpacing: "0.04em", marginTop: 6, marginBottom: 0 }}>
              Claims Fraud Risk Detector
            </p>
          </div>

          <form onSubmit={handleSubmit}>
            {/* Username */}
            <div style={{ marginBottom: 18 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#667088", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 7 }}>
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => { setUsername(e.target.value); setError(false); }}
                autoComplete="username"
                autoFocus
                required
                placeholder="Username"
                style={{ width: "100%", height: 48, background: "rgba(255,255,255,0.55)", border: "1px solid rgba(100,116,139,0.22)", borderRadius: 10, padding: "0 14px", color: "#161b2e", fontSize: 14, fontFamily: "inherit", boxSizing: "border-box", outline: "none", transition: "border-color 0.2s, box-shadow 0.2s" }}
                onFocus={(e) => { e.target.style.borderColor = "#3b82f6"; e.target.style.boxShadow = "0 0 0 3px rgba(59,130,246,0.15)"; }}
                onBlur={(e) => { e.target.style.borderColor = "rgba(100,116,139,0.22)"; e.target.style.boxShadow = "none"; }}
              />
            </div>

            {/* Password */}
            <div style={{ marginBottom: 18 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#667088", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 7 }}>
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(false); }}
                autoComplete="current-password"
                required
                placeholder="Password"
                style={{ width: "100%", height: 48, background: "rgba(255,255,255,0.55)", border: "1px solid rgba(100,116,139,0.22)", borderRadius: 10, padding: "0 14px", color: "#161b2e", fontSize: 14, fontFamily: "inherit", boxSizing: "border-box", outline: "none", transition: "border-color 0.2s, box-shadow 0.2s" }}
                onFocus={(e) => { e.target.style.borderColor = "#3b82f6"; e.target.style.boxShadow = "0 0 0 3px rgba(59,130,246,0.15)"; }}
                onBlur={(e) => { e.target.style.borderColor = "rgba(100,116,139,0.22)"; e.target.style.boxShadow = "none"; }}
              />
            </div>

            {/* Error */}
            {error && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#dc2626", borderRadius: 999, padding: "9px 16px", fontSize: 13, marginBottom: 18 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                Invalid username or password.
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              style={{ width: "100%", height: 50, borderRadius: 10, border: "none", background: "linear-gradient(135deg, #3b82f6, #6366f1)", color: "#fff", fontSize: 15, fontWeight: 600, fontFamily: "inherit", cursor: loading ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: loading ? 0.85 : 1, transition: "transform 0.2s, box-shadow 0.2s, filter 0.2s" }}
              onMouseEnter={(e) => { if (!loading) { const btn = e.currentTarget; btn.style.transform = "translateY(-1px)"; btn.style.boxShadow = "0 10px 28px rgba(59,130,246,0.4)"; btn.style.filter = "brightness(1.06)"; } }}
              onMouseLeave={(e) => { const btn = e.currentTarget; btn.style.transform = ""; btn.style.boxShadow = ""; btn.style.filter = ""; }}
            >
              {loading && (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: "spinLoader 0.7s linear infinite" }}>
                  <path d="M21 12a9 9 0 11-6.219-8.56" />
                </svg>
              )}
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          {/* Quote */}
          <div style={{ marginTop: 28, paddingTop: 24, borderTop: "1px solid rgba(30,41,59,0.08)", textAlign: "center" }}>
            <div style={{ width: 28, height: 1, background: "rgba(71,81,107,0.25)", margin: "0 auto 14px" }} />
            <p style={{ fontStyle: "italic", fontSize: 13, lineHeight: 1.65, color: "#47516b", opacity: 0.88, margin: "0 0 10px" }}>
              "A flagged claim is not an accusation — it is a question the data is asking an investigator to answer"
            </p>
            <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "#8791a8", margin: 0 }}>
              — Claims Investigation Notes
            </p>
          </div>

          {/* Model info */}
          <p style={{ marginTop: 20, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: "#8791a8", textAlign: "center", margin: "16px 0 0" }}>
            Model v1.0 · 31 features · 5,410 providers
          </p>
        </div>
      </div>

      {/* Page footer */}
      <p style={{ position: "absolute", left: 0, right: 0, bottom: 18, zIndex: 2, textAlign: "center", fontSize: 11, color: "#667088", opacity: 0.65, margin: 0 }}>
        Medicare Provider Fraud Detection
      </p>
    </div>
  );
}
