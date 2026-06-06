/* eslint-disable @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-unnecessary-type-assertion -- Runtime-neutral title generation bridges structurally compatible Earendil and OMP SDK types. */
import { getApiProvider, type Api, type AssistantMessage, type Model, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";

const SESSION_NAME_TIMEOUT_MS = 10_000;
const SESSION_NAME_MAX_INPUT_CHARS = 4_000;
const SESSION_NAME_MAX_LENGTH = 60;
const FALLBACK_SESSION_NAME_MAX_WORDS = 6;

type SessionNameEvent =
  | { type: "text_delta"; delta: string }
  | { type: "done"; message: AssistantMessage }
  | { type: "error" }
  | { type: string };

export async function generateShortSessionName<TApi extends Api>(modelRegistry: ModelRegistry, model: Model<TApi>, firstMessage: string): Promise<string | undefined> {
  const context = {
    systemPrompt: "Generate a concise title for a coding-agent chat session. Return only the title, with no quotes or punctuation wrapper.",
    messages: [{
      role: "user" as const,
      content: `Create a 2-6 word title for this request:\n\n${truncateInput(firstMessage)}`,
      timestamp: Date.now(),
    }],
  };
  const options = await sessionNameStreamOptions(modelRegistry, model);
  if (options === undefined) return undefined;

  const oldProvider = typeof (modelRegistry as unknown as { getApiKeyAndHeaders?: unknown }).getApiKeyAndHeaders === "function"
    ? getApiProvider(model.api)
    : undefined;
  const stream: AsyncIterable<SessionNameEvent> = oldProvider === undefined
    ? await ompSessionNameStream(model, context, options)
    : oldProvider.streamSimple(model, context, options) as AsyncIterable<SessionNameEvent>;

  let streamedText = "";
  let finalMessage: AssistantMessage | undefined;
  for await (const event of stream) {
    if (event.type === "text_delta" && "delta" in event && typeof event.delta === "string") streamedText += event.delta;
    if (event.type === "done" && "message" in event) finalMessage = event.message;
    if (event.type === "error") return undefined;
  }

  return cleanSessionName(finalMessage === undefined ? streamedText : textFromAssistant(finalMessage));
}

export function fallbackSessionName(firstMessage: unknown): string | undefined {
  if (typeof firstMessage !== "string") return undefined;

  return cleanSessionName(firstMessage
    .replace(/<skill name="[^"]+" location="[^"]+">[\s\S]*?<\/skill>/g, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`*_#[\](){}<>]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, FALLBACK_SESSION_NAME_MAX_WORDS)
    .join(" "));
}

export function cleanSessionName(value: string): string | undefined {
  const title = (value.split("\n", 1)[0] ?? "")
    .replace(/^\s*(title|session title)\s*:\s*/i, "")
    .replace(/^\s*["'`]+|["'`.]+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SESSION_NAME_MAX_LENGTH)
    .trim();
  return title === "" ? undefined : title;
}

function textFromAssistant(message: AssistantMessage): string {
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

async function sessionNameStreamOptions<TApi extends Api>(modelRegistry: ModelRegistry, model: Model<TApi>): Promise<SimpleStreamOptions | undefined> {
  const base = {
    maxTokens: 24,
    reasoning: "minimal" as const,
    signal: AbortSignal.timeout(SESSION_NAME_TIMEOUT_MS),
  };
  const oldRegistry = modelRegistry as unknown as {
    getApiKeyAndHeaders?(model: Model<TApi>): Promise<{ ok: true; apiKey?: string; headers?: Record<string, string> } | { ok: false }>;
  };
  if (typeof oldRegistry.getApiKeyAndHeaders === "function") {
    const auth = await oldRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok) return undefined;
    return {
      ...base,
      ...(auth.apiKey === undefined ? {} : { apiKey: auth.apiKey }),
      ...(auth.headers === undefined ? {} : { headers: auth.headers }),
    };
  }

  const ompRegistry = modelRegistry as unknown as {
    getApiKey?(model: unknown): Promise<string | undefined>;
  };
  if (typeof ompRegistry.getApiKey !== "function") return undefined;
  const apiKey = await ompRegistry.getApiKey(model);
  return apiKey === undefined ? undefined : { ...base, apiKey };
}

async function ompSessionNameStream<TApi extends Api>(model: Model<TApi>, context: unknown, options: SimpleStreamOptions): Promise<AsyncIterable<SessionNameEvent>> {
  const piAi = await import("@oh-my-pi/pi-ai");
  return piAi.streamSimple(model as never, context as never, options as never) as AsyncIterable<SessionNameEvent>;
}

function truncateInput(value: string): string {
  return value.length <= SESSION_NAME_MAX_INPUT_CHARS ? value : `${value.slice(0, SESSION_NAME_MAX_INPUT_CHARS)}…`;
}
