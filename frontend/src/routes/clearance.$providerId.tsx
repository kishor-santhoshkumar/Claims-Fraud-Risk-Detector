import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CaseDetail } from "@/components/CaseDetail";
import { fetchProvider, type ProviderDetail } from "@/lib/api";

export const Route = createFileRoute("/clearance/$providerId")({
  component: ClearancePage,
});

function ClearancePage() {
  const { providerId } = Route.useParams();
  const [provider, setProvider] = useState<ProviderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchProvider(providerId)
      .then(setProvider)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [providerId]);

  if (loading) {
    return <p className="px-6 py-10 text-[14px] text-muted-foreground">Loading {providerId}…</p>;
  }
  if (error) {
    return <p className="px-6 py-10 text-[14px] text-risk">Failed to load {providerId}: {error}</p>;
  }
  if (!provider) {
    return <p className="px-6 py-10 text-[14px] text-muted-foreground">No provider matches {providerId}.</p>;
  }

  return <CaseDetail provider={provider} variant="clearance" />;
}
