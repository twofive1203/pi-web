import { describe, expect, it } from "vitest";
import { AuthService, type AuthChange, type AuthModelRegistry } from "./authService.js";

interface TestCredential { type: "api_key"; key: string; [key: string]: unknown }
type TestCredentialMap = Record<string, TestCredential>;

describe("AuthService", () => {
  it("saves API keys and emits a global auth change", async () => {
    const { auth, authStorage, changes } = createAuthService();

    await expect(auth.saveApiKey("anthropic", "sk-test")).resolves.toEqual({ accepted: true });

    expect(authStorage.get("anthropic")).toEqual({ type: "api_key", key: "sk-test" });
    expect(changes).toEqual([{}]);
    auth.dispose();
  });

  it("logs out providers and emits the removed provider id", async () => {
    const { auth, authStorage, changes } = createAuthService({ anthropic: { type: "api_key", key: "sk-test" } });

    await expect(auth.logoutProvider("anthropic")).resolves.toEqual({ accepted: true });

    expect(authStorage.get("anthropic")).toBeUndefined();
    expect(changes).toEqual([{ removedProviderId: "anthropic" }]);
    auth.dispose();
  });

  it("rejects blank API keys", async () => {
    const { auth, changes } = createAuthService();

    await expect(auth.saveApiKey("anthropic", "   ")).rejects.toThrow("API key is required");
    expect(changes).toEqual([]);
    auth.dispose();
  });
});

function createAuthService(initialData: TestCredentialMap = {}) {
  const data = new Map(Object.entries(initialData));
  const authStorage = {
    get: (provider: string) => data.get(provider),
    set: (provider: string, credential: TestCredential) => { data.set(provider, credential); },
    login: () => Promise.resolve(),
    logout: (provider: string) => { data.delete(provider); },
    reload: () => undefined,
    list: () => [...data.keys()],
  };
  const modelRegistry: AuthModelRegistry = {
    authStorage,
    refresh: () => undefined,
    getAll: () => [...data.keys()].map((provider) => ({ provider })),
  };
  const auth = new AuthService({ modelRegistry });
  const changes: AuthChange[] = [];
  auth.subscribe((change) => { changes.push(change); });
  return { auth, authStorage, changes };
}
