export type RiskTier = "high" | "medium" | "low";
export type CaseStatus = "unreviewed" | "confirmed" | "cleared" | "needs_info";

export interface Evidence {
  type: "shap";
  feature: string;
  label: string;
  detail: string;
  impact: number;
  direction: "increases_risk" | "decreases_risk";
}

export interface Provider {
  provider_id: string;
  score: number;
  risk_tier: RiskTier;
  total_reimbursed: number;
  expected_loss: number;
  n_claims: number;
  n_unique_bene: number;
  state: string;
  status: CaseStatus;
  evidence: Evidence[];
  narrative: string | null;
}

export interface Claim {
  claim_id: string;
  bene_id: string;
  claim_start_dt: string;
  claim_end_dt: string;
  claim_type: "inpatient" | "outpatient";
  amount_reimbursed: number;
  deductible_paid: number;
  attending_physician: string;
  diagnosis_codes: string[];
  procedure_codes: string[];
  admission_dt: string | null;
  discharge_dt: string | null;
  rule_flag: string | null;
}

// Deterministic pseudo-random generator so the mock set is stable.
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const STATES = [
  "OH", "CA", "TX", "FL", "NY", "PA", "IL", "MI", "GA", "NC",
  "NJ", "AZ", "TN", "IN", "MO", "WI", "LA", "AL", "KY", "OR",
];

const STATE_NAMES: Record<string, string> = {
  OH: "Ohio", CA: "California", TX: "Texas", FL: "Florida", NY: "New York",
  PA: "Pennsylvania", IL: "Illinois", MI: "Michigan", GA: "Georgia", NC: "North Carolina",
  NJ: "New Jersey", AZ: "Arizona", TN: "Tennessee", IN: "Indiana", MO: "Missouri",
  WI: "Wisconsin", LA: "Louisiana", AL: "Alabama", KY: "Kentucky", OR: "Oregon",
};

export function stateName(code: string) {
  return STATE_NAMES[code] ?? code;
}

const FEATURES: { feature: string; label: (v: string) => string; detail: string }[] = [
  {
    feature: "total_reimbursed",
    label: (v) => `Total reimbursement ${v}`,
    detail: "98th percentile, median $186,000",
  },
  {
    feature: "claims_per_beneficiary",
    label: () => "Claims per beneficiary 2.8",
    detail: "Peer group averages 1.3 claims per beneficiary",
  },
  {
    feature: "mean_claim_amount",
    label: () => "Mean claim amount $1,226",
    detail: "Peer median $410 for the same specialty",
  },
  {
    feature: "inpatient_share",
    label: () => "Inpatient share 71%",
    detail: "Specialty norm is 22% inpatient",
  },
  {
    feature: "duplicate_claim_rate",
    label: () => "Duplicate claim rate 6.1%",
    detail: "Same beneficiary, same code, same day",
  },
  {
    feature: "weekend_service_rate",
    label: () => "Weekend service rate 34%",
    detail: "Peer group 6%",
  },
  {
    feature: "unique_diagnosis_codes",
    label: () => "Unique diagnosis codes 12",
    detail: "Narrow coding range across 1,400 claims",
  },
  {
    feature: "physician_concentration",
    label: () => "Top physician signs 88% of claims",
    detail: "Peer median 41%",
  },
  {
    feature: "beneficiary_shared_with_peers",
    label: () => "Beneficiary overlap with 9 other providers",
    detail: "Overlap above the 95th percentile",
  },
  {
    feature: "avg_length_of_stay",
    label: () => "Average length of stay 11.4 days",
    detail: "DRG-adjusted expectation 4.2 days",
  },
  {
    feature: "deductible_ratio",
    label: () => "Deductible collection ratio 0.02",
    detail: "Peer median 0.14, waived deductibles are a fraud marker",
  },
  {
    feature: "claim_growth_rate",
    label: () => "Claim volume growth 240% year over year",
    detail: "Peer median growth 8%",
  },
];

const PHYSICIANS = [
  "PHY330143", "PHY412898", "PHY198054", "PHY277910", "PHY501223",
  "PHY688431", "PHY104772", "PHY925610", "PHY773002", "PHY350918",
];

const DIAG = ["E1165", "I10", "N183", "J449", "M5416", "R079", "Z9861", "I5032", "K219", "F0390"];
const PROC = ["9904", "3893", "8856", "4513", "0066", "3722", "8154", "9390"];

function money(rng: () => number, min: number, max: number) {
  return Math.round((min + rng() * (max - min)) / 10) * 10;
}

function buildEvidence(rng: () => number, tier: RiskTier, total: number): Evidence[] {
  const count = 5 + Math.floor(rng() * 3);
  const picked = [...FEATURES].sort(() => rng() - 0.5).slice(0, count);
  return picked.map((f, i) => {
    const positiveBias = tier === "high" ? 0.85 : tier === "medium" ? 0.6 : 0.2;
    const positive = rng() < positiveBias || (tier === "high" && i === 0);
    const magnitude = 0.2 + rng() * 2.8;
    const impact = Number(((positive ? 1 : -1) * magnitude).toFixed(2));
    return {
      type: "shap" as const,
      feature: f.feature,
      label: f.label(formatMoneyFull(total)),
      detail: f.detail,
      impact,
      direction: positive ? "increases_risk" : "decreases_risk",
    };
  });
}

export function formatMoneyFull(n: number) {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function formatMoneyShort(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

function buildProviders(): Provider[] {
  const rng = makeRng(20260814);
  const list: Provider[] = [];
  for (let i = 0; i < 100; i++) {
    const tier: RiskTier = i < 24 ? "high" : i < 55 ? "medium" : "low";
    const score =
      tier === "high"
        ? Number((0.86 + rng() * 0.1399).toFixed(4))
        : tier === "medium"
          ? Number((0.55 + rng() * 0.3).toFixed(4))
          : Number((0.005 + rng() * 0.5).toFixed(4));
    const total =
      tier === "high" ? money(rng, 620_000, 2_400_000)
        : tier === "medium" ? money(rng, 180_000, 900_000)
          : money(rng, 20_000, 320_000);
    const expected = Math.round(total * (0.35 + score * 0.65));
    const n_claims = 120 + Math.floor(rng() * 1600);
    list.push({
      provider_id: `PRV${10000 + Math.floor(rng() * 89999)}`,
      score,
      risk_tier: tier,
      total_reimbursed: total,
      expected_loss: expected,
      n_claims,
      n_unique_bene: Math.max(20, Math.floor(n_claims / (1.2 + rng() * 2))),
      state: STATES[Math.floor(rng() * STATES.length)]!,
      status: "unreviewed",
      evidence: buildEvidence(rng, tier, total),
      narrative: null,
    });
  }
  // unique ids
  const seen = new Set<string>();
  list.forEach((p, i) => {
    while (seen.has(p.provider_id)) p.provider_id = `PRV${10000 + ((parseInt(p.provider_id.slice(3)) + 7 + i) % 89999)}`;
    seen.add(p.provider_id);
  });
  return list.sort((a, b) => b.expected_loss - a.expected_loss);
}

export const providers: Provider[] = buildProviders();

export const providerById = new Map(providers.map((p) => [p.provider_id, p]));

const RULES = [
  "Duplicate claim",
  "Service after date of death",
  "Overlapping inpatient stay",
  "Unbundled procedure codes",
  "Deductible waived",
];

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

function dateStr(rng: () => number) {
  const m = 1 + Math.floor(rng() * 12);
  const d = 1 + Math.floor(rng() * 27);
  return `2025-${pad(m)}-${pad(d)}`;
}

function addDays(iso: string, days: number) {
  const dt = new Date(iso + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

const claimCache = new Map<string, Claim[]>();

export function claimsForProvider(providerId: string): Claim[] {
  const cached = claimCache.get(providerId);
  if (cached) return cached;
  const seed = providerId.split("").reduce((a, c) => a + c.charCodeAt(0), 0) * 7919;
  const rng = makeRng(seed);
  const provider = providerById.get(providerId);
  const avg = provider ? provider.total_reimbursed / provider.n_claims : 800;
  const claims: Claim[] = [];
  for (let i = 0; i < 20; i++) {
    const type = rng() < 0.45 ? "inpatient" : "outpatient";
    const start = dateStr(rng);
    const len = type === "inpatient" ? 1 + Math.floor(rng() * 14) : Math.floor(rng() * 2);
    const end = addDays(start, len);
    const amount = Math.round(avg * (0.3 + rng() * 3));
    const flag = rng() < 0.18 ? RULES[Math.floor(rng() * RULES.length)]! : null;
    claims.push({
      claim_id: `CLM${100000 + Math.floor(rng() * 899999)}`,
      bene_id: `BEN${10000 + Math.floor(rng() * 89999)}`,
      claim_start_dt: start,
      claim_end_dt: end,
      claim_type: type,
      amount_reimbursed: amount,
      deductible_paid: rng() < 0.5 ? 0 : Math.round(rng() * 1068),
      attending_physician: PHYSICIANS[Math.floor(rng() * PHYSICIANS.length)]!,
      diagnosis_codes: [...DIAG].sort(() => rng() - 0.5).slice(0, 2 + Math.floor(rng() * 5)),
      procedure_codes: [...PROC].sort(() => rng() - 0.5).slice(0, 1 + Math.floor(rng() * 4)),
      admission_dt: type === "inpatient" ? start : null,
      discharge_dt: type === "inpatient" ? end : null,
      rule_flag: flag,
    });
  }
  claims.sort((a, b) => a.claim_start_dt.localeCompare(b.claim_start_dt));
  claimCache.set(providerId, claims);
  return claims;
}

export function narrativeFor(p: Provider): string[] {
  const top = [...p.evidence].sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact)).slice(0, 3);
  if (p.risk_tier === "low") {
    return [
      `${p.provider_id} scored ${p.score.toFixed(2)}, well below the review threshold of 0.55. Across ${p.n_claims.toLocaleString()} claims for ${p.n_unique_bene.toLocaleString()} beneficiaries in ${stateName(p.state)}, billing volume and per-claim amounts sit inside the normal range for the peer group.`,
      `The strongest signals in this file pull the score down rather than up. ${top[0]?.label ?? "Billing volume"} and ${top[1]?.label ?? "claim mix"} are both consistent with peers, and none of the twelve deterministic rules fired on any claim in the period.`,
      `No further action is suggested. If a referral or tip arrives for this provider, flag the case manually and it will re-enter the queue at the top for a human read regardless of score.`,
    ];
  }
  return [
    `${p.provider_id} in ${stateName(p.state)} billed ${formatMoneyFull(p.total_reimbursed)} across ${p.n_claims.toLocaleString()} claims for ${p.n_unique_bene.toLocaleString()} beneficiaries, and scored ${p.score.toFixed(4)} — placing it in the ${p.risk_tier} risk tier.`,
    `The score is driven mostly by ${top.map((t) => t.label.toLowerCase()).join(", ")}. Each of these sits far from the peer distribution for the same specialty and state, and together they account for the majority of the model's output for this provider.`,
    `Expected loss on this file is ${formatMoneyFull(p.expected_loss)}. A reviewer should start with the highest-value inpatient claims and check whether the attending physician concentration and repeated code patterns hold up against the medical record.`,
  ];
}
