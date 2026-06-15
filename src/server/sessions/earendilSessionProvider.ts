import { join } from "node:path";
import {
  AuthStorage,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  createEditToolDefinition,
  defineTool,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  type CreateAgentSessionRuntimeFactory,
  type EditToolDetails,
} from "@earendil-works/pi-coding-agent";
import type { CreateAgentRuntimeOptions, PiSessionProvider, PiSessionRuntime } from "./piSessionService.js";
import { computeEditPreview, type EditPreviewResult } from "./editPreview.js";

interface EarendilSessionProviderOptions {
  agentDir?: string;
}

type PiWebEditToolDetails = EditToolDetails | { preview: EditPreviewResult } | undefined;

export function createEarendilSessionProvider(options: EarendilSessionProviderOptions = {}): PiSessionProvider {
  const agentDir = options.agentDir ?? getAgentDir();
  const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
  const modelRegistry = ModelRegistry.create(authStorage, join(agentDir, "models.json"));
  const createRuntime = createDefaultRuntimeFactory(authStorage, modelRegistry);
  return {
    agentDir,
    modelRegistry,
    sessionManager: SessionManager,
    createAgentRuntime: (runtimeOptions) => createEarendilAgentRuntime(createRuntime, runtimeOptions),
  };
}

function createEarendilAgentRuntime(createRuntime: CreateAgentSessionRuntimeFactory, options: CreateAgentRuntimeOptions): Promise<PiSessionRuntime> {
  if (!(options.sessionManager instanceof SessionManager)) throw new Error("Earendil runtime creation requires an SDK SessionManager");
  return createAgentSessionRuntime(createRuntime, { ...options, sessionManager: options.sessionManager });
}

function createDefaultRuntimeFactory(authStorage: AuthStorage, modelRegistry: ModelRegistry): CreateAgentSessionRuntimeFactory {
  return async ({ cwd, agentDir, sessionManager, sessionStartEvent }) => {
    const services = await createAgentSessionServices({ cwd, agentDir, authStorage, modelRegistry });
    const customTools = [createPiWebEditToolDefinition(cwd)];
    const sessionOptions = sessionStartEvent === undefined
      ? { services, sessionManager, customTools }
      : { services, sessionManager, sessionStartEvent, customTools };
    const result = await createAgentSessionFromServices(sessionOptions);
    return { ...result, services, diagnostics: services.diagnostics };
  };
}

function createPiWebEditToolDefinition(cwd: string) {
  const editTool = createEditToolDefinition(cwd);
  return defineTool<typeof editTool.parameters, PiWebEditToolDetails>({
    name: editTool.name,
    label: editTool.label,
    description: editTool.description,
    ...(editTool.promptSnippet === undefined ? {} : { promptSnippet: editTool.promptSnippet }),
    ...(editTool.promptGuidelines === undefined ? {} : { promptGuidelines: editTool.promptGuidelines }),
    parameters: editTool.parameters,
    ...(editTool.renderShell === undefined ? {} : { renderShell: editTool.renderShell }),
    ...(editTool.prepareArguments === undefined ? {} : { prepareArguments: editTool.prepareArguments }),
    ...(editTool.executionMode === undefined ? {} : { executionMode: editTool.executionMode }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const preview = await computeEditPreview(params.path, params.edits, cwd);
      if (signal?.aborted !== true) {
        onUpdate?.({ content: [{ type: "text", text: "Edit preview computed." }], details: { preview } });
      }
      return editTool.execute(toolCallId, params, signal, onUpdate, ctx);
    },
  });
}
