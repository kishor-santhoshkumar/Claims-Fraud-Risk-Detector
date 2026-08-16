import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { BarChart3, ListChecks, LogOut, MessageSquare, Settings, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { logout } from "@/lib/auth";

const items = [
  { to: "/", label: "Queue", icon: ListChecks },
  { to: "/assistant", label: "Assistant", icon: MessageSquare },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/simulation", label: "Simulation", icon: SlidersHorizontal },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate({ to: "/login" });
  };

  return (
    <nav className="flex h-screen w-14 shrink-0 flex-col border-r border-border bg-background md:w-[200px]">
      <div className="flex h-12 items-center border-b border-border px-3 md:px-4">
        <span className="hidden text-[13px] font-medium tracking-tight md:inline">Payment integrity</span>
        <span className="text-[13px] font-medium md:hidden">PI</span>
      </div>
      <div className="flex flex-col gap-px p-2">
        {items.map(({ to, label, icon: Icon }) => {
          const active = to === "/" ? pathname === "/" : pathname.startsWith(to);
          return (
            <Link
              key={to}
              to={to}
              className={cn(
                "flex items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-muted",
                active && "bg-muted font-medium text-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" strokeWidth={1.75} />
              <span className="hidden md:inline">{label}</span>
            </Link>
          );
        })}
      </div>
      <div className="mt-auto p-2">
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <LogOut className="size-4 shrink-0" strokeWidth={1.75} />
          <span className="hidden md:inline">Sign out</span>
        </button>
        <div className="mt-2 hidden px-2 py-1 text-[11px] text-muted-foreground md:block">
          Model v1.0 · 31 features
        </div>
      </div>
    </nav>
  );
}
