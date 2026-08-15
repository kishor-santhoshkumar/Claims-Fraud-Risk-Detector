import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCaseStore } from "@/lib/caseStore";
import { type CaseProvider } from "@/lib/caseStore";
import { formatMoneyFull } from "@/lib/mockData";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/assistant")({
  component: Assistant,
});

interface Msg {
  id: number;
  role: "user" | "assistant";
  text: string;
}

function replyFor(providers: CaseProvider[], text: string): string {
  const tags = [...text.matchAll(/@([A-Za-z0-9-]+)/g)].map((m) => (m[1] ?? "").toUpperCase()).filter(Boolean);
  if (tags.length === 0) {
    return 'Tag a provider to start, for example "@PRV-0001 why is this flagged?". Responses in this build are canned demo text.';
  }
  return tags
    .map((id) => {
      const p = providers.find((x) => x.provider_id === id);
      if (!p) return `No provider matches ${id} in this dataset.`;
      return [
        `${p.provider_id} - ${p.risk_tier} risk, score ${p.score.toFixed(2)}, ${formatMoneyFull(p.expected_loss)} at risk.`,
        `${p.n_claims.toLocaleString()} claims, ${p.n_unique_bene?.toLocaleString() ?? "-"} beneficiaries, ${p.state ?? "-"}. Status: ${p.status.replace("_", " ")}.`,
        "Open the case file for full evidence details.",
        "Demo response - no model is connected yet.",
      ].join("\n");
    })
    .join("\n\n");
}

function Assistant() {
  const { providers } = useCaseStore();
  const [messages, setMessages] = useState<Msg[]>([
    {
      id: 0,
      role: "assistant",
      text: 'Tag a provider with @ to ask about a case. Try "@PRV-0001 summarise the evidence".',
    },
  ]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const suggestions = useMemo(() => {
    const q = input.match(/@([A-Za-z0-9-]*)$/);
    if (!q) return [];
    const term = (q[1] ?? "").toUpperCase();
    return providers
      .filter((p) => p.provider_id.includes(term))
      .slice(0, 6);
  }, [input, providers]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, pending]);

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || pending) return;
    setInput("");
    setMessages((m) => [...m, { id: m.length, role: "user", text }]);
    setPending(true);
    setTimeout(() => {
      setMessages((m) => [...m, { id: m.length, role: "assistant", text: replyFor(providers, text) }]);
      setPending(false);
    }, 700);
  };

  return (
    <div className="flex h-screen flex-col">
      <header className="border-b border-border px-6 py-4">
        <h1 className="text-[15px] font-medium">Case assistant</h1>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Demo only - tag a provider with @PRV-0001 - canned responses, no model connected
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
                <p className="whitespace-pre-wrap leading-relaxed text-foreground">{m.text}</p>
              )}
            </div>
          ))}
          {pending && <p className="text-[13px] text-muted-foreground">Thinking...</p>}
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
                  onClick={() => setInput((v) => v.replace(/@([A-Za-z0-9-]*)$/, `@${p.provider_id} `))}
                  className="border border-border px-2 py-1 font-mono text-[12px] hover:bg-muted"
                >
                  {p.provider_id}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about @PRV-0001..."
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
