"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

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

type Confidence = "low" | "medium" | "high";

type MessageMeta = {
  mode?: string;
  model?: string;
  cache_hit?: boolean;
  topic?: string | null;
  freshness_days?: number | null;
  prompt?: string;
  source_note?: string | null;
  guardrail?: boolean;
  overview?: string | null;
  tldr?: string | null;
};

type Message = {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  analysis?: Analysis;
  meta?: MessageMeta;
  confidence?: Confidence;
  topic?: string | null;
};

type CompareResult = {
  school: School;
  reply: string;
  analysis?: Analysis;
  meta?: MessageMeta;
  confidence?: Confidence;
  createdAt: number;
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
      "ust.jpeg",
  },
  {
    id: "up",
    name: "University of the Philippines",
    logoUrl:
      "up.png"    
  },
  {
    id: "admu",
    name: "Ateneo de Manila University",
    logoUrl:
      "admu.png",
  },
  {
    id: "lpuc",
    name: "Lyceum of the Philippines University - Cavite",
    logoUrl:
      "lpuc.png",
  },
    {
    id: "dlsu",
    name: "De La Salle University",
    logoUrl:
      "dlsu.png",
  },
];

const TOPICS = [
  "General",
  "Workload",
  "Orgs",
  "Social Life",
  "Dorms",
  "Faculty",
  "Facilities",
  "Cost",
  "Safety",
];

const FRESHNESS_OPTIONS = [
  { label: "Recent (30d)", value: 30 },
  { label: "90d", value: 90 },
  { label: "1y", value: 365 },
  { label: "All time", value: 0 },
];

const SUBREDDIT_BY_SCHOOL: Record<string, string> = {
  ust: "r/Tomasino",
  up: "r/peyups",
  admu: "r/admu",
  lpuc: "r/studentsPH",
  dlsu: "r/dlsu",
};

const SUBREDDITS = [
  "r/askPH",
  "r/studentsPH",
  "r/dlsu",
  "r/admu",
  "r/peyups",
  "r/Tomasino",
  "r/Philippines",
];

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function buildGreeting(school: School): Message {
  return {
    id: uid(),
    role: "assistant",
    content: `Hi! Tell me what you care about at ${school.name}, and I’ll summarize the student-life sentiment.`,
    analysis: undefined,
    createdAt: Date.now(),
  };
}

function hashSeed(input: string) {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function simulatedUsername(seed: string) {
  const adjectives = ["curious", "lucky", "quiet", "brisk", "orange", "midnight", "bright", "sly"];
  const nouns = ["tamaraw", "sparrow", "islander", "scholar", "coffee", "atlas", "nomad", "runner"];
  const h = hashSeed(seed);
  const adj = adjectives[h % adjectives.length];
  const noun = nouns[(h >> 3) % nouns.length];
  const num = (h % 900) + 100;
  return `u/${adj}_${noun}${num}`;
}

export default function Page() {
  const [selectedSchoolId, setSelectedSchoolId] = useState(SCHOOLS[0].id);
  const selectedSchool = useMemo(
    () => SCHOOLS.find((s) => s.id === selectedSchoolId)!,
    [selectedSchoolId]
  );

  const [messagesBySchool, setMessagesBySchool] = useState<Record<string, Message[]>>(() => {
    const first = SCHOOLS[0];
    return { [first.id]: [buildGreeting(first)] };
  });

  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [selectedTopic, setSelectedTopic] = useState(TOPICS[0]);
  const [freshnessDays, setFreshnessDays] = useState(FRESHNESS_OPTIONS[1].value);
  const [selectedSubreddit, setSelectedSubreddit] = useState(
    SUBREDDIT_BY_SCHOOL[SCHOOLS[0].id] ?? SUBREDDITS[0]
  );
  const [compareMode, setCompareMode] = useState(false);
  const [compareResults, setCompareResults] = useState<CompareResult[]>([]);
  const [isComparing, setIsComparing] = useState(false);

  const bottomRef = useRef<HTMLDivElement | null>(null);

  function scrollToBottom() {
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    });
  }

  const sessionMessages = messagesBySchool[selectedSchoolId] ?? [buildGreeting(selectedSchool)];

  useEffect(() => {
    setMessagesBySchool((prev) => {
      if (prev[selectedSchoolId]) return prev;
      return { ...prev, [selectedSchoolId]: [buildGreeting(selectedSchool)] };
    });
  }, [selectedSchoolId, selectedSchool]);

  useEffect(() => {
    setSelectedSubreddit(SUBREDDIT_BY_SCHOOL[selectedSchoolId] ?? SUBREDDITS[0]);
  }, [selectedSchoolId]);

  const sentimentHistory = useMemo(() => {
    return sessionMessages
      .filter((m) => m.role === "assistant" && m.analysis?.overall_sentiment)
      .map((m) => ({
        id: m.id,
        createdAt: m.createdAt,
        text: m.content,
        sentiment: m.analysis!.overall_sentiment,
        confidence: m.confidence,
        topic: m.meta?.topic ?? m.topic ?? null,
        meta: m.meta,
      }));
  }, [sessionMessages]);

  const sentimentPoints = useMemo(() => {
    return sentimentHistory.map((m) => ({
      createdAt: m.createdAt,
      compound: m.sentiment.compound,
    }));
  }, [sentimentHistory]);

  const dailyAgg = useMemo(
    () => aggregateSentiment(sentimentPoints, "day"),
    [sentimentPoints]
  );
  const weeklyAgg = useMemo(
    () => aggregateSentiment(sentimentPoints, "week"),
    [sentimentPoints]
  );
  const dailyTrend = useMemo(() => computeTrend(dailyAgg), [dailyAgg]);
  const weeklyTrend = useMemo(() => computeTrend(weeklyAgg), [weeklyAgg]);

  function updateGreetingForSchool(nextSchool: School) {
    setMessagesBySchool((prev) => {
      const current = prev[nextSchool.id];
      if (!current || current.length === 0) {
        return { ...prev, [nextSchool.id]: [buildGreeting(nextSchool)] };
      }
      const hasUserMessage = current.some((m) => m.role === "user");
      if (hasUserMessage) return prev;
      const [first, ...rest] = current;
      if (first.role !== "assistant") return prev;
      const updated: Message = {
        ...first,
        content: `Hi! Tell me what you care about at ${nextSchool.name}, and I’ll summarize the student-life sentiment.`,
      };
      return { ...prev, [nextSchool.id]: [updated, ...rest] };
    });
  }

  function escapeCsvValue(value: unknown) {
    const text = value == null ? "" : String(value);
    const needsQuotes = /[",\n]/.test(text);
    const escaped = text.replace(/"/g, '""');
    return needsQuotes ? `"${escaped}"` : escaped;
  }

  function downloadCsv() {
    if (sentimentHistory.length === 0) return;

    const header = [
      "timestamp",
      "school_id",
      "school_name",
      "topic",
      "prompt",
      "model",
      "cache_hit",
      "freshness_days",
      "label",
      "compound",
      "pos",
      "neu",
      "neg",
      "confidence",
      "message",
    ];

    const rows = sentimentHistory.map((item) => [
      new Date(item.createdAt).toISOString(),
      selectedSchool.id,
      selectedSchool.name,
      item.meta?.topic ?? item.topic ?? "",
      item.meta?.prompt ?? "",
      item.meta?.model ?? "",
      item.meta?.cache_hit ? "true" : "false",
      item.meta?.freshness_days ?? "",
      item.sentiment.label,
      item.sentiment.compound.toFixed(4),
      item.sentiment.pos.toFixed(4),
      item.sentiment.neu.toFixed(4),
      item.sentiment.neg.toFixed(4),
      item.confidence ?? "",
      item.text.replace(/\s+/g, " ").trim(),
    ]);

    const csv = [header, ...rows]
      .map((row) => row.map(escapeCsvValue).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `sentiment-${selectedSchool.id}-${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
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
      topic: selectedTopic,
    };

    setMessagesBySchool((prev) => ({
      ...prev,
      [selectedSchoolId]: [...(prev[selectedSchoolId] ?? [buildGreeting(selectedSchool)]), userMsg],
    }));
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
          ...sessionMessages.map((m) => ({ role: m.role, content: m.content })),
          { role: "user", content: text },
        ],
        topic: selectedTopic === "General" ? null : selectedTopic,
        freshness_days: freshnessDays === 0 ? null : freshnessDays,
      }),
    });

    const raw = await res.text();
    let data: {
      reply?: string;
      analysis?: Analysis;
      error?: string;
      meta?: MessageMeta;
      confidence?: Confidence;
    } = {};
    try {
      data = JSON.parse(raw);
    } catch {
      data = { reply: raw };
    }

    const assistantMsg: Message = {
      id: uid(),
      role: "assistant",
      content: data.reply ?? data.error ?? "No reply returned.",
      analysis: data.analysis,
      meta: data.meta,
      confidence: data.confidence,
      topic: selectedTopic,
      createdAt: Date.now(),
    };

    setMessagesBySchool((prev) => ({
      ...prev,
      [selectedSchoolId]: [...(prev[selectedSchoolId] ?? [buildGreeting(selectedSchool)]), assistantMsg],
    }));
    setIsThinking(false);
    scrollToBottom();
  }

  async function runCompare() {
    if (isComparing) return;
    setIsComparing(true);
    setCompareResults([]);
    const topic = selectedTopic === "General" ? "General" : selectedTopic;
    const prompt = topic === "General" ? "student life" : `${topic} student life`;

    try {
      const results = await Promise.all(
        SCHOOLS.map(async (school) => {
          const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              school: { id: school.id, name: school.name },
              messages: [{ role: "user", content: prompt }],
              topic: topic === "General" ? null : topic,
              freshness_days: freshnessDays === 0 ? null : freshnessDays,
            }),
          });

          const raw = await res.text();
          let data: {
            reply?: string;
            analysis?: Analysis;
            error?: string;
            meta?: MessageMeta;
            confidence?: Confidence;
          } = {};
          try {
            data = JSON.parse(raw);
          } catch {
            data = { reply: raw };
          }

          return {
            school,
            reply: data.reply ?? data.error ?? "No reply returned.",
            analysis: data.analysis,
            meta: data.meta,
            confidence: data.confidence,
            createdAt: Date.now(),
          };
        })
      );

      setCompareResults(results);
    } finally {
      setIsComparing(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 overflow-hidden rounded-2xl border border-slate-800 bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={selectedSchool.logoUrl}
                alt={`${selectedSchool.name} logo`}
                className="h-full w-full object-contain p-2"
              />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {selectedSchool.name}
              </h1>
              <div className="text-xs uppercase tracking-[0.2em] text-slate-400">
                Student Life Sentiment
              </div>
            </div>
          </div>
        </header>

        <div className="grid gap-4 md:grid-cols-[320px_1fr]">
          {/* Left: School panel */}
          <aside className="rounded-2xl border border-slate-800 bg-slate-900/30 p-4">
            <h2 className="text-sm font-medium text-slate-200">School</h2>

            <select
              className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-600"
              value={selectedSchoolId}
              onChange={(e) => {
                const nextId = e.target.value;
                setSelectedSchoolId(nextId);
                const nextSchool = SCHOOLS.find((s) => s.id === nextId);
                if (nextSchool) updateGreetingForSchool(nextSchool);
              }}
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
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-slate-200">Sentiment history</div>
                <button
                  type="button"
                  onClick={downloadCsv}
                  disabled={sentimentHistory.length === 0}
                  className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-200 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Download CSV
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {sentimentHistory.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-800 px-3 py-2 text-xs text-slate-500">
                    No sentiment yet
                  </div>
                ) : (
                  sentimentHistory.slice(-6).map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2"
                    >
                      <div className="text-xs text-slate-300">
                        {new Date(item.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                      <div className="text-xs font-semibold capitalize text-slate-100">
                        {item.sentiment.label}
                      </div>
                      <div className="text-xs text-slate-400">
                        {item.sentiment.compound.toFixed(2)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
              <div className="text-sm font-medium text-slate-200">Analytics</div>
              <div className="mt-3 grid gap-3">
                <div className="rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2">
                  <div className="text-xs text-slate-400">Daily avg</div>
                  <div className="mt-1 flex items-center justify-between">
                    <div className="text-sm font-semibold text-slate-100">
                      {dailyAgg.length ? dailyAgg[dailyAgg.length - 1].avg.toFixed(2) : "—"}
                    </div>
                    <div className="text-xs text-slate-400">{dailyTrend}</div>
                  </div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2">
                  <div className="text-xs text-slate-400">Weekly avg</div>
                  <div className="mt-1 flex items-center justify-between">
                    <div className="text-sm font-semibold text-slate-100">
                      {weeklyAgg.length ? weeklyAgg[weeklyAgg.length - 1].avg.toFixed(2) : "—"}
                    </div>
                    <div className="text-xs text-slate-400">{weeklyTrend}</div>
                  </div>
                </div>
              </div>
            </div>
          </aside>

          {/* Right: Chat panel */}
          <main className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900/30">
            <div className="border-b border-slate-800 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCompareMode(false)}
                    className={`rounded-lg px-3 py-1 text-xs font-medium ${
                      compareMode ? "text-slate-400" : "bg-slate-200 text-slate-900"
                    }`}
                  >
                    Chat
                  </button>
                  <button
                    type="button"
                    onClick={() => setCompareMode(true)}
                    className={`rounded-lg px-3 py-1 text-xs font-medium ${
                      compareMode ? "bg-slate-200 text-slate-900" : "text-slate-400"
                    }`}
                  >
                    Compare
                  </button>
                </div>
                <div className="text-xs text-slate-400">
                  School: <span className="text-slate-200">{selectedSchool.name}</span>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {TOPICS.map((topic) => (
                  <button
                    key={topic}
                    type="button"
                    onClick={() => setSelectedTopic(topic)}
                    className={`rounded-full border px-3 py-1 text-xs ${
                      selectedTopic === topic
                        ? "border-slate-200 bg-slate-200 text-slate-900"
                        : "border-slate-700 text-slate-300 hover:border-slate-500"
                    }`}
                  >
                    {topic}
                  </button>
                ))}
                <select
                  value={selectedSubreddit}
                  onChange={(e) => setSelectedSubreddit(e.target.value)}
                  className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-slate-200"
                >
                  {SUBREDDITS.map((sub) => (
                    <option key={sub} value={sub}>
                      {sub}
                    </option>
                  ))}
                </select>
                <select
                  value={freshnessDays}
                  onChange={(e) => setFreshnessDays(Number(e.target.value))}
                  className="ml-auto rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-slate-200"
                >
                  {FRESHNESS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {!compareMode ? (
              <>
                <div className="flex-1 overflow-auto p-4">
                  <div className="space-y-3">
                    {sessionMessages.map((m) => (
                      <div
                        key={m.id}
                        className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                      >
                        {m.role === "assistant" ? (
                          <div className="max-w-[85%] rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-sm leading-relaxed">
                            <RedditStyleHeader subreddit={selectedSubreddit} />
                            <div className="mt-2 text-slate-100">
                              <RedditStyleBody text={m.content} seed={m.id} />
                            </div>
                            {m.analysis && (
                              <SentimentAnalysis
                                analysis={m.analysis}
                                confidence={m.confidence}
                                meta={m.meta}
                              />
                            )}
                          </div>
                        ) : (
                          <div className="max-w-[85%] rounded-2xl bg-slate-200 px-4 py-3 text-sm leading-relaxed text-slate-900">
                            <MessageText text={m.content} />
                          </div>
                        )}
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
                      placeholder={`Ask about ${selectedSchool.name} student life…`}
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
              </>
            ) : (
              <div className="flex-1 overflow-auto p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium">Compare schools</div>
                  <button
                    type="button"
                    onClick={runCompare}
                    disabled={isComparing}
                    className="rounded-lg bg-slate-200 px-3 py-1.5 text-xs font-medium text-slate-900 disabled:opacity-50"
                  >
                    {isComparing ? "Comparing…" : "Generate"}
                  </button>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {compareResults.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-800 p-4 text-xs text-slate-500">
                      No comparison yet
                    </div>
                  ) : (
                    compareResults.map((result) => (
                      <div
                        key={result.school.id}
                        className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-semibold">{result.school.name}</div>
                          {result.confidence && (
                            <div className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                              {result.confidence} confidence
                            </div>
                          )}
                        </div>
                        <div className="mt-2">
                          <RedditStyleHeader subreddit={selectedSubreddit} />
                          <div className="mt-2 text-sm text-slate-200">
                            <RedditStyleBody text={result.reply} seed={result.school.id} />
                          </div>
                        </div>
                        {result.analysis && (
                          <SentimentAnalysis
                            analysis={result.analysis}
                            confidence={result.confidence}
                            meta={result.meta}
                          />
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

function SentimentAnalysis({
  analysis,
  confidence,
  meta,
}: {
  analysis: Analysis;
  confidence?: Confidence;
  meta?: MessageMeta;
}) {
  if (!analysis?.overall_sentiment) return null;

  const { label, compound } = analysis.overall_sentiment;

  const getLabelColor = () => {
    if (label === "positive") return "text-green-400";
    if (label === "negative") return "text-red-400";
    return "text-slate-400";
  };

  return (
    <div className="mt-3 border-t border-slate-700/50 pt-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-slate-400">Sentiment:</span>
        <span className={`font-bold capitalize ${getLabelColor()}`}>{label}</span>
        <span className="text-slate-500">(Score: {compound.toFixed(2)})</span>
        {confidence && (
          <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
            {confidence} confidence
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-slate-400">
        <span>Pos {Math.round(analysis.overall_sentiment.pos * 100)}%</span>
        <span>Neu {Math.round(analysis.overall_sentiment.neu * 100)}%</span>
        <span>Neg {Math.round(analysis.overall_sentiment.neg * 100)}%</span>
      </div>
      {meta?.overview && (
        <div className="mt-2 text-slate-300">
          <span className="text-slate-400">Overview:</span> {meta.overview}
        </div>
      )}
      {meta?.tldr && (
        <div className="mt-2 text-slate-300">
          <span className="text-slate-400">TL;DR:</span> {meta.tldr}
        </div>
      )}
      {meta?.source_note && (
        <div className="mt-2 text-slate-500">{meta.source_note}</div>
      )}
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

function RedditStyleBody({ text, seed }: { text: string; seed: string }) {
  const lines = (text || "").split("\n");
  return (
    <div className="space-y-2">
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("- ")) {
          const quote = trimmed.slice(2).trim();
          return (
            <div key={idx} className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
              <div className="text-[11px] text-slate-400">
                {simulatedUsername(`${seed}-${idx}`)}{" "}

              </div>
              <div className="mt-1 text-sm text-slate-100">{quote}</div>
            </div>
          );
        }

        if (!trimmed) return null;

        return (
          <div key={idx} className="text-sm text-slate-200">
            <MessageText text={line} />
          </div>
        );
      })}
    </div>
  );
}

function RedditStyleHeader({ subreddit }: { subreddit: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
      <span className="rounded-full border border-slate-700 px-2 py-0.5 text-slate-300">
        {subreddit}
      </span>


    </div>
  );
}

type AggregatePoint = {
  key: string;
  avg: number;
  count: number;
};

function aggregateSentiment(
  points: Array<{ createdAt: number; compound: number }>,
  period: "day" | "week"
): AggregatePoint[] {
  const buckets = new Map<string, { sum: number; count: number }>();

  for (const point of points) {
    const date = new Date(point.createdAt);
    const key = period === "day" ? getDayKey(date) : getWeekKey(date);
    const current = buckets.get(key) ?? { sum: 0, count: 0 };
    current.sum += point.compound;
    current.count += 1;
    buckets.set(key, current);
  }

  return Array.from(buckets.entries())
    .map(([key, value]) => ({
      key,
      avg: value.count ? value.sum / value.count : 0,
      count: value.count,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function computeTrend(points: AggregatePoint[]) {
  if (points.length < 2) return "—";
  const last = points[points.length - 1].avg;
  const prev = points[points.length - 2].avg;
  const delta = last - prev;
  if (Math.abs(delta) < 0.05) return "Flat";
  return delta > 0 ? "Up" : "Down";
}

function getDayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getWeekKey(date: Date) {
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${utcDate.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}
