import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { EvidenceList } from "@/components/EvidenceList";
import { NarrativePanel } from "@/components/NarrativePanel";
import { useCaseStore } from "@/lib/caseStore";
import { type CaseStatus, type ProviderDetail } from "@/lib/api";
import { formatMoneyFull } from "@/lib/mockData";
import { cn } from "@/lib/utils";

export function CaseDetail({ provider, variant }: { provider: ProviderDetail; variant: "case" | "clearance" }) {
  const navigate = useNavigate();
  const { providers, setStatus } = useCaseStore();
  const [explaining, setExplaining] = useState(false);

  const queueEntry = providers.find((p) => p.provider_id === provider.provider_id);
  const currentStatus: CaseStatus = queueEntry?.status ?? provider.status;
  const index = providers.findIndex((p) => p.provider_id === provider.provider_id);
  const next =
    providers.slice(index + 1).find((p) => p.status === "unreviewed" && p.risk_tier !== "low") ??
    providers.find((p) => p.status === "unreviewed" && p.risk_tier !== "low");

  const decide = (status: CaseStatus, label: string) => {
    setStatus(provider.provider_id, status);
    toast(`${provider.provider_id} ${label}`, {
      action: { label: "Undo", onClick: () => setStatus(provider.provider_id, "unreviewed") },
    });
    if (next) navigate({ to: "/case/$providerId", params: { providerId: next.provider_id } });
  };

  const decideRef = useRef(decide);
  decideRef.current = decide;

  useEffect(() => {
    if (variant !== "case") return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t?.tagName === "INPUT" || t?.tagName === "TEXTAREA") return;
      if (e.key === "f" || e.key === "F") decideRef.current("confirmed", "confirmed as fraud");
      if (e.key === "c" || e.key === "C") decideRef.current("cleared", "cleared");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [variant]);

  return (
    <div className="mx-auto max-w-3xl px-6 pb-16">
      <div className="flex items-center justify-between border-b border-border py-3 text-[11px] text-muted-foreground">
        <span>
          {variant === "case" && index >= 0
            ? `Case ${index + 1} of ${providers.length}`
            : "Cleared provider"}
        </span>
        <span>Esc returns to queue · F confirms · C clears</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-6 py-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-mono text-[18px]">{provider.provider_id}</h1>
            {variant === "case" ? (
              <span className="border border-risk/40 px-1.5 py-0.5 text-[11px] text-risk">
                {provider.risk_tier === "high" ? "High risk" : "Medium risk"}
              </span>
            ) : (
              <span className="border border-cleared/40 px-1.5 py-0.5 text-[11px] text-cleared">
                Not flagged
              </span>
            )}
          </div>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            {provider.n_claims.toLocaleString()} claims ·{" "}
            {provider.n_unique_bene != null ? provider.n_unique_bene.toLocaleString() : "—"} beneficiaries ·{" "}
            {provider.state ?? "—"}
          </p>
          {variant === "clearance" && (
            <p className="mt-1 text-[13px] text-muted-foreground">
              Score {provider.score.toFixed(2)}, below the review threshold of 0.15
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Money at risk</p>
          <p className="font-mono text-[24px] tabular-nums">{formatMoneyFull(provider.expected_loss)}</p>
        </div>
      </div>

      {variant === "case" ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <button
            onClick={() => decide("confirmed", "confirmed as fraud")}
            className={cn(
              "border border-risk/50 px-3 py-2 text-[13px] text-risk hover:bg-risk hover:text-background",
              currentStatus === "confirmed" && "bg-risk text-background",
            )}
          >
            Confirm fraud
          </button>
          <button
            onClick={() => decide("cleared", "cleared")}
            className={cn(
              "border border-cleared/50 px-3 py-2 text-[13px] text-cleared hover:bg-cleared hover:text-background",
              currentStatus === "cleared" && "bg-cleared text-background",
            )}
          >
            Clear provider
          </button>
          <button
            onClick={() => decide("needs_info", "marked as needing information")}
            className="border border-border px-3 py-2 text-[13px] hover:bg-muted"
          >
            Need info
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setExplaining(true)}
            className="border border-foreground/30 bg-muted px-3 py-2 text-[13px]"
          >
            Why was this not flagged?
          </button>
          <button
            onClick={() => {
              setStatus(provider.provider_id, "needs_info");
              toast(`${provider.provider_id} flagged for review`, {
                action: { label: "Undo", onClick: () => setStatus(provider.provider_id, "unreviewed") },
              });
            }}
            className="border border-border px-3 py-2 text-[13px] hover:bg-muted"
          >
            Flag for review anyway
          </button>
        </div>
      )}

      {variant === "case" && (
        <button
          onClick={() => setExplaining(true)}
          className="mt-2 w-full border border-border px-3 py-2 text-[13px] hover:bg-muted"
        >
          Explain this case
        </button>
      )}

      <div className="mt-8">
        <h2 className="mb-2 text-[12px] uppercase tracking-wide text-muted-foreground">Evidence</h2>
        <EvidenceList evidence={provider.evidence} />
      </div>

      {variant === "clearance" && provider.clearance_summary && !explaining && (
        <p className="mt-3 text-[13px] text-muted-foreground">{provider.clearance_summary}</p>
      )}

      <Link
        to="/claims/$providerId"
        params={{ providerId: provider.provider_id }}
        className="mt-6 inline-block text-[13px] underline underline-offset-4 hover:text-muted-foreground"
      >
        View all {provider.n_claims.toLocaleString()} claims
      </Link>

      <p className="mt-8 text-[11px] text-muted-foreground">
        Model v1.0 · 31 features · scored 14 Aug 2026 · Score {provider.score.toFixed(4)}
      </p>

      <NarrativePanel
        providerId={provider.provider_id}
        evidence={provider.evidence}
        variant={variant}
        open={explaining}
        onOpenChange={setExplaining}
      />
    </div>
  );
}
