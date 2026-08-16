import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { useCaseStore } from "@/lib/caseStore";

export const Route = createFileRoute("/settings")({
  component: Settings,
});

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 16, padding: "11px 0", fontSize: 13, borderBottom: "1px solid rgba(30,41,59,0.08)" }}>
      <span style={{ color: "#667088" }}>{label}</span>
      <span style={{ fontFamily: "ui-monospace, monospace", color: "#161b2e" }}>{value}</span>
    </div>
  );
}

function Settings() {
  const { counts, reset } = useCaseStore();

  return (
    <div style={{ maxWidth: 640, padding: "0 24px 64px" }}>
      <header style={{ paddingTop: 24, paddingBottom: 20, marginBottom: 8 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: "#161b2e", margin: 0 }}>Settings</h1>
        <p style={{ marginTop: 4, fontSize: 13, color: "#667088", marginBottom: 0 }}>Model configuration and session state.</p>
      </header>

      {/* Model config glass card */}
      <div className="glass-panel" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "#667088", marginBottom: 4 }}>
          Model Configuration
        </h2>
        <div>
          <Row label="Model version" value="v1.0" />
          <Row label="Features" value="31" />
          <Row label="Review threshold" value="0.55" />
          <Row label="Scoring run" value="14 Aug 2026" />
          <Row label="Deterministic rules" value="12" />
          <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 16, padding: "11px 0", fontSize: 13 }}>
            <span style={{ color: "#667088" }}>Data source</span>
            <span style={{ fontFamily: "ui-monospace, monospace", color: "#161b2e" }}>Kaggle — Medicare Provider Fraud Detection</span>
          </div>
        </div>
      </div>

      {/* Session state glass card */}
      <div className="glass-panel">
        <h2 style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "#667088", marginBottom: 12 }}>
          Session State
        </h2>
        <p style={{ fontSize: 13, color: "#47516b", marginBottom: 16 }}>
          {counts.reviewed} decisions recorded this session — {counts.confirmed} confirmed, {counts.cleared}{" "}
          cleared, {counts.needsInfo} awaiting information.
        </p>
        <button
          onClick={() => {
            reset();
            toast("Session decisions reset");
          }}
          style={{ display: "flex", alignItems: "center", gap: 8, height: 38, padding: "0 16px", borderRadius: 10, border: "1px solid rgba(100,116,139,0.22)", background: "rgba(255,255,255,0.6)", color: "#47516b", fontSize: 13, fontWeight: 500, fontFamily: "inherit", cursor: "pointer", transition: "background 0.15s, color 0.15s" }}
          onMouseEnter={(e) => { const b = e.currentTarget; b.style.background = "rgba(239,68,68,0.08)"; b.style.borderColor = "rgba(239,68,68,0.25)"; b.style.color = "#dc2626"; }}
          onMouseLeave={(e) => { const b = e.currentTarget; b.style.background = "rgba(255,255,255,0.6)"; b.style.borderColor = "rgba(100,116,139,0.22)"; b.style.color = "#47516b"; }}
        >
          Reset decisions
        </button>
      </div>
    </div>
  );
}
