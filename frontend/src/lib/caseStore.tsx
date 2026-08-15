import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { fetchQueue, setDisposition, type CaseStatus, type QueueItem } from "./api";

export type { CaseStatus };

export interface CaseProvider extends QueueItem {
  // status is already in QueueItem; re-exported for consumers
}

interface CaseStoreValue {
  providers: CaseProvider[];
  loading: boolean;
  error: string | null;
  counts: {
    total: number;
    reviewed: number;
    confirmed: number;
    cleared: number;
    needsInfo: number;
    atRisk: number;
  };
  setStatus: (providerId: string, status: CaseStatus) => void;
  reset: () => void;
}

const CaseStoreContext = createContext<CaseStoreValue | null>(null);

export function CaseStoreProvider({ children }: { children: ReactNode }) {
  const [baseProviders, setBaseProviders] = useState<QueueItem[]>([]);
  const [localStatuses, setLocalStatuses] = useState<Record<string, CaseStatus>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchQueue(500)
      .then((items) => {
        if (!cancelled) {
          setBaseProviders(items);
          // Seed local status overrides from API response
          const initial: Record<string, CaseStatus> = {};
          items.forEach((p) => {
            if (p.status !== "unreviewed") initial[p.provider_id] = p.status;
          });
          setLocalStatuses(initial);
          setLoading(false);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const providers: CaseProvider[] = useMemo(
    () =>
      baseProviders.map((p) => ({
        ...p,
        status: localStatuses[p.provider_id] ?? p.status,
      })),
    [baseProviders, localStatuses],
  );

  const setStatus = useCallback((providerId: string, status: CaseStatus) => {
    setLocalStatuses((prev) => {
      const next = { ...prev };
      if (status === "unreviewed") delete next[providerId];
      else next[providerId] = status;
      return next;
    });
    // Fire-and-forget — persist to backend
    if (status !== "unreviewed") {
      setDisposition(providerId, status).catch(console.error);
    }
  }, []);

  const reset = useCallback(() => setLocalStatuses({}), []);

  const counts = useMemo(() => {
    const confirmed = providers.filter((p) => p.status === "confirmed").length;
    const cleared = providers.filter((p) => p.status === "cleared").length;
    const needsInfo = providers.filter((p) => p.status === "needs_info").length;
    return {
      total: providers.length,
      reviewed: confirmed + cleared + needsInfo,
      confirmed,
      cleared,
      needsInfo,
      atRisk: providers.reduce(
        (s, p) => s + (p.status === "unreviewed" ? p.expected_loss : 0),
        0,
      ),
    };
  }, [providers]);

  const value = useMemo(
    () => ({ providers, loading, error, counts, setStatus, reset }),
    [providers, loading, error, counts, setStatus, reset],
  );

  return (
    <CaseStoreContext.Provider value={value}>{children}</CaseStoreContext.Provider>
  );
}

export function useCaseStore() {
  const ctx = useContext(CaseStoreContext);
  if (!ctx) throw new Error("useCaseStore must be used inside CaseStoreProvider");
  return ctx;
}
