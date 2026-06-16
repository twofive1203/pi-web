import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { OmpModelSettingsConfig, OmpModelSettingsResponse, OmpThinkingLevel } from "../../shared/apiTypes.js";

const BUDGET_KEYS = ["minimal", "low", "medium", "high", "xhigh"] as const;

export interface RefreshableModelSettingsRegistry {
  refresh(): void | Promise<void>;
}

export class OmpModelSettingsService {
  readonly path: string;

  constructor(private readonly agentDir: string, private readonly modelRegistry: RefreshableModelSettingsRegistry) {
    this.path = join(agentDir, "config.yml");
  }

  async getSettings(): Promise<OmpModelSettingsResponse> {
    const exists = await fileExists(this.path);
    if (!exists) return { path: this.path, exists, config: {} };
    return { path: this.path, exists, config: parseModelSettings(await readFile(this.path, "utf8")) };
  }

  async saveSettings(config: unknown): Promise<OmpModelSettingsResponse> {
    const normalized = normalizeModelSettings(config);
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, stringifyYaml(normalized, { lineWidth: 0 }), "utf8");
    await this.modelRegistry.refresh();
    return { path: this.path, exists: true, config: normalized };
  }
}

function parseModelSettings(text: string): OmpModelSettingsConfig {
  if (text.trim() === "") return {};
  return normalizeModelSettings(parseYaml(text));
}

function normalizeModelSettings(value: unknown): OmpModelSettingsConfig {
  const record = optionalRecord(value, "model settings");
  const config: OmpModelSettingsConfig = { ...record };
  if (record["modelRoles"] !== undefined) config.modelRoles = normalizeStringRecord(record["modelRoles"], "modelRoles");
  if (record["defaultThinkingLevel"] !== undefined) config.defaultThinkingLevel = normalizeThinkingLevel(record["defaultThinkingLevel"], "defaultThinkingLevel");
  if (record["thinkingBudgets"] !== undefined) config.thinkingBudgets = normalizeThinkingBudgets(record["thinkingBudgets"]);
  return config;
}

function normalizeThinkingBudgets(value: unknown): NonNullable<OmpModelSettingsConfig["thinkingBudgets"]> {
  const record = requiredRecord(value, "thinkingBudgets");
  const budgets: NonNullable<OmpModelSettingsConfig["thinkingBudgets"]> = { ...record };
  for (const key of BUDGET_KEYS) {
    const value = record[key];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`thinkingBudgets.${key} must be a number`);
    budgets[key] = value;
  }
  return budgets;
}

function normalizeThinkingLevel(value: unknown, label: string): OmpThinkingLevel | "auto" {
  if (value === "auto" || value === "off" || value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh") return value;
  throw new Error(`${label} has unsupported value`);
}

function normalizeStringRecord(value: unknown, label: string): Record<string, string> {
  const record = requiredRecord(value, label);
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(record)) {
    if (key.trim() === "") throw new Error(`${label} contains an empty key`);
    if (typeof item !== "string") throw new Error(`${label}.${key} must be a string`);
    if (item.trim() !== "") result[key] = item;
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
