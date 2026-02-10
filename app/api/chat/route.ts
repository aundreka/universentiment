import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Role = "user" | "assistant" | "system";
type Message = { role: Role; content: string };

type ChatRequestBody = {
  school: { id?: string; name: string };
  messages: Message[];
};

function getLastUserText(messages: Message[]) {
  return [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
}

function fallback(schoolName: string, question: string, note?: string) {
  return NextResponse.json({
    reply: `Sentiment snapshot for **${schoolName}** (student life):\n
- Overall vibe: mixed-to-positive\n- Common positives: org culture, community pockets, campus traditions\n- Common negatives: workload stress, admin friction, commute/dorm tradeoffs\n
You asked: "${question}"\n
Tell me what matters most to you (friends, orgs, quiet spaces, nightlife, dorm vs commute), and I’ll tailor the interpretation.`,
    meta: { mode: "stub", note: note ?? null },
  });
}

export async function POST(req: Request) {
  let body: ChatRequestBody | null = null;

  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body?.school?.name || !Array.isArray(body?.messages)) {
    return NextResponse.json(
      { error: "Expected { school: { name }, messages: [{role, content}, ...] }" },
      { status: 400 }
    );
  }

  const schoolName = body.school.name;
  const question = getLastUserText(body.messages);

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("[/api/chat] Missing OPENROUTER_API_KEY in .env.local");
    return fallback(schoolName, question, "Missing OPENROUTER_API_KEY in .env.local");
  }

  const model = "arcee-ai/trinity-large-preview:free";

  const system = `You summarize student-life sentiment about colleges.
Focus on community, orgs, social scene, workload-life balance, dorm/commute, admin experience.
Present as themes from discussion, not absolute truth. Keep it practical.`;

  // Convert your conversation to OpenAI-style messages
  const messages = [
    { role: "system" as const, content: system },
    ...body.messages.map((m) => ({ role: m.role, content: m.content })),
    {
      role: "user" as const,
      content: `School: ${schoolName}\n\nStudent question: ${question}\n\nGive:\n1) Overall sentiment (positive/mixed/negative) + brief justification\n2) 4–6 themes (bullets)\n3) Who might thrive vs who might struggle\n4) 3 follow-up questions to tailor the answer`,
    },
  ];

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",

        // Optional but recommended by OpenRouter for attribution/rankings :contentReference[oaicite:4]{index=4}
        "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "http://localhost:3000",
        "X-Title": process.env.OPENROUTER_APP_NAME ?? "College Sentiment Guide",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.4,
        max_tokens: 500,
      }),
    });

    const text = await res.text();

    if (!res.ok) {
      console.error("[/api/chat] OpenRouter error status:", res.status);
      console.error("[/api/chat] OpenRouter error body:", text);
      return fallback(schoolName, question, `OpenRouter error ${res.status}: ${text.slice(0, 220)}`);
    }

    const data = JSON.parse(text) as any;

    const reply: string =
      data?.choices?.[0]?.message?.content ??
      data?.choices?.[0]?.delta?.content ??
      "";

    if (!reply) {
      console.error("[/api/chat] OpenRouter returned empty reply:", data);
      return fallback(schoolName, question, "OpenRouter returned empty reply");
    }

    return NextResponse.json({
      reply,
      meta: { mode: "openrouter", model },
    });
  } catch (err: any) {
    console.error("[/api/chat] Exception calling OpenRouter:", err?.message ?? err);
    return fallback(schoolName, question, `Exception: ${err?.message ?? String(err)}`);
  }
}
