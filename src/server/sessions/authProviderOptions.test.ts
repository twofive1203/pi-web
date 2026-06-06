import { describe, expect, it } from "vitest";
import { getLoginProviderOptions, getLogoutProviderOptions, isApiKeyLoginProvider, type AuthProviderCatalog } from "./authProviderOptions";

function catalog(): AuthProviderCatalog {
  return {
    oauthProviders: [
      { id: "anthropic", name: "Anthropic (Claude Pro/Max)" },
      { id: "github-copilot", name: "GitHub Copilot" },
      { id: "openai-codex", name: "ChatGPT Plus/Pro (Codex Subscription)" },
    ],
    modelProviders: ["anthropic", "openai", "openai-codex", "github-copilot", "custom"],
    storedCredentials: [{ id: "openai", credential: { type: "api_key" } }],
    displayName: (provider: string) => ({ anthropic: "Anthropic", openai: "OpenAI", custom: "Custom" }[provider] ?? provider),
    authStatus: (provider: string) => (provider === "openai" ? { configured: true, source: "stored" } : { configured: false }),
  };
}

describe("auth provider options", () => {
  it("keeps OAuth-only providers out of API key login options", () => {
    expect(isApiKeyLoginProvider("openai-codex", new Set(["openai-codex"]))).toBe(false);
    expect(isApiKeyLoginProvider("github-copilot", new Set(["github-copilot"]))).toBe(false);
    expect(isApiKeyLoginProvider("openai", new Set(["openai-codex"]))).toBe(true);
  });

  it("includes Anthropic in both OAuth and API key login options", () => {
    const options = getLoginProviderOptions(catalog());
    expect(options).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "anthropic", authType: "oauth" }),
      expect.objectContaining({ id: "anthropic", authType: "api_key" }),
      expect.objectContaining({ id: "openai", authType: "api_key", status: { configured: true, source: "stored" } }),
      expect.objectContaining({ id: "openai-codex", authType: "oauth" }),
    ]));
    expect(options).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "openai-codex", authType: "api_key" })]));
  });

  it("returns only stored credentials for logout", () => {
    expect(getLogoutProviderOptions(catalog())).toEqual([
      expect.objectContaining({ id: "openai", authType: "api_key" }),
    ]);
  });
});
