import Anthropic from "@anthropic-ai/sdk";
import { searchCorpus, type CorpusHit, refreshChatCorpus } from "./corpus";

const MODEL = "claude-opus-4-7";

const SYSTEM = `You are an assistant that answers questions about a coding bot
("42n-bot") using ONLY the structured run summaries provided.

Rules:
- Be terse. The user wants quick answers about what the bot did.
- Cite specific run IDs you used, e.g. "(run #142)".
- If the corpus doesn't cover the question, say so plainly — do not invent runs.
- Never invent PR numbers, cost figures, or status transitions.`;

export type Citation = { runId: number; title: string; snippet: string };

export type ChatAnswer = {
  answer: string;
  citations: Citation[];
};

export async function answerChat(question: string): Promise<ChatAnswer> {
  // Lazy: refresh corpus on every call so newly-completed runs become
  // queryable immediately. Cheap (only new runs get embedded).
  try {
    await refreshChatCorpus();
  } catch {/* ignore */}

  const hits = await searchCorpus(question, 8);

  if (!hits.length) {
    return {
      answer:
        "I don't have any run history yet. Once the bot has completed at least one run, I can answer questions about it.",
      citations: [],
    };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      answer:
        "ANTHROPIC_API_KEY is not set, so I can't synthesize an answer. Here's the most relevant run summary I found:\n\n" +
        hits[0].text,
      citations: hits.slice(0, 3).map(toCit),
    };
  }

  const ctx = hits
    .map((h, i) => `<run id="${h.runId ?? h.chunkId}" score=${h.score.toFixed(2)} index="S${i + 1}">\n${h.text}\n</run>`)
    .join("\n\n");

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 700,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `<context>\n${ctx}\n</context>\n\nQuestion: ${question}`,
      },
    ],
  });
  const answer = response.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n")
    .trim();

  return { answer, citations: hits.slice(0, 5).map(toCit) };
}

function toCit(h: CorpusHit): Citation {
  const firstLine = h.text.split("\n")[0].replace(/^# /, "");
  return {
    runId: h.runId ?? h.chunkId,
    title: firstLine,
    snippet: h.text.split("\n").slice(0, 4).join("\n").slice(0, 280),
  };
}
