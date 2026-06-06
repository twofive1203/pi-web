import type { AuthProviderOption, AuthProviderStatus, AuthType } from "../../shared/apiTypes.js";

const OAUTH_ONLY_PROVIDERS = new Set(["github-copilot", "openai-codex"]);

export interface AuthProviderCredential {
  type: AuthType;
}

export interface AuthProviderCatalog {
  oauthProviders: readonly { id: string; name: string }[];
  modelProviders: readonly string[];
  storedCredentials: readonly { id: string; credential: AuthProviderCredential }[];
  displayName(providerId: string): string;
  authStatus(providerId: string): AuthProviderStatus;
}

export function getLoginProviderOptions(catalog: AuthProviderCatalog, authType?: AuthType): AuthProviderOption[] {
  const oauthProviderIds = new Set(catalog.oauthProviders.map((provider) => provider.id));
  const options: AuthProviderOption[] = catalog.oauthProviders.map((provider) => ({
    id: provider.id,
    name: provider.name,
    authType: "oauth",
    status: catalog.authStatus(provider.id),
  }));

  const modelProviders = new Set(catalog.modelProviders);
  for (const providerId of modelProviders) {
    if (!isApiKeyLoginProvider(providerId, oauthProviderIds)) continue;
    options.push({
      id: providerId,
      name: catalog.displayName(providerId),
      authType: "api_key",
      status: catalog.authStatus(providerId),
    });
  }

  return filterAndSort(options, authType);
}

export function getLogoutProviderOptions(catalog: AuthProviderCatalog): AuthProviderOption[] {
  const options: AuthProviderOption[] = [];
  for (const stored of catalog.storedCredentials) {
    options.push({
      id: stored.id,
      name: catalog.displayName(stored.id),
      authType: stored.credential.type,
      status: catalog.authStatus(stored.id),
    });
  }
  return filterAndSort(options);
}

export function isApiKeyLoginProvider(providerId: string, oauthProviderIds: ReadonlySet<string>): boolean {
  if (OAUTH_ONLY_PROVIDERS.has(providerId)) return false;
  if (providerId === "anthropic") return true;
  if (oauthProviderIds.has(providerId)) return false;
  return true;
}

function filterAndSort(options: AuthProviderOption[], authType?: AuthType): AuthProviderOption[] {
  const filtered = authType === undefined ? options : options.filter((option) => option.authType === authType);
  return filtered.sort((a, b) => a.name.localeCompare(b.name) || a.authType.localeCompare(b.authType) || a.id.localeCompare(b.id));
}
