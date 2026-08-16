import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCaseStore } from "@/lib/caseStore";
import { chatWithAssistant } from "@/lib/api";
import { cn } from "@/lib/utils";

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

function Assistant() {
  const { providers } = useCaseStore();
  const [messages, setMessages] = useState<Msg[]>([
    {
      id: 0,
      role: "assistant",
      text: "Ask me anything about the Medicare fraud review. Tag a provider with @ to include their evidence — for example: \"@PRV52985 why was this provider flagged?\"",
    },
  ]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
    const userMsg: Msg = { id: Date.now(), role: "user", text };
    setMessages((m) => [...m, userMsg]);
    setPending(true);

    const providerIds = extractProviderIds(text);

    try {
      const reply = await chatWithAssistant(text, providerIds);
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
    <div className="flex h-screen flex-col">
      <header className="border-b border-border px-6 py-4">
        <h1 className="text-[15px] font-medium">Case assistant</h1>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Ask general questions or tag a provider with @PRVXXXXX to get evidence-grounded answers
        </p>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          {messages.map((m) => (
            <div key={m.id} className={cn("text-[14px]", m.role === "user" && "flex justify-end")}>
              {m.role === "user" ? (
                <span className="max-w-[80%] whitespace-pre-wrap border border-border bg-muted px-3 py-2 text-foreground">
                  {m.text}
                </span>
              ) : (
                <p
                  className={cn(
                    "whitespace-pre-wrap leading-relaxed",
                    m.error ? "text-muted-foreground italic" : "text-foreground",
                  )}
                >
                  {m.text}
                </p>
              )}
            </div>
          ))}
          {pending && (
            <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <span className="animate-pulse">●</span>
              <span>Thinking…</span>
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <form onSubmit={send} className="border-t border-border px-6 py-4">
        <div className="mx-auto max-w-2xl">
          {suggestions.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1">
              {suggestions.map((p) => (
                <button
                  key={p.provider_id}
                  type="button"
                  onClick={() => {
                    setInput((v) => v.replace(/@([A-Za-z0-9]*)$/, `@${p.provider_id} `));
                    inputRef.current?.focus();
                  }}
                  className="border border-border px-2 py-1 font-mono text-[12px] hover:bg-muted"
                >
                  {p.provider_id}
                  <span className="ml-1.5 text-muted-foreground">{p.risk_tier}</span>
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder='Ask anything, or "@PRV52985 why was this flagged?"'
              className="flex-1 border border-border bg-background px-3 py-2 text-[13px] outline-none placeholder:text-muted-foreground focus:border-foreground/40"
            />
            <button
              type="submit"
              disabled={pending || !input.trim()}
              className="border border-border px-3 py-2 text-[13px] hover:bg-muted disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
