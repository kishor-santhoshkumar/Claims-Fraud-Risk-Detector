import type { Evidence, ShapEvidence } from "@/lib/api";
import { cn } from "@/lib/utils";

function SeverityPill({ sev }: { sev: string }) {
  return (
    <span
      className={cn(
        "inline-block rounded-sm px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
        sev === "high" && "bg-risk/10 text-risk",
        sev === "medium" && "bg-amber-100 text-amber-700",
        sev === "low" && "bg-muted text-muted-foreground",
      )}
    >
      {sev}
    </span>
  );
}

function CategoryPill({ cat }: { cat: string }) {
  return (
    <span className="inline-block rounded-sm bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
      {cat}
    </span>
  );
}

export function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  const shap = evidence.filter((e): e is ShapEvidence => e.type === "shap");
  const rest = evidence.filter((e) => e.type !== "shap");
  const maxImpact = Math.max(...shap.map((e) => Math.abs(e.impact)), 1);
  const sorted = [...shap].sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));

  return (
    <div className="space-y-6">
      {sorted.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
            Model drivers (SHAP)
          </p>
          <ul className="divide-y divide-border border-y border-border">
            {sorted.map((e) => (
              <li
                key={e.feature}
                className="grid grid-cols-[1fr_180px_56px] items-center gap-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px]">{e.summary}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{e.feature}</p>
                </div>
                <div className="hidden h-1.5 bg-muted sm:block">
                  <div
                    className={
                      e.direction === "increases_risk" ? "h-full bg-risk" : "h-full bg-cleared"
                    }
                    style={{ width: `${(Math.abs(e.impact) / maxImpact) * 100}%` }}
                  />
                </div>
                <span
                  className={
                    "text-right font-mono text-[12px] " +
                    (e.direction === "increases_risk" ? "text-risk" : "text-cleared")
                  }
                >
                  {e.impact > 0 ? "+" : ""}
                  {e.impact.toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {rest.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
            Rule &amp; policy findings
          </p>
          <ul className="divide-y divide-border border-y border-border">
            {rest.map((e, i) => (
              <li key={i} className="py-3">
                {e.type === "rule" && (
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[12px] text-muted-foreground">
                        {e.rule_id}
                      </span>
                      <CategoryPill cat={e.category} />
                      {e.severity && <SeverityPill sev={e.severity} />}
                      <span className="text-[12px] text-muted-foreground">
                        {e.claims_affected} claim{e.claims_affected !== 1 ? "s" : ""} affected
                      </span>
                    </div>
                    <p className="text-[13px]">{e.summary}</p>
                  </div>
                )}

                {e.type === "policy" && (
                  <div className="ml-4 space-y-0.5 border-l-2 border-muted pl-3">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Authority
                    </p>
                    <p className="text-[12px] font-medium">{e.citation_string}</p>
                    <p className="text-[12px] text-muted-foreground">{e.section_title}</p>
                    <p className="text-[11px] text-muted-foreground">{e.excerpt.slice(0, 180)}…</p>
                  </div>
                )}

                {e.type === "exclusion" && (
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[12px] text-risk">EXCLUSION</span>
                      <CategoryPill cat={e.category} />
                      {e.severity && <SeverityPill sev={e.severity} />}
                    </div>
                    <p className="text-[13px]">{e.summary}</p>
                    <p className="text-[12px] text-muted-foreground">
                      {e.source} · matched on {e.matched_on}
                    </p>
                  </div>
                )}

                {e.type === "peer" && (
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[12px] text-muted-foreground">PEER</span>
                      <CategoryPill cat={e.category} />
                    </div>
                    <p className="text-[13px]">{e.summary}</p>
                    <p className="text-[12px] text-muted-foreground">
                      z-score {e.z_score.toFixed(2)} · {e.peer_group}
                    </p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
