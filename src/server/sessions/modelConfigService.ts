import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { OmpModelApi, OmpModelDefinition, OmpModelsConfig, OmpModelsConfigResponse, OmpProviderAuth, OmpProviderConfig, OmpProviderDiscoveryType } from "../../shared/apiTypes.js";

export interface RefreshableModelRegistry {
  refresh(): void | Promise<void>;
}

export class OmpModelConfigService {
  readonly path: string;

  constructor(private readonly agentDir: string, private readonly modelRegistry: RefreshableModelRegistry) {
    this.path = join(agentDir, "models.yml");
  }

  async getConfig(): Promise<OmpModelsConfigResponse> {
    const exists = await fileExists(this.path);
    if (!exists) return { path: this.path, exists, config: {} };
    return { path: this.path, exists, config: parseModelsConfig(await readFile(this.path, "utf8")) };
  }

  async saveConfig(config: unknown): Promise<OmpModelsConfigResponse> {
    const normalized = normalizeModelsConfig(config);
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, stringifyYaml(normalized, { lineWidth: 0 }), "utf8");
    await this.modelRegistry.refresh();
    return { path: this.path, exists: true, config: normalized };
  }
}

function parseModelsConfig(text: string): OmpModelsConfig {
  if (text.trim() === "") return {};
  return normalizeModelsConfig(parseYaml(text));
}

function normalizeModelsConfig(value: unknown): OmpModelsConfig {
  const record = optionalRecord(value, "models config");
  const config: OmpModelsConfig = { ...record };
  if (record["providers"] !== undefined) config.providers = normalizeProviders(record["providers"]);
  if (record["equivalence"] !== undefined) config.equivalence = normalizeEquivalence(record["equivalence"]);
  return config;
}

function normalizeProviders(value: unknown): Record<string, OmpProviderConfig> {
  const providers = requiredRecord(value, "providers");
  const result: Record<string, OmpProviderConfig> = {};
  for (const [providerId, provider] of Object.entries(providers)) {
    if (providerId.trim() === "") throw new Error("Provider id cannot be empty");
    result[providerId] = normalizeProviderConfig(provider, providerId);
  }
  return result;
}

function normalizeProviderConfig(value: unknown, providerId: string): OmpProviderConfig {
  const record = requiredRecord(value, `provider ${providerId}`);
  const config: OmpProviderConfig = { ...record };
  const baseUrl = optionalString(record["baseUrl"], `provider ${providerId}.baseUrl`);
  const apiKey = optionalString(record["apiKey"], `provider ${providerId}.apiKey`);
  if (baseUrl !== undefined) config.baseUrl = baseUrl;
  if (apiKey !== undefined) config.apiKey = apiKey;
  const api = optionalModelApi(record["api"], `provider ${providerId}.api`);
  if (api !== undefined) config.api = api;
  const auth = optionalProviderAuth(record["auth"], `provider ${providerId}.auth`);
  if (auth !== undefined) config.auth = auth;
  if (record["headers"] !== undefined) config.headers = normalizeStringRecord(record["headers"], `provider ${providerId}.headers`);
  if (record["discovery"] !== undefined) config.discovery = normalizeDiscovery(record["discovery"], providerId);
  if (record["models"] !== undefined) config.models = normalizeModels(record["models"], providerId);
  if (record["modelOverrides"] !== undefined) config.modelOverrides = requiredRecord(record["modelOverrides"], `provider ${providerId}.modelOverrides`);
  if (record["compat"] !== undefined) config.compat = requiredRecord(record["compat"], `provider ${providerId}.compat`);
  if (record["disableStrictTools"] !== undefined) config.disableStrictTools = optionalBoolean(record["disableStrictTools"], `provider ${providerId}.disableStrictTools`);
  if (record["authHeader"] !== undefined) config.authHeader = optionalBoolean(record["authHeader"], `provider ${providerId}.authHeader`);
  return config;
}

function normalizeModels(value: unknown, providerId: string): OmpModelDefinition[] {
  if (!Array.isArray(value)) throw new Error(`provider ${providerId}.models must be an array`);
  return value.map((item, index) => normalizeModelDefinition(item, `provider ${providerId}.models[${String(index)}]`));
}

function normalizeModelDefinition(value: unknown, label: string): OmpModelDefinition {
  const record = requiredRecord(value, label);
  const id = requireNonEmptyString(record["id"], `${label}.id`);
  const model: OmpModelDefinition = { ...record, id };
  const name = optionalString(record["name"], `${label}.name`);
  if (name !== undefined) model.name = name;
  const api = optionalModelApi(record["api"], `${label}.api`);
  if (api !== undefined) model.api = api;
  if (record["reasoning"] !== undefined) model.reasoning = optionalBoolean(record["reasoning"], `${label}.reasoning`);
  if (record["input"] !== undefined) model.input = normalizeModelInput(record["input"], `${label}.input`);
  const contextWindow = optionalNumber(record["contextWindow"], `${label}.contextWindow`);
  const maxTokens = optionalNumber(record["maxTokens"], `${label}.maxTokens`);
  if (contextWindow !== undefined) model.contextWindow = contextWindow;
  if (maxTokens !== undefined) model.maxTokens = maxTokens;
  if (record["cost"] !== undefined) model.cost = normalizeCost(record["cost"], `${label}.cost`);
  const contextPromotionTarget = optionalString(record["contextPromotionTarget"], `${label}.contextPromotionTarget`);
  if (contextPromotionTarget !== undefined) model.contextPromotionTarget = contextPromotionTarget;
  return model;
}

function normalizeDiscovery(value: unknown, providerId: string): NonNullable<OmpProviderConfig["discovery"]> {
  const record = requiredRecord(value, `provider ${providerId}.discovery`);
  return { type: requireDiscoveryType(record["type"], `provider ${providerId}.discovery.type`) };
}

function normalizeModelInput(value: unknown, label: string): ("text" | "image")[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item) => requireModelInput(item, label));
}

function normalizeCost(value: unknown, label: string): NonNullable<OmpModelDefinition["cost"]> {
  const record = requiredRecord(value, label);
  const cost: NonNullable<OmpModelDefinition["cost"]> = { ...record };
  const input = optionalNumber(record["input"], `${label}.input`);
  const output = optionalNumber(record["output"], `${label}.output`);
  const cacheRead = optionalNumber(record["cacheRead"], `${label}.cacheRead`);
  const cacheWrite = optionalNumber(record["cacheWrite"], `${label}.cacheWrite`);
  if (input !== undefined) cost.input = input;
  if (output !== undefined) cost.output = output;
  if (cacheRead !== undefined) cost.cacheRead = cacheRead;
  if (cacheWrite !== undefined) cost.cacheWrite = cacheWrite;
  return cost;
}

function normalizeEquivalence(value: unknown): NonNullable<OmpModelsConfig["equivalence"]> {
  const record = requiredRecord(value, "equivalence");
  const equivalence: NonNullable<OmpModelsConfig["equivalence"]> = { ...record };
  if (record["overrides"] !== undefined) equivalence.overrides = normalizeStringRecord(record["overrides"], "equivalence.overrides");
  if (record["exclude"] !== undefined) equivalence.exclude = normalizeStringArray(record["exclude"], "equivalence.exclude");
  return equivalence;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}

function optionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a number`);
  return value;
}

function optionalBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function optionalModelApi(value: unknown, label: string): OmpModelApi | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (!isModelApi(value)) throw new Error(`${label} has unsupported value`);
  return value;
}

function optionalProviderAuth(value: unknown, label: string): OmpProviderAuth | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (!isProviderAuth(value)) throw new Error(`${label} has unsupported value`);
  return value;
}

function requireDiscoveryType(value: unknown, label: string): OmpProviderDiscoveryType {
  if (!isDiscoveryType(value)) throw new Error(`${label} has unsupported value`);
  return value;
}

function requireModelInput(value: unknown, label: string): "text" | "image" {
  if (value !== "text" && value !== "image") throw new Error(`${label} has unsupported value`);
  return value;
}

function isModelApi(value: unknown): value is OmpModelApi {
  return value === "openai-completions" || value === "openai-responses" || value === "openai-codex-responses" || value === "azure-openai-responses" || value === "anthropic-messages" || value === "google-generative-ai" || value === "google-vertex";
}

function isProviderAuth(value: unknown): value is OmpProviderAuth {
  return value === "apiKey" || value === "none" || value === "oauth";
}

function isDiscoveryType(value: unknown): value is OmpProviderDiscoveryType {
  return value === "ollama" || value === "llama.cpp" || value === "lm-studio" || value === "openai-models-list" || value === "proxy";
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string`);
  return value;
}

function normalizeStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item) => requireNonEmptyString(item, label));
}

function normalizeStringRecord(value: unknown, label: string): Record<string, string> {
  const record = requiredRecord(value, label);
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(record)) {
    if (typeof item !== "string") throw new Error(`${label}.${key} must be a string`);
    result[key] = item;
  }
  return result;
}

function optionalRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  return requiredRecord(value, label);
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
