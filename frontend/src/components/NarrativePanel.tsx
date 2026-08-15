import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchExplanation, fetchClearance, type ShapEvidence, type Evidence } from "@/lib/api";

export function NarrativePanel({
  providerId,
  evidence,
  variant,
  open,
  onOpenChange,
}: {
  providerId: string;
  evidence: Evidence[];
  variant: "case" | "clearance";
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [paragraphs, setParagraphs] = useState<string[] | null>(null);

  const shap = evidence.filter((e): e is ShapEvidence => e.type === "shap");
  const used = [...shap].sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact)).slice(0, 3);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setParagraphs(null);
    const req =
      variant === "case"
        ? fetchExplanation(providerId)
        : fetchClearance(providerId).then((s) => (s ? [s] : null));
    req
      .then((result) => setParagraphs(result))
      .catch(() => setParagraphs(null))
      .finally(() => setLoading(false));
  }, [open, providerId, variant]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[480px]">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle className="text-[15px] font-medium">
            {variant === "case" ? "Explanation" : "Why not flagged?"}
          </SheetTitle>
          <p className="text-[12px] text-muted-foreground">{providerId}</p>
        </SheetHeader>

        <div className="px-6 py-5">
          {loading ? (
            <div className="space-y-3">
              <p className="text-[12px] text-muted-foreground">Writing explanation…</p>
              {[...Array(7)].map((_, i) => (
                <Skeleton key={i} className="h-3.5 w-full last:w-2/3" />
              ))}
            </div>
          ) : paragraphs === null ? (
            <p className="text-[13px] text-muted-foreground">
              Narrative explanation not available yet. The model evidence is shown in the Evidence section.
            </p>
          ) : (
            <div className="space-y-4 text-[15px] leading-relaxed text-foreground">
              {paragraphs.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          )}
        </div>

        {!loading && paragraphs !== null && (
          <>
            {used.length > 0 && (
              <div className="border-t border-border px-6 py-5">
                <h3 className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
                  Based on this evidence
                </h3>
                <ul className="mt-3 space-y-3">
                  {used.map((e) => (
                    <li key={e.feature} className="text-[13px]">
                      <div className="flex items-baseline justify-between gap-3">
                        <span>{e.summary}</span>
                        <span
                          className={
                            e.direction === "increases_risk"
                              ? "font-mono text-[12px] text-risk"
                              : "font-mono text-[12px] text-cleared"
                          }
                        >
                          {e.impact > 0 ? "+" : ""}
                          {e.impact.toFixed(2)}
                        </span>
                      </div>
                      <p className="text-[12px] text-muted-foreground">{e.feature}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex items-center justify-between gap-4 border-t border-border px-6 py-4">
              <p className="text-[11px] leading-snug text-muted-foreground">
                Generated from structured evidence only. The model produced the score; this text describes it.
              </p>
              <button
                onClick={() => {
                  void navigator.clipboard?.writeText(paragraphs.join("\n\n"));
                  toast("Explanation copied");
                }}
                className="inline-flex shrink-0 items-center gap-1.5 border border-border px-2.5 py-1.5 text-[12px] hover:bg-muted"
              >
                <Copy className="size-3.5" strokeWidth={1.75} />
                Copy
              </button>
            </div>
          </>
        )}

        {!loading && paragraphs === null && (
          <div className="border-t border-border px-6 py-4">
            <p className="text-[11px] leading-snug text-muted-foreground">
              The evidence panel on the case file shows all model drivers.
            </p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
