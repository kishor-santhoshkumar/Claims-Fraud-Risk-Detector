import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCaseStore } from "@/lib/caseStore";
import { chatWithAssistant, type ChatHistoryMessage } from "@/lib/api";

export const Route = createFileRoute("/assistant")({
  component: Assistant,
});

interface Msg {
  id: number;
  role: "user" | "assistant";
  text: string;
  error?: boolean;
}

/** Extract provider IDs from @mentions in a message. */
function extractProviderIds(text: string): string[] {
  return [...text.matchAll(/@([A-Za-z0-9]+)/g)]
    .map((m) => (m[1] ?? "").toUpperCase())
    .filter(Boolean);
}

const INITIAL_MSG: Msg = {
  id: 0,
  role: "assistant",
  text: "Ask me anything about the Medicare fraud review. Tag a provider with @ to include their evidence — for example: \"@PRV52985 why was this provider flagged?\"",
};

function loadSession<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
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
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Persist to sessionStorage whenever state changes (survives tab switches, clears on refresh)
  useEffect(() => {
    try { sessionStorage.setItem("chat_messages", JSON.stringify(messages)); } catch {}
  }, [messages]);

  useEffect(() => {
    try { sessionStorage.setItem("chat_session_providers", JSON.stringify(sessionProviders)); } catch {}
  }, [sessionProviders]);

  // Autocomplete suggestions when typing @...
  const suggestions = useMemo(() => {
    const q = input.match(/@([A-Za-z0-9]*)$/);
    if (!q) return [];
    const term = (q[1] ?? "").toUpperCase();
    return providers
      .filter((p) => p.provider_id.includes(term))
      .slice(0, 6);
  }, [input, providers]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, pending]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || pending) return;

    setInput("");

    // Snapshot history before adding the new user message (skip initial greeting + errors)
    const history: ChatHistoryMessage[] = messages
      .filter((m) => m.id !== 0 && !m.error)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.text }));

    const userMsg: Msg = { id: Date.now(), role: "user", text };
    setMessages((m) => [...m, userMsg]);
    setPending(true);

    // Merge new @mentions with all providers seen so far this session
    const newIds = extractProviderIds(text);
    const allProviderIds = Array.from(new Set([...sessionProviders, ...newIds]));
    if (newIds.length > 0) setSessionProviders(allProviderIds);

    try {
      const reply = await chatWithAssistant(text, allProviderIds, history);
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

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100svh" }}>
      <header style={{ padding: "16px 24px", backdropFilter: "blur(20px) saturate(180%)", WebkitBackdropFilter: "blur(20px) saturate(180%)", background: "linear-gradient(160deg, rgba(255,255,255,0.72) 0%, rgba(228,231,253,0.5) 100%)", borderBottom: "1px solid rgba(255,255,255,0.75)" }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>Case assistant</h1>
        <p style={{ marginTop: 4, fontSize: 11, color: "var(--text-muted)", marginBottom: 0 }}>
          Ask general questions or tag a provider with @PRVXXXXX to get evidence-grounded answers
        </p>
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
          {suggestions.length > 0 && (
            <div style={{ marginBottom: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
              {suggestions.map((p) => (
                <button
                  key={p.provider_id}
                  type="button"
                  onClick={() => {
                    setInput((v) => v.replace(/@([A-Za-z0-9]*)$/, `@${p.provider_id} `));
                    inputRef.current?.focus();
                  }}
                  style={{ padding: "2px 8px", fontFamily: "ui-monospace,monospace", fontSize: 12, background: "rgba(255,255,255,0.6)", border: "1px solid rgba(100,116,139,0.22)", borderRadius: 6, color: "var(--text-secondary)", cursor: "pointer" }}
                >
                  {p.provider_id}
                  <span style={{ marginLeft: 6, color: "var(--text-faint)" }}>{p.risk_tier}</span>
                </button>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder='Ask anything, or "@PRV52985 why was this flagged?"'
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
        </div>
      </form>
    </div>
  );
}
