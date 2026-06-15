import type { AuthProviderOption, AuthProvidersResponse, AuthProviderStatus, AuthType, OAuthFlowState } from "../../shared/apiTypes.js";
import { getLoginProviderOptions, getLogoutProviderOptions, type AuthProviderCatalog, type AuthProviderCredential } from "./authProviderOptions.js";
import { OAuthLoginFlowService } from "./oauthLoginFlowService.js";

export interface AuthChange {
  removedProviderId?: string;
}

type AuthChangeListener = (change: AuthChange) => void;

export type AuthModelRegistry = AuthModelRegistryLike;
type MaybePromise<T> = T | Promise<T>;

interface AuthStorageLike {
  get(provider: string): AuthProviderCredential | AuthProviderCredential[] | undefined;
  set(provider: string, credential: { type: "api_key"; key: string }): MaybePromise<void>;
  login(providerId: string, callbacks: unknown): Promise<void>;
  logout(provider: string): MaybePromise<void>;
  reload(): MaybePromise<void>;
  list(): string[];
  hasAuth?(provider: string): boolean;
  getAuthStatus?(provider: string): AuthProviderStatus;
  getOAuthProviders?(): { id: string; name: string }[];
}

interface AuthModelRegistryLike {
  authStorage: AuthStorageLike;
  refresh(): MaybePromise<void>;
  getAll(): { provider: string }[];
  getAvailable?(): { provider: string }[];
  find?(provider: string, modelId: string): unknown;
  hasConfiguredAuth?(model: unknown): boolean;
  getProviderDisplayName?(provider: string): string;
  getProviderAuthStatus?(provider: string): AuthProviderStatus;
}

export interface AuthServiceDependencies {
  modelRegistry?: AuthModelRegistry;
  authFlows?: OAuthLoginFlowService;
}

export class AuthService {
  readonly modelRegistry: AuthModelRegistry;
  private readonly authRegistry: AuthModelRegistryLike;
  private readonly authFlows: OAuthLoginFlowService;
  private readonly listeners = new Set<AuthChangeListener>();

  constructor(deps: AuthServiceDependencies) {
    if (deps.modelRegistry === undefined) throw new Error("AuthService requires a runtime model registry");
    const modelRegistry = deps.modelRegistry;
    this.modelRegistry = modelRegistry;
    this.authRegistry = modelRegistry;
    this.authFlows = deps.authFlows ?? new OAuthLoginFlowService();
  }

  subscribe(listener: AuthChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.authFlows.dispose();
    this.listeners.clear();
  }

  async authProviders(mode: "login" | "logout", authType?: AuthType): Promise<AuthProvidersResponse> {
    await this.refreshModels();
    const catalog = await this.authProviderCatalog();
    const providers = mode === "logout" ? getLogoutProviderOptions(catalog) : getLoginProviderOptions(catalog, authType);
    return { providers };
  }

  async saveApiKey(providerId: string, key: string): Promise<{ accepted: true }> {
    if (key.trim() === "") throw new Error("API key is required");
    await this.authRegistry.authStorage.set(providerId, { type: "api_key", key });
    await this.refreshAuthState();
    return { accepted: true };
  }

  async logoutProvider(providerId: string): Promise<{ accepted: true }> {
    await this.authRegistry.authStorage.logout(providerId);
    await this.refreshAuthState({ removedProviderId: providerId });
    return { accepted: true };
  }

  async startOAuthLogin(providerId: string): Promise<OAuthFlowState> {
    const provider = await this.requireOAuthLoginProvider(providerId);
    return this.authFlows.start({
      providerId,
      providerName: provider.name,
      authStorage: this.authRegistry.authStorage,
      onComplete: () => {
        void this.refreshAuthState();
      },
    });
  }

  oauthFlow(flowId: string): OAuthFlowState {
    return this.authFlows.get(flowId);
  }

  respondToOAuthFlow(flowId: string, requestId: string, value: string): OAuthFlowState {
    return this.authFlows.respond(flowId, requestId, value);
  }

  cancelOAuthFlow(flowId: string): OAuthFlowState {
    return this.authFlows.cancel(flowId);
  }

  private async refreshAuthState(change: AuthChange = {}): Promise<void> {
    await this.authRegistry.authStorage.reload();
    await this.refreshModels();
    this.emit(change);
  }

  private emit(change: AuthChange): void {
    for (const listener of this.listeners) listener(change);
  }

  private async requireOAuthLoginProvider(providerId: string): Promise<AuthProviderOption> {
    await this.refreshModels();
    const provider = getLoginProviderOptions(await this.authProviderCatalog(), "oauth").find((option) => option.id === providerId);
    if (provider === undefined) throw new Error(`OAuth provider not found: ${providerId}`);
    return provider;
  }


  private async refreshModels(): Promise<void> {
    await this.authRegistry.refresh();
  }

  private async authProviderCatalog(): Promise<AuthProviderCatalog> {
    const registry = this.authRegistry;
    const oauthProviders = await this.oauthProviders();
    const modelProviders = registry.getAll().map((model) => model.provider);
    const storedCredentials = registry.authStorage.list()
      .map((id) => {
        const credential = firstCredential(registry.authStorage.get(id));
        return credential === undefined ? undefined : { id, credential };
      })
      .filter(isDefined);
    return {
      oauthProviders,
      modelProviders,
      storedCredentials,
      displayName: (providerId) => this.providerDisplayName(providerId, oauthProviders),
      authStatus: (providerId) => this.providerAuthStatus(providerId),
    };
  }

  private async oauthProviders(): Promise<{ id: string; name: string }[]> {
    const storage = this.authRegistry.authStorage;
    if (typeof storage.getOAuthProviders === "function") return storage.getOAuthProviders().map((provider) => ({ id: provider.id, name: provider.name }));
    const piAi = await import("@oh-my-pi/pi-ai");
    return piAi.getOAuthProviders().map((provider) => ({ id: provider.id, name: provider.name }));
  }

  private providerDisplayName(providerId: string, oauthProviders: readonly { id: string; name: string }[]): string {
    const registry = this.authRegistry;
    if (typeof registry.getProviderDisplayName === "function") return registry.getProviderDisplayName(providerId);
    return oauthProviders.find((provider) => provider.id === providerId)?.name ?? titleCaseProviderId(providerId);
  }

  private providerAuthStatus(providerId: string): AuthProviderStatus {
    const registry = this.authRegistry;
    if (typeof registry.getProviderAuthStatus === "function") return registry.getProviderAuthStatus(providerId);
    if (typeof registry.authStorage.getAuthStatus === "function") return registry.authStorage.getAuthStatus(providerId);
    const credential = firstCredential(registry.authStorage.get(providerId));
    if (credential !== undefined) return { configured: true, source: "stored" };
    if (registry.authStorage.hasAuth?.(providerId) === true) return { configured: true, source: "stored" };
    const model = registry.getAll().find((candidate) => candidate.provider === providerId);
    if (model !== undefined && registry.hasConfiguredAuth?.(model) === true) return { configured: true, source: "environment" };
    return { configured: false };
  }
}

function firstCredential(value: AuthProviderCredential | AuthProviderCredential[] | undefined): AuthProviderCredential | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function titleCaseProviderId(providerId: string): string {
  return providerId
    .split(/[-_]/)
    .filter((part) => part !== "")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
