import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, CloudUpload, Download, FileText, Loader2 } from "lucide-react";
import { uploadBatch, fetchBatchStatus, type JobStatus } from "@/lib/api";
import { useBatch } from "@/lib/batchContext";

export const Route = createFileRoute("/upload")({
  component: UploadPage,
});

const API_BASE = (import.meta as unknown as { env: { VITE_API_URL?: string } }).env.VITE_API_URL ?? "/api";

const REQUIRED_COLS = [
  "ClaimID","BeneID","Provider","ClaimType","ClaimStartDt","ClaimEndDt",
  "InscClaimAmtReimbursed","DeductibleAmtPaid",
  "AttendingPhysician","OperatingPhysician","OtherPhysician",
  "AdmissionDt","DischargeDt",
  "ClmDiagnosisCode_1..10 (10 columns)","ClmProcedureCode_1..6 (6 columns)",
  "DOB","DOD","Gender","Race","State","County","RenalDiseaseIndicator",
  "ChronicCond_* (11 columns)",
];

const STAGE_LABELS: Record<string, string> = {
  Queued: "Queued",
  Validating: "Validating",
  "Loading file": "Loading file",
  Normalising: "Normalising data",
  "Splitting claim types": "Splitting claim types",
  "Enriching claims": "Enriching claims",
  "Computing cross-entity spans": "Computing cross-entity spans",
  "Aggregating providers": "Aggregating providers",
  "Building feature matrix": "Building features",
  "Scoring providers": "Scoring providers",
  "Computing SHAP values": "Computing SHAP",
  "Applying claim rules": "Applying claim rules",
  "Assembling evidence": "Assembling evidence",
  "Persisting batch": "Saving batch",
  Done: "Complete",
};

function progressColor(pct: number) {
  if (pct < 40) return "#3b82f6";
  if (pct < 80) return "#8b5cf6";
  return "#10b981";
}

export default function UploadPage() {
  const navigate = useNavigate();
  const { setActiveBatch, refreshBatches } = useBatch();

  const [dragging, setDragging]       = useState(false);
  const [file, setFile]               = useState<File | null>(null);
  const [batchName, setBatchName]     = useState("");
  const [uploading, setUploading]     = useState(false);
  const [jobStatus, setJobStatus]     = useState<JobStatus | null>(null);
  const [batchId, setBatchId]         = useState<string | null>(null);
  const [result, setResult]           = useState<{ provider_count: number; row_count: number; date_range: { start: string; end: string }; flagged: number; dollars_at_risk: number } | null>(null);
  const [error, setError]             = useState<string | null>(null);
  const [colsOpen, setColsOpen]       = useState(false);
  const pollRef                       = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef                  = useRef<HTMLInputElement>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const startPolling = useCallback((bid: string) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const status = await fetchBatchStatus(bid);
        setJobStatus(status);
        if (status.state === "ready") {
          stopPolling();
          setUploading(false);
          refreshBatches();
          // Fetch batch meta for summary card
          const meta = await fetch(`${API_BASE}/batches/${bid}`).then(r => r.json());
          setResult({
            provider_count: meta.provider_count,
            row_count: meta.row_count,
            date_range: meta.date_range,
            flagged: 0,
            dollars_at_risk: 0,
          });
        } else if (status.state === "failed") {
          stopPolling();
          setUploading(false);
          setError(status.message);
        }
      } catch { /* network hiccup — keep polling */ }
    }, 1500);
  }, [stopPolling, refreshBatches]);

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files?.length) return;
    const f = files[0];
    setFile(f);
    if (!batchName) setBatchName(f.name.replace(/\.[^.]+$/, "").replace(/[_-]/g, " "));
    setError(null);
    setJobStatus(null);
    setResult(null);
  }, [batchName]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const handleSubmit = useCallback(async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    setResult(null);
    setJobStatus(null);
    try {
      const resp = await uploadBatch(file, batchName || file.name);
      setBatchId(resp.batch_id);
      setJobStatus({ job_id: resp.job_id, batch_id: resp.batch_id, state: "processing", progress: 0, message: "Queued" });
      startPolling(resp.batch_id);
    } catch (e: unknown) {
      setUploading(false);
      setError((e as Error).message ?? "Upload failed");
    }
  }, [file, batchName, startPolling]);

  const handleViewQueue = useCallback(() => {
    if (batchId) {
      setActiveBatch(batchId);
      navigate({ to: "/queue" });
    }
  }, [batchId, setActiveBatch, navigate]);

  const stage = jobStatus?.message ?? "";
  const pct   = jobStatus?.progress ?? 0;
  const stageLabel = STAGE_LABELS[stage] ?? stage;

  return (
    <div style={{ padding: "28px 32px 64px", maxWidth: 760, margin: "0 auto" }}>
      {/* Header */}
      <header style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--text-primary)", margin: 0, letterSpacing: "-0.02em" }}>
          Upload Claims Batch
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-faint)", margin: "5px 0 0" }}>
          Upload a flat CSV of claims and score it against the trained model. Baseline providers remain unaffected.
        </p>
      </header>

      {/* Drop zone */}
      {!result && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${dragging ? "#6366f1" : file ? "#10b981" : "rgba(100,116,139,0.3)"}`,
            borderRadius: 16,
            padding: "40px 24px",
            textAlign: "center",
            cursor: "pointer",
            background: dragging ? "rgba(99,102,241,0.04)" : file ? "rgba(16,185,129,0.04)" : "rgba(255,255,255,0.5)",
            transition: "border-color 0.2s, background 0.2s",
            marginBottom: 20,
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            style={{ display: "none" }}
            onChange={(e) => handleFiles(e.target.files)}
          />
          {file ? (
            <>
              <FileText size={36} color="#10b981" style={{ margin: "0 auto 12px" }} />
              <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>{file.name}</p>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-faint)" }}>
                {(file.size / 1_048_576).toFixed(1)} MB · Click to change
              </p>
            </>
          ) : (
            <>
              <CloudUpload size={40} color="#6366f1" style={{ margin: "0 auto 12px", opacity: 0.7 }} />
              <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>
                Drag & drop a CSV file here
              </p>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-faint)" }}>
                or click to browse · max 50 MB · 200,000 rows
              </p>
            </>
          )}
        </div>
      )}

      {/* Batch name + download sample */}
      {!result && (
        <div style={{ display: "flex", gap: 12, marginBottom: 16, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 5 }}>
              Batch name
            </label>
            <input
              value={batchName}
              onChange={(e) => setBatchName(e.target.value)}
              placeholder="e.g. January 2024 Claims"
              style={{
                width: "100%", height: 38, borderRadius: 9, border: "1px solid rgba(100,116,139,0.25)",
                padding: "0 12px", fontSize: 13, fontFamily: "inherit",
                background: "rgba(255,255,255,0.7)", color: "var(--text-primary)",
                boxSizing: "border-box",
              }}
            />
          </div>
          <a
            href={`${API_BASE}/sample-month-csv`}
            download="sample_month.csv"
            style={{
              height: 38, padding: "0 14px", borderRadius: 9,
              border: "1px solid rgba(99,102,241,0.25)", background: "rgba(99,102,241,0.07)",
              color: "#4f46e5", fontSize: 12.5, fontWeight: 600,
              textDecoration: "none", display: "flex", alignItems: "center", gap: 6,
              whiteSpace: "nowrap",
            }}
          >
            <Download size={13} />
            Sample CSV
          </a>
        </div>
      )}

      {/* Required columns (collapsible) */}
      {!result && (
        <div style={{ marginBottom: 20, background: "rgba(255,255,255,0.5)", border: "1px solid rgba(100,116,139,0.15)", borderRadius: 12, overflow: "hidden" }}>
          <button
            onClick={() => setColsOpen((o) => !o)}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}
          >
            <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-muted)" }}>Required columns</span>
            {colsOpen ? <ChevronUp size={14} color="var(--text-faint)" /> : <ChevronDown size={14} color="var(--text-faint)" />}
          </button>
          {colsOpen && (
            <div style={{ padding: "0 14px 12px", display: "flex", flexWrap: "wrap", gap: 5 }}>
              {REQUIRED_COLS.map((c) => (
                <span key={c} style={{ fontSize: 10.5, fontFamily: "ui-monospace,monospace", background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.15)", borderRadius: 5, padding: "2px 7px", color: "#4f46e5" }}>
                  {c}
                </span>
              ))}
              <p style={{ width: "100%", margin: "8px 0 0", fontSize: 11, color: "var(--text-faint)" }}>
                ChronicCond_* values: 1=Yes, 2=No · RenalDiseaseIndicator: 0 or Y · Dates: YYYY-MM-DD · ClaimType: inpatient / outpatient
              </p>
            </div>
          )}
        </div>
      )}

      {/* Upload button */}
      {!result && (
        <button
          onClick={handleSubmit}
          disabled={!file || uploading}
          style={{
            width: "100%", height: 44, borderRadius: 12,
            background: (!file || uploading) ? "rgba(100,116,139,0.15)" : "linear-gradient(135deg, #4f46e5, #3b82f6)",
            border: "none", color: (!file || uploading) ? "var(--text-faint)" : "#fff",
            fontSize: 14, fontWeight: 600, fontFamily: "inherit", cursor: (!file || uploading) ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            transition: "opacity 0.15s",
          }}
        >
          {uploading ? <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Processing…</> : "Upload & Score"}
        </button>
      )}

      {/* Progress bar */}
      {uploading && jobStatus && (
        <div style={{ marginTop: 24, background: "rgba(255,255,255,0.7)", border: "1px solid rgba(100,116,139,0.15)", borderRadius: 14, padding: "18px 20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{stageLabel}</p>
            <span style={{ fontSize: 12, fontFamily: "ui-monospace,monospace", color: "var(--text-muted)" }}>{pct}%</span>
          </div>
          <div style={{ height: 7, borderRadius: 999, background: "rgba(100,116,139,0.15)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, borderRadius: 999, background: progressColor(pct), transition: "width 0.4s ease, background 0.4s" }} />
          </div>
          <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--text-faint)" }}>
            This may take 10–60 seconds for large files.
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ marginTop: 20, background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 14, padding: "16px 18px", display: "flex", gap: 12, alignItems: "flex-start" }}>
          <AlertCircle size={18} color="#dc2626" style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <p style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 600, color: "#dc2626" }}>Upload failed</p>
            <pre style={{ margin: 0, fontSize: 12, color: "#991b1b", whiteSpace: "pre-wrap", fontFamily: "ui-monospace,monospace" }}>{error}</pre>
            <button
              onClick={() => { setError(null); setFile(null); setUploading(false); }}
              style={{ marginTop: 10, fontSize: 12, color: "#dc2626", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0, textDecoration: "underline" }}
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {/* Success card */}
      {result && (
        <div style={{ background: "linear-gradient(160deg, rgba(255,255,255,0.9) 0%, rgba(220,252,231,0.6) 100%)", border: "1px solid rgba(16,185,129,0.25)", borderRadius: 18, padding: "24px 26px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
            <CheckCircle2 size={28} color="#10b981" />
            <div>
              <p style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "var(--text-primary)" }}>Batch scored successfully</p>
              <p style={{ margin: 0, fontSize: 12, color: "var(--text-faint)" }}>{batchName}</p>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
            {[
              { label: "Providers scored", value: result.provider_count.toLocaleString() },
              { label: "Claims processed", value: result.row_count.toLocaleString() },
              { label: "Date range", value: `${result.date_range.start?.slice(0,7) ?? "—"} – ${result.date_range.end?.slice(0,7) ?? "—"}` },
            ].map((s) => (
              <div key={s.label} style={{ background: "rgba(255,255,255,0.7)", borderRadius: 10, padding: "10px 14px", border: "1px solid rgba(16,185,129,0.15)" }}>
                <p style={{ margin: "0 0 2px", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-faint)" }}>{s.label}</p>
                <p style={{ margin: 0, fontSize: 18, fontWeight: 700, fontFamily: "ui-monospace,monospace", color: "var(--text-primary)" }}>{s.value}</p>
              </div>
            ))}
          </div>
          <p style={{ margin: "0 0 14px", fontSize: 12, color: "var(--text-faint)" }}>
            Note: percentiles in evidence summaries reference the 5,410-provider baseline population, not this batch.
            Cross-entity features (beneficiary/physician spans) are computed within this batch only.
          </p>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={handleViewQueue}
              style={{ flex: 1, height: 40, borderRadius: 10, background: "linear-gradient(135deg, #4f46e5, #3b82f6)", border: "none", color: "#fff", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}
            >
              View Queue →
            </button>
            <button
              onClick={() => { setResult(null); setFile(null); setJobStatus(null); setBatchId(null); setBatchName(""); setError(null); setUploading(false); }}
              style={{ height: 40, padding: "0 16px", borderRadius: 10, border: "1px solid rgba(100,116,139,0.25)", background: "rgba(255,255,255,0.7)", color: "var(--text-muted)", fontSize: 13, fontWeight: 500, fontFamily: "inherit", cursor: "pointer" }}
            >
              Upload another
            </button>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
