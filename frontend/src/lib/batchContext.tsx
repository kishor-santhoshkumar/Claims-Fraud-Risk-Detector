import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export interface BatchMeta {
  batch_id: string;
  batch_name: string;
  uploaded_at: string;
  row_count: number;
  provider_count: number;
  date_range: { start: string; end: string };
  has_labels: boolean;
}

interface BatchContextValue {
  activeBatch: string;
  setActiveBatch: (id: string) => void;
  batches: BatchMeta[];
  activeBatchMeta: BatchMeta | null;
  refreshBatches: () => void;
}

const BatchContext = createContext<BatchContextValue | null>(null);

const API_BASE = (import.meta as unknown as { env: { VITE_API_URL?: string } }).env.VITE_API_URL ?? "/api";

export function BatchProvider({ children }: { children: ReactNode }) {
  const [activeBatch, setActiveBatchState] = useState<string>("baseline");
  const [batches, setBatches] = useState<BatchMeta[]>([]);

  const fetchBatches = useCallback(() => {
    fetch(`${API_BASE}/batches`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: BatchMeta[]) => setBatches(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchBatches();
    const id = setInterval(fetchBatches, 30_000);
    return () => clearInterval(id);
  }, [fetchBatches]);

  const setActiveBatch = useCallback((id: string) => {
    setActiveBatchState(id);
  }, []);

  const activeBatchMeta = useMemo(
    () => batches.find((b) => b.batch_id === activeBatch) ?? null,
    [batches, activeBatch],
  );

  const value = useMemo(
    () => ({ activeBatch, setActiveBatch, batches, activeBatchMeta, refreshBatches: fetchBatches }),
    [activeBatch, setActiveBatch, batches, activeBatchMeta, fetchBatches],
  );

  return <BatchContext.Provider value={value}>{children}</BatchContext.Provider>;
}

export function useBatch() {
  const ctx = useContext(BatchContext);
  if (!ctx) throw new Error("useBatch must be used inside BatchProvider");
  return ctx;
}
