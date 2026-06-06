/* eslint-disable @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-unnecessary-type-assertion -- OMP and pi-web currently import structurally compatible SDK types from different package namespaces; this adapter is the isolated interop boundary. */
import { dirname } from "node:path";
import type { Api, Model } from "@oh-my-pi/pi-ai";
import type {
  AgentSession as OmpAgentSession,
  CreateAgentSessionResult,
  ModelRegistry as OmpModelRegistry,
  SessionInfo as OmpSessionInfo,
} from "@oh-my-pi/pi-coding-agent";
import type { ClientSessionStatus, ClientThinkingLevel } from "../types.js";
import type {
  CreateAgentRuntimeOptions,
  PiAgentSession,
  PiSessionManager,
  PiSessionManagerGateway,
  PiSessionProvider,
  PiSessionRuntime,
} from "./piSessionService.js";


type OmpModel = Model<Api>;
type OmpRuntimeResult = CreateAgentSessionResult;
type OmpSdk = typeof import("@oh-my-pi/pi-coding-agent");

export interface OmpSessionProviderOptions {
  agentDir?: string;
}

async function importOmpSdk(): Promise<OmpSdk> {
  try {
    return await import("@oh-my-pi/pi-coding-agent");
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes("Cannot find package 'bun'")) {
      throw new Error("OMP SDK requires Bun runtime APIs. Start pi-web-sessiond with Bun before setting PI_WEB_AGENT_RUNTIME=omp.", { cause: error });
    }
    throw error;
  }
}

export async function createOmpSessionProvider(options: OmpSessionProviderOptions = {}): Promise<PiSessionProvider> {
  const sdk = await importOmpSdk();
  const agentDir = options.agentDir ?? sdk.getAgentDir();
  const authStorage = await sdk.discoverAuthStorage(agentDir);
  const modelRegistry = new sdk.ModelRegistry(authStorage);
  await modelRegistry.refresh();
  return new OmpSessionProvider(sdk, agentDir, modelRegistry as unknown as PiSessionProvider["modelRegistry"]);
}

class OmpSessionProvider implements PiSessionProvider {
  readonly sessionManager: PiSessionManagerGateway;

  constructor(private readonly sdk: OmpSdk, readonly agentDir: string, readonly modelRegistry: PiSessionProvider["modelRegistry"]) {
    this.sessionManager = new OmpSessionManagerGateway(sdk.SessionManager, agentDir);
  }

  async createAgentRuntime(options: CreateAgentRuntimeOptions): Promise<PiSessionRuntime> {
    const sessionManager = options.sessionManager;
    if (!(sessionManager instanceof this.sdk.SessionManager)) throw new Error("OMP runtime creation requires an OMP SessionManager");
    const result = await this.sdk.createAgentSession({
      cwd: options.cwd,
      agentDir: this.agentDir,
      modelRegistry: this.modelRegistry as unknown as OmpModelRegistry,
      authStorage: (this.modelRegistry as unknown as OmpModelRegistry).authStorage,
      sessionManager,
      hasUI: false,
    });
    return new OmpSessionRuntime(options.cwd, result);
  }
}

class OmpSessionManagerGateway implements PiSessionManagerGateway {
  constructor(private readonly SessionManager: OmpSdk["SessionManager"], private readonly agentDir: string) {}

  async list(cwd: string) {
    const sessions = await this.SessionManager.list(cwd, this.sessionDir(cwd));
    return sessions.map(sessionInfoToListEntry);
  }

  create(cwd: string): PiSessionManager {
    return this.SessionManager.create(cwd, this.sessionDir(cwd)) as unknown as PiSessionManager;
  }

  async listAll() {
    const sessions = await this.SessionManager.listAll();
    return sessions.map(sessionInfoToListEntry);
  }

  open(path: string): PiSessionManager {
    return this.SessionManager.open(path, dirname(path)) as unknown as PiSessionManager;
  }

  private sessionDir(cwd: string): string {
    return this.SessionManager.getDefaultSessionDir(cwd, this.agentDir);
  }
}

class OmpSessionRuntime implements PiSessionRuntime {
  readonly session: PiAgentSession;
  private rebindSession: ((session: PiAgentSession) => Promise<void>) | undefined;

  constructor(readonly cwd: string, private readonly result: OmpRuntimeResult) {
    this.session = new OmpAgentSessionAdapter(result.session);
  }

  setRebindSession(rebindSession?: (session: PiAgentSession) => Promise<void>): void {
    this.rebindSession = rebindSession;
  }

  async fork(entryId: string, options?: { position?: "before" | "at" }): Promise<{ cancelled: boolean; selectedText?: string }> {
    if (options?.position === "at") {
      const completed = await this.result.session.fork();
      if (!completed) return { cancelled: true };
      await this.rebindSession?.(this.session);
      return { cancelled: false };
    }

    const result = await this.result.session.branch(entryId);
    if (!result.cancelled) await this.rebindSession?.(this.session);
    return { cancelled: result.cancelled, selectedText: result.selectedText };
  }

  async dispose(): Promise<void> {
    await this.result.session.dispose();
  }
}

class OmpAgentSessionAdapter implements PiAgentSession {
  constructor(private readonly session: OmpAgentSession) {}

  get modelRegistry(): PiAgentSession["modelRegistry"] {
    return this.session.modelRegistry as unknown as PiAgentSession["modelRegistry"];
  }

  get sessionManager(): PiSessionManager {
    return this.session.sessionManager as unknown as PiSessionManager;
  }

  get scopedModels(): PiAgentSession["scopedModels"] {
    return this.session.scopedModels.map((scoped) => {
      const thinkingLevel = toClientThinkingLevel(scoped.thinkingLevel);
      return {
        model: scoped.model as unknown as NonNullable<PiAgentSession["model"]>,
        ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
      };
    });
  }

  get sessionId(): string {
    return this.session.sessionId;
  }

  get sessionFile(): string | undefined {
    return this.session.sessionFile;
  }

  get sessionName(): string | undefined {
    return this.session.sessionName;
  }

  get messages(): readonly unknown[] {
    return this.session.messages;
  }

  get model(): PiAgentSession["model"] {
    return this.session.model as unknown as PiAgentSession["model"];
  }

  get thinkingLevel(): ClientThinkingLevel {
    return toClientThinkingLevel(this.session.thinkingLevel) ?? "off";
  }

  get isStreaming(): boolean {
    return this.session.isStreaming || this.session.hasPostPromptWork;
  }

  get isCompacting(): boolean {
    return this.session.isCompacting;
  }

  get isBashRunning(): boolean {
    return this.session.isBashRunning;
  }

  get pendingMessageCount(): number {
    return this.session.queuedMessageCount;
  }

  get extensionRunner(): PiAgentSession["extensionRunner"] {
    return {
      getRegisteredCommands: () => this.session.customCommands.map((command) => ({
        invocationName: command.command.name,
        description: command.command.description,
      })),
    };
  }

  get promptTemplates(): PiAgentSession["promptTemplates"] {
    return this.session.promptTemplates;
  }

  get resourceLoader(): PiAgentSession["resourceLoader"] {
    return { getSkills: () => ({ skills: this.session.skills }) };
  }

  subscribe(listener: (event: unknown) => void): () => void {
    return this.session.subscribe(listener);
  }

  async compact(instructions?: string): Promise<{ summary: string; tokensBefore: number }> {
    const result = await this.session.compact(instructions);
    return {
      summary: result.summary,
      tokensBefore: result.tokensBefore,
    };
  }

  getUserMessagesForForking(): readonly { entryId: string; text: string }[] {
    return this.session.getUserMessagesForBranching();
  }

  getSessionStats(): PiAgentSession["getSessionStats"] extends () => infer TResult ? TResult : never {
    return this.session.getSessionStats() as PiAgentSession["getSessionStats"] extends () => infer TResult ? TResult : never;
  }

  getContextUsage(): ClientSessionStatus["contextUsage"] | undefined {
    return this.session.getContextUsage() as ClientSessionStatus["contextUsage"] | undefined;
  }

  prompt(text: string, options?: { streamingBehavior?: "steer" | "followUp" }): Promise<void> {
    return this.session.prompt(text, options);
  }

  executeBash(command: string, onChunk?: (chunk: string) => void, options?: { excludeFromContext?: boolean }) {
    return this.session.executeBash(command, onChunk, options);
  }

  abort(): Promise<void> {
    return this.session.abort();
  }

  clearQueue(): { steering: string[]; followUp: string[] } {
    return this.session.clearQueue();
  }

  getSteeringMessages(): readonly string[] {
    return this.session.getQueuedMessages().steering;
  }

  getFollowUpMessages(): readonly string[] {
    return this.session.getQueuedMessages().followUp;
  }

  setModel(model: PiAgentSession["model"]): Promise<void> {
    if (model === undefined) throw new Error("Model is required");
    return this.session.setModel(model as unknown as OmpModel);
  }

  async cycleModel(direction?: "forward" | "backward"): Promise<{ model: NonNullable<PiAgentSession["model"]> } | undefined> {
    const result = await this.session.cycleModel(direction);
    return result === undefined ? undefined : { model: result.model as unknown as NonNullable<PiAgentSession["model"]> };
  }

  getAvailableThinkingLevels(): ClientThinkingLevel[] {
    return ["off", ...this.session.getAvailableThinkingLevels().map((level) => toClientThinkingLevel(level)).filter(isDefined)];
  }

  setThinkingLevel(level: ClientThinkingLevel): void {
    this.session.setThinkingLevel((level === "off" ? undefined : level) as Parameters<OmpAgentSession["setThinkingLevel"]>[0]);
  }

  cycleThinkingLevel(): ClientThinkingLevel | undefined {
    return toClientThinkingLevel(this.session.cycleThinkingLevel());
  }

  setSessionName(name: string): void {
    void this.session.setSessionName(name);
  }
}

function sessionInfoToListEntry(session: OmpSessionInfo) {
  return {
    id: session.id,
    path: session.path,
    cwd: session.cwd,
    created: session.created,
    modified: session.modified,
    messageCount: session.messageCount,
    firstMessage: session.firstMessage,
    allMessagesText: session.allMessagesText,
    ...(session.title === undefined ? {} : { name: session.title }),
    ...(session.parentSessionPath === undefined ? {} : { parentSessionPath: session.parentSessionPath }),
  };
}

function toClientThinkingLevel(level: unknown): ClientThinkingLevel | undefined {
  switch (level) {
    case "off":
    case "minimal":
    case "low":
    case "medium":
    case "high":
    case "xhigh":
      return level;
    default:
      return undefined;
  }
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
