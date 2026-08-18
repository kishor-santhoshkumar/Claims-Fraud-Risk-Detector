import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useCaseStore, type CaseProvider, type CaseStatus } from "@/lib/caseStore";
import { formatMoneyShort } from "@/lib/mockData";

export const Route = createFileRoute("/confirmed")({
  component: ConfirmedPage,
});

function TierBadge({ tier }: { tier: CaseProvider["risk_tier"] }) {
  const map = {
    high:   { bg: "rgba(239,68,68,0.12)",  border: "rgba(239,68,68,0.3)",  color: "#dc2626", label: "High" },
    medium: { bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.3)", color: "#b45309", label: "Medium" },
    low:    { bg: "rgba(16,185,129,0.12)", border: "rgba(16,185,129,0.3)", color: "#059669", label: "Low" },
  }[tier];
  return (
    <span style={{ display: "inline-flex", justifyContent: "center", minWidth: 62, borderRadius: 6, padding: "2px 6px", fontSize: 11, fontWeight: 600, background: map.bg, border: `1px solid ${map.border}`, color: map.color }}>
      {map.label}
    </span>
  );
}

function ConfirmedPage() {
  const navigate = useNavigate();
  const { providers, setStatus } = useCaseStore();
  const confirmed = providers.filter((p) => p.status === "confirmed");

  const askAboutProvider = (p: CaseProvider) => {
    try {
      sessionStorage.setItem("chat_prefill", `@${p.provider_id} `);
      const prev: string[] = JSON.parse(sessionStorage.getItem("chat_session_providers") ?? "[]");
      sessionStorage.setItem("chat_session_providers", JSON.stringify(Array.from(new Set([...prev, p.provider_id]))));
    } catch {}
    navigate({ to: "/assistant" });
  };

  const undo = (p: CaseProvider) => {
    setStatus(p.provider_id, "unreviewed" as CaseStatus);
    toast(`${p.provider_id} moved back to unreviewed`, {
      action: { label: "Redo", onClick: () => setStatus(p.provider_id, "confirmed") },
    });
  };

  const totalLoss = confirmed.reduce((s, p) => s + p.expected_loss, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100svh" }}>
      <header style={{ padding: "20px 24px 16px", backdropFilter: "blur(20px) saturate(180%)", WebkitBackdropFilter: "blur(20px) saturate(180%)", background: "linear-gradient(160deg, rgba(255,255,255,0.72) 0%, rgba(253,228,228,0.4) 100%)", borderBottom: "1px solid rgba(255,255,255,0.75)" }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>Confirmed Fraud</h1>
        <p style={{ fontSize: 12, color: "var(--text-faint)", margin: "4px 0 0" }}>
          {confirmed.length.toLocaleString()} providers confirmed · {formatMoneyShort(totalLoss)} total expected loss
        </p>
      </header>

      <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px 32px" }}>
        {confirmed.length === 0 ? (
          <div style={{ paddingTop: 60, textAlign: "center" }}>
            <p style={{ fontSize: 14, color: "var(--text-muted)" }}>No providers confirmed yet.</p>
            <p style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 6 }}>
              Confirm fraud from the <Link to="/queue" style={{ color: "#3b82f6" }}>review queue</Link> or individual case pages.
            </p>
          </div>
        ) : (
          <div className="glass-card" style={{ overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "40px 110px 70px 1fr 90px 110px 100px 60px 110px", gap: 10, padding: "7px 16px", background: "rgba(248,250,255,0.5)", borderBottom: "1px solid rgba(30,41,59,0.07)" }}>
              {["#", "Provider ID", "Tier", "State", "Score", "Exp. Loss", "Claims", "", "Action"].map(h => (
                <span key={h} style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-faint)" }}>{h}</span>
              ))}
            </div>

            {confirmed.map((p, i) => (
              <div
                key={p.provider_id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "40px 110px 70px 1fr 90px 110px 100px 60px 110px",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 16px",
                  fontSize: 13,
                  borderBottom: "1px solid rgba(30,41,59,0.05)",
                  color: "var(--text-secondary)",
                }}
              >
                <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--text-faint)" }}>{i + 1}</span>
                <Link
                  to={p.risk_tier === "low" ? "/clearance/$providerId" : "/case/$providerId"}
                  params={{ providerId: p.provider_id }}
                  style={{ fontFamily: "ui-monospace,monospace", color: "#1d4ed8", textDecoration: "none", fontWeight: 600 }}
                >
                  {p.provider_id}
                </Link>
                <TierBadge tier={p.risk_tier} />
                <span style={{ color: "var(--text-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.state ?? "—"}</span>
                <span style={{ fontFamily: "ui-monospace,monospace", fontVariantNumeric: "tabular-nums" }}>{p.score.toFixed(4)}</span>
                <span style={{ fontFamily: "ui-monospace,monospace", fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{formatMoneyShort(p.expected_loss)}</span>
                <span style={{ color: "var(--text-faint)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{p.n_claims.toLocaleString()}</span>
                <button
                  onClick={() => askAboutProvider(p)}
                  style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, border: "1px solid rgba(59,130,246,0.3)", background: "rgba(59,130,246,0.06)", color: "#1d4ed8", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(59,130,246,0.14)"; e.currentTarget.style.borderColor = "rgba(59,130,246,0.6)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(59,130,246,0.06)"; e.currentTarget.style.borderColor = "rgba(59,130,246,0.3)"; }}
                >
                  Ask
                </button>
                <button
                  onClick={() => undo(p)}
                  style={{ fontSize: 11, fontFamily: "inherit", color: "var(--text-faint)", background: "none", border: "1px solid rgba(100,116,139,0.22)", borderRadius: 6, padding: "4px 8px", cursor: "pointer" }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#ef4444"; e.currentTarget.style.color = "#dc2626"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(100,116,139,0.22)"; e.currentTarget.style.color = "var(--text-faint)"; }}
                >
                  Undo
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
