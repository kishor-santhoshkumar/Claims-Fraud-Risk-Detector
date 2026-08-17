import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { BarChart3, LayoutDashboard, ListChecks, LogOut, MessageSquare, Settings, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { logout } from "@/lib/auth";

const items = [
  { to: "/",           label: "Dashboard", icon: LayoutDashboard },
  { to: "/queue",      label: "Queue",     icon: ListChecks },
  { to: "/assistant",  label: "Assistant", icon: MessageSquare },
  { to: "/analytics",  label: "Analytics", icon: BarChart3 },
  { to: "/simulation", label: "Simulation",icon: SlidersHorizontal },
  { to: "/settings",   label: "Settings",  icon: Settings },
];

const SIDEBAR_STYLE: React.CSSProperties = {
  position: "relative",
  zIndex: 2,
  flexShrink: 0,
  height: "100svh",
  display: "flex",
  flexDirection: "column",
  background: "linear-gradient(160deg, rgba(255,255,255,0.52) 0%, rgba(230,233,253,0.36) 100%)",
  backdropFilter: "blur(24px) saturate(180%)",
  WebkitBackdropFilter: "blur(24px) saturate(180%)",
  borderRight: "1px solid rgba(255,255,255,0.7)",
  boxShadow: "4px 0 24px rgba(76,81,219,0.06)",
  padding: "18px 14px",
  transition: "width 0.2s ease",
};

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate({ to: "/login" });
  };

  return (
    <nav className="w-14 md:w-[200px]" style={SIDEBAR_STYLE}>
      {/* Brand */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 32, marginBottom: 16, paddingBottom: 16, borderBottom: "1px solid rgba(30,41,59,0.08)" }}>
        <div style={{ width: 30, height: 30, flexShrink: 0, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #3b82f6, #6366f1)", boxShadow: "0 4px 14px rgba(59,130,246,0.35)" }}>
          <ShieldCheck size={15} color="#fff" strokeWidth={2} />
        </div>
        <span className="hidden md:inline" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          Payment Integrity
        </span>
      </div>

      {/* Nav */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
        {items.map(({ to, label, icon: Icon }) => {
          const active = to === "/" ? pathname === "/" : pathname.startsWith(to);
          return (
            <Link
              key={to}
              to={to}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                height: 44,
                padding: "0 12px",
                borderRadius: 10,
                textDecoration: "none",
                fontSize: 13.5,
                fontWeight: 500,
                borderLeft: active ? "3px solid #3b82f6" : "3px solid transparent",
                background: active ? "rgba(59,130,246,0.14)" : "transparent",
                color: active ? "#1d4ed8" : "var(--text-muted)",
                transition: "background 0.15s, color 0.15s, border-color 0.15s",
              }}
              onMouseEnter={(e) => { if (!active) { (e.currentTarget as HTMLAnchorElement).style.background = "rgba(255,255,255,0.55)"; (e.currentTarget as HTMLAnchorElement).style.color = "var(--text-primary)"; } }}
              onMouseLeave={(e) => { if (!active) { (e.currentTarget as HTMLAnchorElement).style.background = "transparent"; (e.currentTarget as HTMLAnchorElement).style.color = "var(--text-muted)"; } }}
            >
              <Icon size={16} strokeWidth={1.75} style={{ flexShrink: 0, color: active ? "#2563eb" : undefined }} />
              <span className="hidden md:inline">{label}</span>
            </Link>
          );
        })}
      </div>

      {/* Bottom */}
      <div style={{ marginTop: "auto", paddingTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
        {/* User card */}
        <div className="hidden md:flex" style={{ alignItems: "center", gap: 10, background: "rgba(255,255,255,0.5)", border: "1px solid rgba(100,116,139,0.22)", borderRadius: 12, padding: "8px 10px" }}>
          <div style={{ width: 30, height: 30, flexShrink: 0, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#f8fafc", background: "linear-gradient(135deg, #3b82f6, #6366f1)" }}>
            CC
          </div>
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>CodeCrafters</span>
            <span style={{ fontSize: 11, color: "var(--text-faint)" }}>v1.0 · 31 features</span>
          </div>
        </div>
        <button
          onClick={handleLogout}
          style={{ display: "flex", alignItems: "center", gap: 10, height: 38, padding: "0 12px", borderRadius: 10, border: "1px solid rgba(100,116,139,0.22)", background: "rgba(255,255,255,0.5)", color: "var(--text-muted)", fontSize: 13, fontWeight: 500, fontFamily: "inherit", cursor: "pointer", transition: "background 0.15s, color 0.15s, border-color 0.15s", width: "100%", justifyContent: "center" }}
          onMouseEnter={(e) => { const b = e.currentTarget; b.style.background = "rgba(239,68,68,0.1)"; b.style.borderColor = "rgba(239,68,68,0.3)"; b.style.color = "#dc2626"; }}
          onMouseLeave={(e) => { const b = e.currentTarget; b.style.background = "rgba(255,255,255,0.5)"; b.style.borderColor = "rgba(100,116,139,0.22)"; b.style.color = "var(--text-muted)"; }}
        >
          <LogOut size={16} strokeWidth={1.75} style={{ flexShrink: 0 }} />
          <span className="hidden md:inline">Sign out</span>
        </button>
      </div>
    </nav>
  );
}
