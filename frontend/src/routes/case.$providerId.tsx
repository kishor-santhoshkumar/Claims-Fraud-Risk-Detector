import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CaseDetail } from "@/components/CaseDetail";
import { fetchProvider, type ProviderDetail } from "@/lib/api";
import { useBatch } from "@/lib/batchContext";

export const Route = createFileRoute("/case/$providerId")({
  component: CasePage,
});

function CasePage() {
  const { providerId } = Route.useParams();
  const navigate = useNavigate();
  const { activeBatch } = useBatch();
  const [provider, setProvider] = useState<ProviderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchProvider(providerId, activeBatch)
      .then(setProvider)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [providerId, activeBatch]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") navigate({ to: "/" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  if (loading) {
    return <p className="px-6 py-10 text-[14px] text-muted-foreground">Loading {providerId}…</p>;
  }
  if (error) {
    return <p className="px-6 py-10 text-[14px] text-risk">Failed to load {providerId}: {error}</p>;
  }
  if (!provider) {
    return <p className="px-6 py-10 text-[14px] text-muted-foreground">No provider matches {providerId}.</p>;
  }
  if (provider.risk_tier === "low") {
    return (
      <div className="px-6 py-10 text-[14px]">
        <p className="text-muted-foreground">{providerId} is below the review threshold.</p>
      </div>
    );
  }

  return <CaseDetail provider={provider} variant="case" />;
}
