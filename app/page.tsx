"use client";

import React, { useMemo, useRef, useState } from "react";

type Role = "user" | "assistant";

type SentimentScores = {
  compound: number;
  label: "positive" | "negative" | "neutral";
  pos: number;
  neu: number;
  neg: number;
};

type SentenceAnalysis = {
  text: string;
  sentiment: SentimentScores;
};

type Analysis = {
  overall_sentiment: SentimentScores;
  sentences: SentenceAnalysis[];
  relevant_sentences: {
    most_positive: SentenceAnalysis | null;
    most_negative: SentenceAnalysis | null;
  };
};

type Message = {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  analysis?: Analysis;
};

type School = {
  id: string;
  name: string;
  logoUrl: string; // keep this as a URL for now
};

const SCHOOLS: School[] = [
  {
    id: "ust",
    name: "University of Santo Tomas",
    logoUrl:
      "https://upload.wikimedia.org/wikipedia/en/thumb/7/7c/University_of_Santo_Tomas_seal.svg/256px-University_of_Santo_Tomas_seal.svg.png",
  },
  {
    id: "up",
    name: "University of the Philippines",
    logoUrl:
      "https://upload.wikimedia.org/wikipedia/en/thumb/7/77/University_of_the_Philippines_seal.svg/256px-University_of_the_Philippines_seal.svg.png",
  },
  {
    id: "admu",
    name: "Ateneo de Manila University",
    logoUrl:
      "https://upload.wikimedia.org/wikipedia/en/thumb/0/08/Ateneo_de_Manila_University_seal.svg/256px-Ateneo_de_Manila_University_seal.svg.png",
  },
];

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

export default function Page() {
  const [selectedSchoolId, setSelectedSchoolId] = useState(SCHOOLS[0].id);
  const selectedSchool = useMemo(
    () => SCHOOLS.find((s) => s.id === selectedSchoolId)!,
    [selectedSchoolId]
  );

  const [messages, setMessages] = useState<Message[]>([
    {
      id: uid(),
      role: "assistant",
      content:
        "Hi! Pick a school, then tell me what you care about (friends, orgs, workload balance, nightlife, dorm life, etc). I’ll summarize the student-life sentiment.",
      analysis: undefined,
      createdAt: Date.now(),
    },
  ]);

  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);

  const bottomRef = useRef<HTMLDivElement | null>(null);

  function scrollToBottom() {
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    });
  }

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || isThinking) return;

    const userMsg: Message = {
      id: uid(),
      role: "user",
      content: text,
      createdAt: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsThinking(true);
    scrollToBottom();

    // ✅ Front-end stub response (replace later with your /api/chat call)
    // Pretend we analyzed Reddit sentiment for the selected school.
    await new Promise((r) => setTimeout(r, 700));

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        school: { id: selectedSchool.id, name: selectedSchool.name },
        messages: [
          ...messages.map((m) => ({ role: m.role, content: m.content })),
          { role: "user", content: text },
        ],
      }),
    });

    const data = await res.json();

    const assistantMsg: Message = {
      id: uid(),
      role: "assistant",
      content: data.reply ?? "No reply returned.",
      analysis: data.analysis,
      createdAt: Date.now(),
    };

    setMessages((prev) => [...prev, assistantMsg]);
    setIsThinking(false);
    scrollToBottom();
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">College Guide: Student Life Sentiment</h1>
            <p className="mt-1 text-sm text-slate-300">
              Choose a school, then chat to get a student-life sentiment summary (Reddit + AI later).
            </p>
          </div>

          
        </header>

        <div className="grid gap-4 md:grid-cols-[320px_1fr]">
          {/* Left: School panel */}
          <aside className="rounded-2xl border border-slate-800 bg-slate-900/30 p-4">
            <h2 className="text-sm font-medium text-slate-200">School</h2>

            <label className="mt-3 block text-xs text-slate-400">Select school</label>
            <select
              className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-600"
              value={selectedSchoolId}
              onChange={(e) => setSelectedSchoolId(e.target.value)}
            >
              {SCHOOLS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>

            <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
              <div className="flex items-center gap-3">
                <div className="h-16 w-16 overflow-hidden rounded-2xl border border-slate-800 bg-white">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={selectedSchool.logoUrl}
                    alt={`${selectedSchool.name} logo`}
                    className="h-full w-full object-contain p-2"
                  />
                </div>
                <div>
                  <div className="text-sm font-medium">{selectedSchool.name}</div>
                  <div className="mt-1 text-xs text-slate-400">
                    Logo preview (replace with your own assets later)
                  </div>
                </div>
              </div>

            </div>
          </aside>

          {/* Right: Chat panel */}
          <main className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900/30">
            <div className="border-b border-slate-800 p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium">Chat</h2>
                <div className="text-xs text-slate-400">
                  School: <span className="text-slate-200">{selectedSchool.name}</span>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-4">
              <div className="space-y-3">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                        m.role === "user"
                          ? "bg-slate-200 text-slate-900"
                          : "bg-slate-950/70 text-slate-100 border border-slate-800"
                      }`}
                    >
                      {/* Simple markdown-ish bold support */}
                      <MessageText text={m.content} />
                      {m.role === "assistant" && m.analysis && (
                        <SentimentAnalysis analysis={m.analysis} />
                      )}
                    </div>
                  </div>
                ))}

                {isThinking && (
                  <div className="flex justify-start">
                    <div className="max-w-[85%] rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-sm text-slate-300">
                      Thinking…
                    </div>
                  </div>
                )}

                <div ref={bottomRef} />
              </div>
            </div>

            <form onSubmit={onSend} className="border-t border-slate-800 p-4">
              <div className="flex gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask about student life… (e.g., 'Is it friendly for introverts?')"
                  className="flex-1 rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-600"
                />
                <button
                  type="submit"
                  disabled={isThinking || !input.trim()}
                  className="rounded-xl bg-slate-200 px-4 py-3 text-sm font-medium text-slate-900 disabled:opacity-50"
                >
                  Send
                </button>
              </div>
            </form>
          </main>
        </div>
      </div>
    </div>
  );
}

function SentimentAnalysis({ analysis }: { analysis: Analysis }) {
  if (!analysis?.overall_sentiment) return null;

  const { label, compound } = analysis.overall_sentiment;

  const getLabelColor = () => {
    if (label === "positive") return "text-green-400";
    if (label === "negative") return "text-red-400";
    return "text-slate-400";
  };

  return (
    <div className="mt-3 border-t border-slate-700/50 pt-3 text-xs">
      <span className="font-semibold text-slate-400">Sentiment: </span>
      <span className={`font-bold capitalize ${getLabelColor()}`}>{label}</span>
      <span className="ml-2 text-slate-500">(Score: {compound.toFixed(2)})</span>
    </div>
  );
}

function MessageText({ text }: { text: string }) {
  // minimal “**bold**” rendering without adding dependencies
  const parts = useMemo(() => {
    const out: Array<{ t: string; bold: boolean }> = [];
    const tokens = text.split("**");
    for (let i = 0; i < tokens.length; i++) {
      out.push({ t: tokens[i], bold: i % 2 === 1 });
    }
    return out;
  }, [text]);

  return (
    <div className="whitespace-pre-wrap">
      {parts.map((p, idx) =>
        p.bold ? (
          <strong key={idx} className="font-semibold">
            {p.t}
          </strong>
        ) : (
          <span key={idx}>{p.t}</span>
        )
      )}
    </div>
  );
}
