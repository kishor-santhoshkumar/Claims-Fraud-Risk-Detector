/**
 * Typed fetch functions for the Claims Fraud Risk Detector backend.
 *
 * Local dev: requests go through /api, which Vite proxies to http://localhost:8001.
 * Production: set VITE_API_URL at build time to the backend's public URL + /api.
 *
 * USE_MOCK = true → every function returns mock data (demo safety switch).
 * Flip this to false to hit the real backend.
 */
import {
  providers as mockProviders,
  claimsForProvider as mockClaims,
} from "./mockData";

const USE_MOCK = false;

// VITE_API_URL is baked in at build time.
// Local dev: undefined → "/api" (Vite proxy rewrites to http://localhost:8001).
// Railway two-service: set to "https://your-backend.up.railway.app/api".
const API_BASE = import.meta.env.VITE_API_URL ?? "/api";

// ── Types matching src/schema.py exactly ────────────────────────────────────

export type RiskTier = "low" | "medium" | "high";
export type CaseStatus = "unreviewed" | "confirmed" | "cleared" | "needs_info";
export type Severity = "low" | "medium" | "high";

export interface ShapEvidence {
  type: "shap";
  category: "statistical";
  severity: null;
  summary: string;
  feature: string;
  value: number;
  impact: number;
  direction: "increases_risk" | "decreases_risk";
}

export interface RuleEvidence {
  type: "rule";
  category: "fraud" | "waste" | "abuse" | "compliance";
  severity: Severity;
  summary: string;
  rule_id: string;
  citation: string;
  claims_affected: number;
  relates_to: string | null;
}

export interface PolicyEvidence {
  type: "policy";
  category: "fraud" | "waste" | "abuse" | "compliance";
  severity: null;
  summary: string;
  citation_string: string;
  section_title: string;
  source_doc: string;
  excerpt: string;
  relates_to: string;
}

export interface ExclusionEvidence {
  type: "exclusion";
  category: "fraud" | "waste" | "abuse" | "compliance";
  severity: Severity;
  summary: string;
  source: string;
  excl_type: string;
  excl_date: string | null;
  matched_on: string;
  tier: string;
}

export interface PeerEvidence {
  type: "peer";
  category: "fraud" | "waste" | "abuse" | "compliance";
  severity: Severity;
  summary: string;
  metric: string;
  provider_value: number;
  peer_median: number;
  z_score: number;
  peer_group: string;
}

export type Evidence =
  | ShapEvidence
  | RuleEvidence
  | PolicyEvidence
  | ExclusionEvidence
  | PeerEvidence;

export interface QueueItem {
  provider_id: string;
  score: number;
  risk_tier: RiskTier;
  total_reimbursed: number;
  expected_loss: number;
  n_claims: number;
  status: CaseStatus;
  n_unique_bene?: number;
  state?: string;
}

export interface ProviderDetail {
  provider_id: string;
  score: number;
  risk_tier: RiskTier;
  total_reimbursed: number;
  expected_loss: number;
  n_claims: number;
  evidence: Evidence[];
  clearance_summary: string | null;
  status: CaseStatus;
  n_unique_bene?: number;
  state?: string;
}

export interface Claim {
  claim_id: string;
  bene_id: string;
  claim_start_dt: string;
  claim_end_dt: string;
  claim_type: "inpatient" | "outpatient";
  amount_reimbursed: number;
  deductible_paid: number;
  attending_physician: string | null;
  diagnosis_codes: string[];
  procedure_codes: string[];
  admission_dt: string | null;
  discharge_dt: string | null;
  rule_flag: string | null;
  rule_flags: string[];
  claim_risk_score: number | null;
  claim_risk_tier: "high" | "medium" | "low" | null;
  within_z: number | null;
  cross_z: number | null;
}

export interface ClaimsResponse {
  provider_id: string;
  total_claims: number;
  page: number;
  per_page: number;
  claims: Claim[];
}

export interface StatsResponse {
  total_providers: number;
  tier_distribution: { high: number; medium: number; low: number };
  total_expected_loss: number;
  total_reimbursed: number;
  providers_flagged: number;
  by_state: { state: string; providers: number }[];
}

export interface DispositionResponse {
  provider_id: string;
  status: CaseStatus;
  note: string;
}

export interface NarrativeResponse {
  narrative: string;
  evidence: Evidence[];
  cached: boolean;
}

// ── Fetch helper ─────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }));
    const err = new Error(detail.detail ?? res.statusText) as Error & {
      status: number;
    };
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

// ── API functions ─────────────────────────────────────────────────────────────

export async function fetchQueue(limit = 100): Promise<QueueItem[]> {
  if (USE_MOCK) {
    return mockProviders.slice(0, limit).map((p) => ({
      provider_id: p.provider_id,
      score: p.score,
      risk_tier: p.risk_tier,
      total_reimbursed: p.total_reimbursed,
      expected_loss: p.expected_loss,
      n_claims: p.n_claims,
      status: p.status,
      n_unique_bene: p.n_unique_bene,
      state: p.state,
    }));
  }
  return apiFetch<QueueItem[]>(`/queue?limit=${limit}`);
}

export async function fetchProvider(id: string): Promise<ProviderDetail> {
  if (USE_MOCK) {
    const p = mockProviders.find((x) => x.provider_id === id);
    if (!p) throw Object.assign(new Error("Not found"), { status: 404 });
    return {
      provider_id: p.provider_id,
      score: p.score,
      risk_tier: p.risk_tier,
      total_reimbursed: p.total_reimbursed,
      expected_loss: p.expected_loss,
      n_claims: p.n_claims,
      evidence: p.evidence as unknown as Evidence[],
      clearance_summary: null,
      status: p.status,
      n_unique_bene: p.n_unique_bene,
      state: p.state,
    };
  }
  return apiFetch<ProviderDetail>(`/provider/${id}`);
}

export async function fetchClaims(
  id: string,
  page = 1,
  perPage = 50,
): Promise<ClaimsResponse> {
  if (USE_MOCK) {
    const claims = mockClaims(id);
    return {
      provider_id: id,
      total_claims: claims.length,
      page,
      per_page: perPage,
      claims: claims.slice((page - 1) * perPage, page * perPage) as Claim[],
    };
  }
  return apiFetch<ClaimsResponse>(
    `/provider/${id}/claims?page=${page}&per_page=${perPage}`,
  );
}

export async function fetchStats(): Promise<StatsResponse> {
  if (USE_MOCK) {
    return {
      total_providers: mockProviders.length,
      tier_distribution: {
        high: mockProviders.filter((p) => p.risk_tier === "high").length,
        medium: mockProviders.filter((p) => p.risk_tier === "medium").length,
        low: mockProviders.filter((p) => p.risk_tier === "low").length,
      },
      total_expected_loss: mockProviders.reduce(
        (s, p) => s + p.expected_loss,
        0,
      ),
      total_reimbursed: mockProviders.reduce(
        (s, p) => s + p.total_reimbursed,
        0,
      ),
      providers_flagged: mockProviders.filter((p) => p.risk_tier !== "low")
        .length,
      by_state: [],
    };
  }
  return apiFetch<StatsResponse>("/stats");
}

export async function setDisposition(
  id: string,
  disposition: "confirmed" | "cleared" | "needs_info",
  note = "",
): Promise<DispositionResponse> {
  if (USE_MOCK) {
    return { provider_id: id, status: disposition, note };
  }
  return apiFetch<DispositionResponse>(`/provider/${id}/disposition`, {
    method: "POST",
    body: JSON.stringify({ disposition, note }),
  });
}

/** POST /provider/{id}/explain — returns narrative + enriched evidence with policy citations. */
export async function fetchExplanation(
  id: string,
): Promise<NarrativeResponse | null> {
  if (USE_MOCK) return null;
  try {
    return await apiFetch<NarrativeResponse>(`/provider/${id}/explain`, {
      method: "POST",
    });
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status === 400 || status === 503 || status === 501) return null;
    throw err;
  }
}

/** POST /provider/{id}/why-not — on-demand clearance narrative for low/medium tier. */
export async function fetchClearance(
  id: string,
): Promise<NarrativeResponse | null> {
  if (USE_MOCK) return null;
  try {
    return await apiFetch<NarrativeResponse>(`/provider/${id}/why-not`, {
      method: "POST",
    });
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status === 400 || status === 503 || status === 501) return null;
    throw err;
  }
}

export interface FingerprintTier {
  bene_shared: number | null;
  mean_claim: number | null;
  unique_diag: number | null;
  avg_length: number | null;
  deductible: number | null;
  inpatient_share: number | null;
}

export interface FingerprintResponse {
  high: FingerprintTier;
  medium: FingerprintTier;
  low: FingerprintTier;
}

export async function fetchFingerprint(): Promise<FingerprintResponse> {
  return apiFetch<FingerprintResponse>("/fingerprint");
}

export interface ChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

// ── Simulation replay types ───────────────────────────────────────────────────

export interface ClaimSample {
  claim_id: string;
  bene_id: string;
  provider_id: string;
  amount: number;
  claim_start_dt: string;
  claim_type: "inpatient" | "outpatient";
  rule_flags: string[];
}

export interface ProviderCrossing {
  provider_id: string;
  score: number;
  tier: RiskTier;
  expected_loss: number;
  trigger: string;
}

export interface BatchCumulative {
  claims_processed: number;
  money_at_risk: number;
  queue_high: number;
  queue_medium: number;
  queue_low: number;
  investigator_hours: number;
}

export interface ReplayBatch {
  tick: number;
  label: string;
  date_range: string;
  claims_processed: number;
  claims_sample: ClaimSample[];
  rules_fired: Record<string, number>;
  flags_by_category: { fraud: number; waste: number; abuse: number };
  providers_crossing_threshold: ProviderCrossing[];
  cumulative: BatchCumulative;
}

export interface ReplayFinalSummary {
  total_claims: number;
  total_flagged: number;
  money_at_risk: number;
  fraud_caught: number;
  fraud_missed: number;
  false_positives: number;
  share_of_fraud_caught: number;
  investigator_hours: number;
  top_providers: { provider_id: string; score: number; expected_loss: number; risk_tier: string }[];
  narrative: string;
}

export interface ReplayResponse {
  batches: ReplayBatch[];
  final_summary: ReplayFinalSummary;
}

export async function fetchSimulationReplay(capacity: number): Promise<ReplayResponse> {
  return apiFetch<ReplayResponse>(`/simulation/replay?capacity=${capacity}`);
}

export interface ClaimSearchResult {
  claim_id: string;
  provider_id: string;
  claim_risk_tier: "high" | "medium" | "low";
  amount_reimbursed: number;
  rule_flags: string[];
}

export async function fetchClaimSearch(q: string): Promise<ClaimSearchResult[]> {
  if (!q || q.length < 2) return [];
  try {
    return await apiFetch<ClaimSearchResult[]>(`/claims/search?q=${encodeURIComponent(q)}&limit=8`);
  } catch {
    return [];
  }
}

/** POST /chat — general assistant with optional provider evidence context and conversation history. */
export async function chatWithAssistant(
  message: string,
  providerIds: string[] = [],
  history: ChatHistoryMessage[] = [],
  claimIds: string[] = [],
): Promise<string> {
  const data = await apiFetch<{ reply: string }>("/chat", {
    method: "POST",
    body: JSON.stringify({ message, provider_ids: providerIds, history, claim_ids: claimIds }),
  });
  return data.reply;
}
