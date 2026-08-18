import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCaseStore } from "@/lib/caseStore";
import {
  chatWithAssistant,
  fetchClaimSearch,
  type ChatHistoryMessage,
  type ClaimSearchResult,
} from "@/lib/api";

export const Route = createFileRoute("/assistant")({
  component: Assistant,
});

interface Msg {
  id: number;
  role: "user" | "assistant";
  text: string;
  error?: boolean;
}

function extractProviderIds(text: string): string[] {
  return [...text.matchAll(/@([A-Za-z0-9]+)/g)]
    .map((m) => (m[1] ?? "").toUpperCase())
    .filter(Boolean);
}

function extractClaimIds(text: string): string[] {
  return [...text.matchAll(/#([A-Za-z0-9]+)/g)]
    .map((m) => (m[1] ?? "").toUpperCase())
    .filter(Boolean);
}

const INITIAL_MSG: Msg = {
  id: 0,
  role: "assistant",
  text: 'Ask me anything about Medicare fraud review.\n\n• Tag a provider with @PRVXXXXX to include their evidence — e.g. "@PRV52985 why was this flagged?"\n• Tag a claim with #CLMXXXXX to analyse that specific claim — e.g. "#CLM59355 what rule did this violate?"\n• Mix both in one message for cross-claim/provider analysis.',
};

function loadSession<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function TierDot({ tier }: { tier: string }) {
  const color = tier === "high" ? "#ef4444" : tier === "medium" ? "#f59e0b" : "#10b981";
  return <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: color, marginRight: 4, verticalAlign: "middle" }} />;
}

function Assistant() {
  const { providers } = useCaseStore();
  const [messages, setMessages] = useState<Msg[]>(() =>
    loadSession<Msg[]>("chat_messages", [INITIAL_MSG])
  );
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [sessionProviders, setSessionProviders] = useState<string[]>(() =>
    loadSession<string[]>("chat_session_providers", [])
  );
  const [sessionClaims, setSessionClaims] = useState<string[]>(() =>
    loadSession<string[]>("chat_session_claims", [])
  );
  const [claimSuggestions, setClaimSuggestions] = useState<ClaimSearchResult[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try { sessionStorage.setItem("chat_messages", JSON.stringify(messages)); } catch {}
  }, [messages]);
  useEffect(() => {
    try { sessionStorage.setItem("chat_session_providers", JSON.stringify(sessionProviders)); } catch {}
  }, [sessionProviders]);
  useEffect(() => {
    try { sessionStorage.setItem("chat_session_claims", JSON.stringify(sessionClaims)); } catch {}
  }, [sessionClaims]);

  // Pick up pre-fill written by queue/claims "Ask" buttons
  useEffect(() => {
    try {
      const prefill = sessionStorage.getItem("chat_prefill");
      if (prefill) {
        setInput(prefill);
        sessionStorage.removeItem("chat_prefill");
        inputRef.current?.focus();
      }
    } catch {}
  }, []);

  // Provider autocomplete (sync, from caseStore)
  const providerSuggestions = useMemo(() => {
    const q = input.match(/@([A-Za-z0-9]*)$/);
    if (!q) return [];
    const term = (q[1] ?? "").toUpperCase();
    return providers.filter((p) => p.provider_id.includes(term)).slice(0, 6);
  }, [input, providers]);

  // Claim autocomplete (async, from backend)
  useEffect(() => {
    const q = input.match(/#([A-Za-z0-9]{2,})$/);
    if (!q) { setClaimSuggestions([]); return; }
    const term = q[1] ?? "";
    let cancelled = false;
    const tid = setTimeout(() => {
      fetchClaimSearch(term).then((r) => { if (!cancelled) setClaimSuggestions(r); });
    }, 200);
    return () => { cancelled = true; clearTimeout(tid); };
  }, [input]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, pending]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || pending) return;
    setInput("");
    setClaimSuggestions([]);

    const history: ChatHistoryMessage[] = messages
      .filter((m) => m.id !== 0 && !m.error)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.text }));

    const userMsg: Msg = { id: Date.now(), role: "user", text };
    setMessages((m) => [...m, userMsg]);
    setPending(true);

    const newProviderIds = extractProviderIds(text);
    const newClaimIds = extractClaimIds(text);
    const allProviderIds = Array.from(new Set([...sessionProviders, ...newProviderIds]));
    const allClaimIds = Array.from(new Set([...sessionClaims, ...newClaimIds]));
    if (newProviderIds.length > 0) setSessionProviders(allProviderIds);
    if (newClaimIds.length > 0) setSessionClaims(allClaimIds);

    try {
      const reply = await chatWithAssistant(text, allProviderIds, history, allClaimIds);
      setMessages((m) => [...m, { id: Date.now() + 1, role: "assistant", text: reply }]);
    } catch {
      setMessages((m) => [
        ...m,
        {
          id: Date.now() + 1,
          role: "assistant",
          text: "Sorry, the assistant is unavailable right now. The LLM service may be rate-limited — try again in a moment.",
          error: true,
        },
      ]);
    } finally {
      setPending(false);
    }
  };

  const hasSuggestions = providerSuggestions.length > 0 || claimSuggestions.length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100svh" }}>
      <header style={{ padding: "16px 24px", backdropFilter: "blur(20px) saturate(180%)", WebkitBackdropFilter: "blur(20px) saturate(180%)", background: "linear-gradient(160deg, rgba(255,255,255,0.72) 0%, rgba(228,231,253,0.5) 100%)", borderBottom: "1px solid rgba(255,255,255,0.75)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>Case assistant</h1>
          <p style={{ marginTop: 4, fontSize: 11, color: "var(--text-muted)", marginBottom: 0 }}>
            @PROVIDER for evidence context · #CLAIM for claim-level analysis · mix freely
          </p>
        </div>
        <button
          onClick={() => {
            setMessages([INITIAL_MSG]);
            setSessionProviders([]);
            setSessionClaims([]);
            try {
              sessionStorage.removeItem("chat_messages");
              sessionStorage.removeItem("chat_session_providers");
              sessionStorage.removeItem("chat_session_claims");
            } catch {}
          }}
          style={{ height: 34, padding: "0 14px", borderRadius: 8, border: "1px solid rgba(239,68,68,0.35)", background: "rgba(239,68,68,0.07)", color: "#dc2626", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", transition: "background 0.15s, border-color 0.15s", whiteSpace: "nowrap" }}
          onMouseEnter={(e) => { const b = e.currentTarget; b.style.background = "rgba(239,68,68,0.15)"; b.style.borderColor = "rgba(239,68,68,0.6)"; }}
          onMouseLeave={(e) => { const b = e.currentTarget; b.style.background = "rgba(239,68,68,0.07)"; b.style.borderColor = "rgba(239,68,68,0.35)"; }}
        >
          Clear chat
        </button>
      </header>

      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
        <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
          {messages.map((m) => (
            <div key={m.id} style={{ fontSize: 14, display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
              {m.role === "user" ? (
                <span style={{ maxWidth: "80%", whiteSpace: "pre-wrap", background: "linear-gradient(135deg, #3b82f6, #6366f1)", color: "#fff", padding: "8px 14px", borderRadius: "14px 14px 4px 14px", fontSize: 13 }}>
                  {m.text}
                </span>
              ) : (
                <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.65, margin: 0, color: m.error ? "var(--text-faint)" : "var(--text-secondary)", fontStyle: m.error ? "italic" : "normal" }}>
                  {m.text}
                </p>
              )}
            </div>
          ))}
          {pending && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-faint)" }}>
              <span className="animate-pulse">●</span>
              <span>Thinking…</span>
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <form onSubmit={send} style={{ padding: "12px 24px 16px", backdropFilter: "blur(20px) saturate(180%)", WebkitBackdropFilter: "blur(20px) saturate(180%)", background: "linear-gradient(160deg, rgba(255,255,255,0.72) 0%, rgba(228,231,253,0.5) 100%)", borderTop: "1px solid rgba(255,255,255,0.75)" }}>
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          {hasSuggestions && (
            <div style={{ marginBottom: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
              {providerSuggestions.map((p) => (
                <button
                  key={p.provider_id}
                  type="button"
                  onClick={() => {
                    setInput((v) => v.replace(/@([A-Za-z0-9]*)$/, `@${p.provider_id} `));
                    inputRef.current?.focus();
                  }}
                  style={{ padding: "2px 8px", fontFamily: "ui-monospace,monospace", fontSize: 12, background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.25)", borderRadius: 6, color: "#1d4ed8", cursor: "pointer" }}
                >
                  @{p.provider_id}
                  <span style={{ marginLeft: 5, color: "#667088", fontFamily: "inherit" }}>{p.risk_tier}</span>
                </button>
              ))}
              {claimSuggestions.map((c) => (
                <button
                  key={c.claim_id}
                  type="button"
                  onClick={() => {
                    setInput((v) => v.replace(/#([A-Za-z0-9]*)$/, `#${c.claim_id} `));
                    inputRef.current?.focus();
                  }}
                  style={{ padding: "2px 8px", fontFamily: "ui-monospace,monospace", fontSize: 12, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 6, color: "#92400e", cursor: "pointer" }}
                >
                  <TierDot tier={c.claim_risk_tier} />
                  #{c.claim_id}
                  <span style={{ marginLeft: 5, color: "#667088", fontFamily: "inherit" }}>${(c.amount_reimbursed / 1000).toFixed(0)}K</span>
                  {c.rule_flags.length > 0 && (
                    <span style={{ marginLeft: 5, color: "#dc2626", fontFamily: "inherit" }}>⚑</span>
                  )}
                </button>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder='Ask anything · @PRV52985 provider context · #CLM59355 claim analysis'
              style={{ flex: 1, height: 40, background: "rgba(255,255,255,0.6)", border: "1px solid rgba(100,116,139,0.22)", borderRadius: 10, padding: "0 12px", fontSize: 13, fontFamily: "inherit", color: "var(--text-primary)", outline: "none", transition: "border-color 0.2s, box-shadow 0.2s" }}
              onFocus={(e) => { e.target.style.borderColor = "#3b82f6"; e.target.style.boxShadow = "0 0 0 3px rgba(59,130,246,0.12)"; }}
              onBlur={(e) => { e.target.style.borderColor = "rgba(100,116,139,0.22)"; e.target.style.boxShadow = "none"; }}
            />
            <button
              type="submit"
              disabled={pending || !input.trim()}
              style={{ height: 40, padding: "0 18px", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #3b82f6, #6366f1)", color: "#fff", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", opacity: (pending || !input.trim()) ? 0.4 : 1, transition: "opacity 0.15s" }}
            >
              Send
            </button>
          </div>
          {(sessionProviders.length > 0 || sessionClaims.length > 0) && (
            <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
              <span style={{ fontSize: 10, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Session context:</span>
              {sessionProviders.map((id) => (
                <span key={id} style={{ padding: "1px 6px", fontFamily: "ui-monospace,monospace", fontSize: 11, background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 4, color: "#3b82f6" }}>@{id}</span>
              ))}
              {sessionClaims.map((id) => (
                <span key={id} style={{ padding: "1px 6px", fontFamily: "ui-monospace,monospace", fontSize: 11, background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: 4, color: "#b45309" }}>#{id}</span>
              ))}
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
