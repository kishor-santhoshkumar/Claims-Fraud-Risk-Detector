import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { setDisposition, type CaseStatus, type QueueItem } from "./api";

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

const STATUSES_KEY = "case_statuses";

function loadStatuses(): Record<string, CaseStatus> {
  try {
    return JSON.parse(localStorage.getItem(STATUSES_KEY) ?? "{}") as Record<string, CaseStatus>;
  } catch {
    return {};
  }
}

export function CaseStoreProvider({ children }: { children: ReactNode }) {
  const [baseProviders, setBaseProviders] = useState<QueueItem[]>([]);
  const [localStatuses, setLocalStatuses] = useState<Record<string, CaseStatus>>(loadStatuses);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STATUSES_KEY, JSON.stringify(localStatuses));
    } catch {}
  }, [localStatuses]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch("/queue_data.json")
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load queue_data.json: ${r.status}`);
        return r.json() as Promise<QueueItem[]>;
      })
      .then((items) => {
        if (!cancelled) {
          setBaseProviders(items);
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

  const reset = useCallback(() => {
    setLocalStatuses({});
    try { localStorage.removeItem(STATUSES_KEY); } catch {}
  }, []);

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
