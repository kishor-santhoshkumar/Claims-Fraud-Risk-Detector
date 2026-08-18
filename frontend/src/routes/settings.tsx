import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bell, Briefcase, DatabaseZap, LogOut, Monitor, Moon, Sun } from "lucide-react";
import { useCaseStore } from "@/lib/caseStore";
import { logout } from "@/lib/auth";

export const Route = createFileRoute("/settings")({
  component: Settings,
});

function loadPref<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; } catch { return fallback; }
}
function savePref(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      style={{
        width: 46, height: 26, borderRadius: 13, border: "none", cursor: "pointer",
        background: on ? "linear-gradient(135deg, #3b82f6, #6366f1)" : "rgba(100,116,139,0.28)",
        position: "relative", flexShrink: 0,
        transition: "background 0.25s",
        boxShadow: on ? "0 2px 10px rgba(99,102,241,0.45)" : "inset 0 1px 3px rgba(0,0,0,0.12)",
        padding: 0,
      }}
    >
      <span style={{
        display: "block", position: "absolute",
        top: 4, left: on ? 24 : 4,
        width: 18, height: 18, borderRadius: "50%",
        background: "#fff",
        boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
        transition: "left 0.22s cubic-bezier(0.34,1.56,0.64,1)",
      }} />
    </button>
  );
}

function SectionCard({
  icon: Icon,
  title,
  accent = "#3b82f6",
  style: extraStyle,
  children,
}: {
  icon: React.ElementType;
  title: string;
  accent?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <div className="glass-panel" style={{ marginBottom: 0, ...extraStyle }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18, paddingBottom: 14, borderBottom: "1px solid rgba(30,41,59,0.07)" }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", background: `${accent}18`, border: `1px solid ${accent}30` }}>
          <Icon size={15} style={{ color: accent }} />
        </div>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>{title}</h2>
      </div>
      {children}
    </div>
  );
}

function SettingRow({
  label,
  desc,
  last = false,
  children,
}: {
  label: string;
  desc?: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
      padding: "12px 0",
      borderBottom: last ? "none" : "1px solid rgba(30,41,59,0.06)",
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)", margin: 0 }}>{label}</p>
        {desc && <p style={{ fontSize: 11, color: "var(--text-faint)", margin: "2px 0 0", lineHeight: 1.4 }}>{desc}</p>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

function ChipGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { val: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {options.map((o) => {
        const active = value === o.val;
        return (
          <button
            key={o.val}
            onClick={() => onChange(o.val)}
            style={{
              height: 30, padding: "0 13px", borderRadius: 999, fontSize: 12, fontWeight: 500,
              fontFamily: "inherit", cursor: "pointer",
              border: active ? "1px solid rgba(59,130,246,0.4)" : "1px solid rgba(100,116,139,0.22)",
              background: active ? "rgba(59,130,246,0.16)" : "rgba(255,255,255,0.5)",
              color: active ? "#1d4ed8" : "var(--text-muted)",
              transition: "background 0.15s, color 0.15s, border-color 0.15s",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Settings() {
  const { counts, reset } = useCaseStore();
  const navigate = useNavigate();

  const [darkMode,      setDarkMode]      = useState(() => loadPref("pref_dark",        false));
  const [alertHigh,     setAlertHigh]     = useState(() => loadPref("pref_alert_high",   true));
  const [alertEscalate, setAlertEscalate] = useState(() => loadPref("pref_alert_esc",    true));
  const [alertScoring,  setAlertScoring]  = useState(() => loadPref("pref_alert_score",  false));
  const [autoNext,      setAutoNext]      = useState(() => loadPref("pref_auto_next",    false));
  const [confirmDecide, setConfirmDecide] = useState(() => loadPref("pref_confirm",      true));
  const [density,       setDensity]       = useState<"compact"|"comfortable"|"spacious">(() => loadPref("pref_density", "comfortable"));
  const [theme,         setTheme]         = useState<"glass-blue"|"slate"|"violet">(() => loadPref("pref_theme", "glass-blue"));

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", darkMode ? "dark" : "light");
    savePref("pref_dark", darkMode);
  }, [darkMode]);

  useEffect(() => { savePref("pref_alert_high",  alertHigh); },     [alertHigh]);
  useEffect(() => { savePref("pref_alert_esc",   alertEscalate); }, [alertEscalate]);
  useEffect(() => { savePref("pref_alert_score", alertScoring); },  [alertScoring]);
  useEffect(() => { savePref("pref_auto_next",   autoNext); },      [autoNext]);
  useEffect(() => { savePref("pref_confirm",     confirmDecide); }, [confirmDecide]);
  useEffect(() => { savePref("pref_density",     density); },       [density]);
  useEffect(() => { savePref("pref_theme",       theme); },         [theme]);

  const handleLogout = () => {
    logout();
    navigate({ to: "/login" });
  };

  return (
    <div style={{ padding: "36px 48px 80px" }}>
      {/* Page header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--text-primary)", margin: 0, letterSpacing: "-0.01em" }}>Settings</h1>
        <p style={{ marginTop: 5, fontSize: 13, color: "var(--text-faint)", marginBottom: 0 }}>Customize your fraud review workspace</p>
      </div>

      {/* ── 2×2 grid ─────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 24, alignItems: "start" }}>

        {/* ── Notifications ──────────────────────────────────────────── */}
        <SectionCard icon={Bell} title="Notifications" accent="#f59e0b">
          <SettingRow
            label="High-risk provider alerts"
            desc="Notify when a provider scores above the high-risk threshold (≥ 0.50)"
          >
            <Toggle on={alertHigh} onChange={setAlertHigh} />
          </SettingRow>
          <SettingRow
            label="Case escalation alerts"
            desc="Notify when a case is escalated for senior review"
          >
            <Toggle on={alertEscalate} onChange={setAlertEscalate} />
          </SettingRow>
          <SettingRow
            label="Scoring completion alerts"
            desc="Notify when a new model scoring run finishes"
            last
          >
            <Toggle on={alertScoring} onChange={setAlertScoring} />
          </SettingRow>
        </SectionCard>

        {/* ── Investigation ──────────────────────────────────────────── */}
        <SectionCard icon={Briefcase} title="Investigation" accent="#10b981">
          <SettingRow
            label="Auto-open next case"
            desc="Automatically advance to the next queued case after recording a decision"
          >
            <Toggle on={autoNext} onChange={setAutoNext} />
          </SettingRow>
          <SettingRow
            label="Confirm before decision"
            desc="Show a confirmation prompt before confirming fraud or clearing a provider"
            last
          >
            <Toggle on={confirmDecide} onChange={setConfirmDecide} />
          </SettingRow>
        </SectionCard>

        {/* ── Display ────────────────────────────────────────────────── */}
        <SectionCard icon={Monitor} title="Display" accent="#3b82f6">
          <SettingRow
            label="Dark mode"
            desc="Switch between light and dark interface"
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Sun size={14} style={{ color: darkMode ? "var(--text-faint)" : "#f59e0b", transition: "color 0.2s" }} />
              <Toggle on={darkMode} onChange={setDarkMode} />
              <Moon size={14} style={{ color: darkMode ? "#6366f1" : "var(--text-faint)", transition: "color 0.2s" }} />
            </div>
          </SettingRow>
          <SettingRow
            label="Theme"
            desc="Colour accent for the interface"
          >
            <ChipGroup
              options={[
                { val: "glass-blue" as const, label: "Glass Blue" },
                { val: "slate"      as const, label: "Slate" },
                { val: "violet"     as const, label: "Violet" },
              ]}
              value={theme}
              onChange={setTheme}
            />
          </SettingRow>
          <SettingRow
            label="Interface density"
            desc="Control spacing and sizing of UI elements"
            last
          >
            <ChipGroup
              options={[
                { val: "compact"     as const, label: "Compact" },
                { val: "comfortable" as const, label: "Comfortable" },
                { val: "spacious"    as const, label: "Spacious" },
              ]}
              value={density}
              onChange={setDensity}
            />
          </SettingRow>
        </SectionCard>

        {/* ── Model Configuration ────────────────────────────────────── */}
        <SectionCard icon={DatabaseZap} title="Model Configuration" accent="#8b5cf6">
        {[
          { label: "Model version",       value: "v1.0" },
          { label: "Features",            value: "31" },
          { label: "Review threshold",    value: "Score ≥ 0.50 (high) · ≥ 0.15 (medium)" },
          { label: "Scoring run",         value: "14 Aug 2026" },
          { label: "Deterministic rules", value: "12" },
          { label: "Data source",         value: "Kaggle — Medicare Provider Fraud Detection" },
        ].map((r, i, arr) => (
          <div
            key={r.label}
            style={{
              display: "grid", gridTemplateColumns: "200px 1fr", gap: 12,
              padding: "11px 0", fontSize: 13,
              borderBottom: i === arr.length - 1 ? "none" : "1px solid rgba(30,41,59,0.06)",
            }}
          >
            <span style={{ color: "var(--text-faint)", fontWeight: 500 }}>{r.label}</span>
            <span style={{ fontFamily: "ui-monospace, monospace", color: "var(--text-secondary)", fontSize: 12 }}>{r.value}</span>
          </div>
        ))}

        <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid rgba(30,41,59,0.07)" }}>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 12 }}>
            {counts.reviewed} decision{counts.reviewed !== 1 ? "s" : ""} this session —{" "}
            {counts.confirmed} confirmed, {counts.cleared} cleared, {counts.needsInfo} needs info.
          </p>
          <button
            onClick={() => { reset(); toast("Session decisions reset"); }}
            style={{ height: 36, padding: "0 16px", borderRadius: 9, border: "1px solid rgba(100,116,139,0.22)", background: "rgba(255,255,255,0.6)", color: "var(--text-muted)", fontSize: 13, fontWeight: 500, fontFamily: "inherit", cursor: "pointer", transition: "background 0.15s, color 0.15s, border-color 0.15s" }}
            onMouseEnter={(e) => { const b = e.currentTarget; b.style.background = "rgba(239,68,68,0.08)"; b.style.borderColor = "rgba(239,68,68,0.25)"; b.style.color = "#dc2626"; }}
            onMouseLeave={(e) => { const b = e.currentTarget; b.style.background = "rgba(255,255,255,0.6)"; b.style.borderColor = "rgba(100,116,139,0.22)"; b.style.color = "var(--text-muted)"; }}
          >
            Reset session decisions
          </button>
        </div>
      </SectionCard>

      </div>{/* end 2×2 grid */}

      {/* ── Account ──────────────────────────────────────────────────── */}
      <SectionCard icon={LogOut} title="Account" accent="#ef4444">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 0" }}>
          <div>
            <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>CodeCrafters</p>
            <p style={{ fontSize: 12, color: "var(--text-faint)", margin: "3px 0 0" }}>Model v1.0 · 31 features · 5,410 providers</p>
          </div>
          <button
            onClick={handleLogout}
            style={{
              height: 38, padding: "0 20px", borderRadius: 10,
              border: "1px solid rgba(239,68,68,0.28)",
              background: "rgba(239,68,68,0.08)",
              color: "#dc2626", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
              display: "flex", alignItems: "center", gap: 8,
              transition: "background 0.15s, border-color 0.15s",
            }}
            onMouseEnter={(e) => { const b = e.currentTarget; b.style.background = "rgba(239,68,68,0.18)"; b.style.borderColor = "rgba(239,68,68,0.45)"; }}
            onMouseLeave={(e) => { const b = e.currentTarget; b.style.background = "rgba(239,68,68,0.08)"; b.style.borderColor = "rgba(239,68,68,0.28)"; }}
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      </SectionCard>
    </div>
  );
}
