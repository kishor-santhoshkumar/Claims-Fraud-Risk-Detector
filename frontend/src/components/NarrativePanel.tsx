import { useEffect, useState } from "react";
import { Copy, ChevronDown, ChevronUp, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fetchExplanation,
  fetchClearance,
  type NarrativeResponse,
  type PolicyEvidence,
  type Evidence,
} from "@/lib/api";

// ── Policy citation card ──────────────────────────────────────────────────────

function CitationCard({ citation }: { citation: PolicyEvidence }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-border/60 bg-muted/30 p-3 text-[12px]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <BookOpen className="size-3 shrink-0" strokeWidth={1.75} />
            <span className="font-mono text-[11px]">{citation.citation_string}</span>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground/70">{citation.source_doc}</p>
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={expanded ? "Collapse excerpt" : "Show excerpt"}
        >
          {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
      </div>

      {expanded && (
        <p className="mt-2 border-t border-border/40 pt-2 leading-relaxed text-muted-foreground">
          {citation.excerpt}
        </p>
      )}

      <p className="mt-1.5 text-[10px] text-muted-foreground/60">
        Supports: <span className="font-mono">{citation.relates_to}</span>
      </p>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function NarrativePanel({
  providerId,
  evidence,
  variant,
  open,
  onOpenChange,
  batch = "baseline",
}: {
  providerId: string;
  evidence: Evidence[];
  variant: "case" | "clearance";
  open: boolean;
  onOpenChange: (v: boolean) => void;
  batch?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<NarrativeResponse | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setResult(null);
    const req = variant === "case" ? fetchExplanation(providerId, batch) : fetchClearance(providerId, batch);
    req
      .then((r) => setResult(r))
      .catch(() => setResult(null))
      .finally(() => setLoading(false));
  }, [open, providerId, variant, batch]);

  // Split narrative into paragraphs on blank lines
  const paragraphs = result?.narrative
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean) ?? [];

  // Policy citations from the enriched evidence returned by the backend
  const citations = (result?.evidence ?? []).filter(
    (e): e is PolicyEvidence => e.type === "policy",
  );

  const narrativeText = paragraphs.join("\n\n");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[520px]"
      >
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle className="text-[15px] font-medium">
            {variant === "case" ? "Why this case was flagged" : "Why this provider was not flagged"}
          </SheetTitle>
          <p className="text-[12px] text-muted-foreground">{providerId}</p>
        </SheetHeader>

        {/* ── Loading skeleton ── */}
        {loading && (
          <div className="px-6 py-5 space-y-3">
            <p className="text-[12px] text-muted-foreground">Generating explanation…</p>
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-3.5 w-full last:w-3/4" />
            ))}
          </div>
        )}

        {/* ── Unavailable ── */}
        {!loading && result === null && (
          <div className="px-6 py-5">
            <p className="text-[13px] text-muted-foreground">
              Explanation not available right now. The evidence panel shows all model findings.
            </p>
          </div>
        )}

        {/* ── Narrative text ── */}
        {!loading && result !== null && (
          <>
            <div className="px-6 py-5 space-y-4">
              {paragraphs.map((p, i) => (
                <p key={i} className="text-[14px] leading-relaxed text-foreground">
                  {p}
                </p>
              ))}
              {result.cached && (
                <p className="text-[11px] text-muted-foreground/60">Served from cache</p>
              )}
            </div>

            {/* ── Policy citations ── */}
            {citations.length > 0 && (
              <div className="border-t border-border px-6 py-4">
                <h3 className="mb-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Policy grounding · {citations.length} citation{citations.length !== 1 ? "s" : ""}
                </h3>
                <div className="space-y-2">
                  {citations.map((c) => (
                    <CitationCard key={`${c.relates_to}-${c.citation_string}`} citation={c} />
                  ))}
                </div>
              </div>
            )}

            {/* ── Footer ── */}
            <div className="flex items-center justify-between gap-4 border-t border-border px-6 py-4">
              <p className="text-[11px] leading-snug text-muted-foreground">
                Generated from structured evidence only. Citations trace back to CMS policy documents.
              </p>
              <button
                onClick={() => {
                  void navigator.clipboard?.writeText(narrativeText);
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

        {!loading && result === null && (
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
