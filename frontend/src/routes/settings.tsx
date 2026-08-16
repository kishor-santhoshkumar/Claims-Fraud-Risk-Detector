import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { useCaseStore } from "@/lib/caseStore";

export const Route = createFileRoute("/settings")({
  component: Settings,
});

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[220px_1fr] gap-4 py-2.5 text-[13px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function Settings() {
  const { counts, reset } = useCaseStore();

  return (
    <div className="max-w-2xl px-6 pb-16">
      <header className="border-b border-border py-4">
        <h1 className="text-[15px] font-medium">Settings</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">Model configuration and session state.</p>
      </header>

      <div className="mt-6 divide-y divide-border border-y border-border">
        <Row label="Model version" value="v1.0" />
        <Row label="Features" value="31" />
        <Row label="Review threshold" value="0.55" />
        <Row label="Scoring run" value="14 Aug 2026" />
        <Row label="Deterministic rules" value="12" />
        <Row label="Data source" value="Kaggle — Medicare Provider Fraud Detection" />
      </div>

      <div className="mt-8">
        <p className="text-[13px] text-muted-foreground">
          {counts.reviewed} decisions recorded this session — {counts.confirmed} confirmed, {counts.cleared}{" "}
          cleared, {counts.needsInfo} awaiting information.
        </p>
        <button
          onClick={() => {
            reset();
            toast("Session decisions reset");
          }}
          className="mt-3 border border-border px-3 py-1.5 text-[13px] hover:bg-muted"
        >
          Reset decisions
        </button>
      </div>
    </div>
  );
}
