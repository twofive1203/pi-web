import type { Context, Message, Model, SimpleStreamOptions } from "@oh-my-pi/pi-ai";

const SESSION_NAME_TIMEOUT_MS = 10_000;
const SESSION_NAME_MAX_INPUT_CHARS = 4_000;
const SESSION_NAME_MAX_LENGTH = 60;
const FALLBACK_SESSION_NAME_MAX_WORDS = 6;

interface ModelLike {
  api?: string;
}

interface AssistantMessageLike {
  content: readonly unknown[];
}

type SessionNameEvent =
  | { type: "text_delta"; delta: string }
  | { type: "done"; message: AssistantMessageLike }
  | { type: "error" }
  | { type: string };

interface PiAiRuntimeModule {
  streamSimple(model: Model, context: Context, options: SimpleStreamOptions): AsyncIterable<SessionNameEvent>;
}

export async function generateShortSessionName(modelRegistry: unknown, model: ModelLike, firstMessage: string): Promise<string | undefined> {
  if (!isOmpModel(model)) return undefined;

  const context: Context = {
    systemPrompt: ["Generate a concise title for a coding-agent chat session. Return only the title, with no quotes or punctuation wrapper."],
    messages: [userMessage(`Create a 2-6 word title for this request:\n\n${truncateInput(firstMessage)}`)],
  };
  const options = await sessionNameStreamOptions(modelRegistry, model);
  if (options === undefined) return undefined;

  const piAi = await importPiAiRuntimeModule();
  if (piAi === undefined) return undefined;
  const stream = piAi.streamSimple(model, context, options);

  let streamedText = "";
  let finalMessage: AssistantMessageLike | undefined;
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

function userMessage(content: string): Message {
  return { role: "user", content, timestamp: Date.now() };
}

function textFromAssistant(message: AssistantMessageLike): string {
  return message.content
    .filter(isTextPart)
    .map((part) => part.text)
    .join("");
}

async function sessionNameStreamOptions(modelRegistry: unknown, model: Model): Promise<SimpleStreamOptions | undefined> {
  if (!hasGetApiKey(modelRegistry)) return undefined;
  const apiKey = await modelRegistry.getApiKey(model);
  return apiKey === undefined ? undefined : {
    maxTokens: 24,
    disableReasoning: true,
    signal: AbortSignal.timeout(SESSION_NAME_TIMEOUT_MS),
    apiKey,
  };
}

async function importPiAiRuntimeModule(): Promise<PiAiRuntimeModule | undefined> {
  const module: unknown = await import("@oh-my-pi/pi-ai");
  return isPiAiRuntimeModule(module) ? module : undefined;
}

function isPiAiRuntimeModule(value: unknown): value is PiAiRuntimeModule {
  return typeof value === "object" && value !== null && "streamSimple" in value && typeof value.streamSimple === "function";
}

function hasGetApiKey(value: unknown): value is { getApiKey(model: Model): Promise<string | undefined> } {
  return typeof value === "object" && value !== null && "getApiKey" in value && typeof value.getApiKey === "function";
}

function isOmpModel(value: ModelLike): value is Model {
  return typeof value.api === "string"
    && "id" in value && typeof value.id === "string"
    && "provider" in value && typeof value.provider === "string"
    && "name" in value && typeof value.name === "string"
    && "baseUrl" in value && typeof value.baseUrl === "string"
    && "input" in value && Array.isArray(value.input)
    && "cost" in value && typeof value.cost === "object" && value.cost !== null
    && "maxTokens" in value && typeof value.maxTokens === "number";
}

function isTextPart(value: unknown): value is { type: "text"; text: string } {
  return typeof value === "object" && value !== null && "type" in value && value.type === "text" && "text" in value && typeof value.text === "string";
}

function truncateInput(value: string): string {
  return value.length <= SESSION_NAME_MAX_INPUT_CHARS ? value : `${value.slice(0, SESSION_NAME_MAX_INPUT_CHARS)}…`;
}
