import { css, html, LitElement, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { OmpModelApi, OmpModelDefinition, OmpModelSettingsConfig, OmpModelSettingsResponse, OmpModelsConfig, OmpModelsConfigResponse, OmpProviderAuth, OmpProviderConfig, OmpProviderDiscoveryType, OmpThinkingLevel } from "../../api";

const MODEL_APIS: { value: OmpModelApi; label: string }[] = [
  { value: "openai-responses", label: "OpenAI Responses" },
  { value: "openai-completions", label: "OpenAI Chat Completions" },
  { value: "openai-codex-responses", label: "OpenAI Codex Responses" },
  { value: "azure-openai-responses", label: "Azure OpenAI Responses" },
  { value: "anthropic-messages", label: "Anthropic Messages" },
  { value: "google-generative-ai", label: "Google Generative AI" },
  { value: "google-vertex", label: "Google Vertex" },
];

const AUTH_MODES: { value: OmpProviderAuth; label: string }[] = [
  { value: "apiKey", label: "API key" },
  { value: "none", label: "No auth / local" },
  { value: "oauth", label: "OAuth" },
];

const DISCOVERY_TYPES: { value: OmpProviderDiscoveryType; label: string }[] = [
  { value: "openai-models-list", label: "OpenAI-compatible /v1/models" },
  { value: "ollama", label: "Ollama" },
  { value: "llama.cpp", label: "llama.cpp" },
  { value: "lm-studio", label: "LM Studio" },
  { value: "proxy", label: "OMP auth proxy" },
];

const EDITED_PROVIDER_FIELDS = new Set(["baseUrl", "apiKey", "api", "auth", "discovery", "models", "disableStrictTools"]);
const ROLE_IDS = ["default", "smol", "slow", "plan", "commit"] as const;
const THINKING_LEVELS: { value: "" | OmpThinkingLevel; label: string }[] = [
  { value: "", label: "inherit default" },
  { value: "off", label: "off" },
  { value: "minimal", label: "minimal" },
  { value: "low", label: "low" },
  { value: "medium", label: "medium" },
  { value: "high", label: "high" },
  { value: "xhigh", label: "xhigh" },
];

interface ModelDraft {
  id: string;
  name: string;
  contextWindow: string;
  maxTokens: string;
  reasoning: boolean;
  inputText: boolean;
  inputImage: boolean;
}

interface ProviderDraft {
  id: string;
  baseUrl: string;
  apiKey: string;
  api: "" | OmpModelApi;
  auth: "" | OmpProviderAuth;
  useDiscovery: boolean;
  discoveryType: OmpProviderDiscoveryType;
  disableStrictTools: boolean;
  models: ModelDraft[];
}

interface RoleDraft {
  selector: string;
  thinkingLevel: "" | OmpThinkingLevel;
}

@customElement("settings-models-panel")
export class SettingsModelsPanel extends LitElement {
  @property({ attribute: false }) configResponse: OmpModelsConfigResponse | undefined;
  @property({ attribute: false }) settingsResponse: OmpModelSettingsResponse | undefined;
  @property({ type: Boolean }) loading = false;
  @property({ type: Boolean }) saving = false;
  @property() error = "";
  @property() savedMessage = "";
  @property() machineLabel = "local";
  @property({ attribute: false }) onReload?: () => void | Promise<void>;
  @property({ attribute: false }) onSave?: (config: OmpModelsConfig) => void | Promise<void>;
  @property({ attribute: false }) onSaveSettings?: (config: OmpModelSettingsConfig) => void | Promise<void>;
  @state() private selectedProviderId = "";
  @state() private originalProviderId = "";
  @state() private draft: ProviderDraft | undefined;
  @state() private roleDrafts: Record<string, RoleDraft> = {};
  @state() private defaultThinkingLevel: "" | OmpThinkingLevel | "auto" = "";
  @state() private localError = "";

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("settingsResponse") && this.settingsResponse !== undefined) {
      this.loadRoleDrafts(this.settingsResponse.config);
    }
    if (!changed.has("configResponse") || this.configResponse === undefined) return;
    const providers = this.configResponse.config.providers ?? {};
    const providerIds = Object.keys(providers).sort();
    const nextId = this.selectedProviderId !== "" && providers[this.selectedProviderId] !== undefined ? this.selectedProviderId : providerIds[0] ?? "";
    if (nextId === "") {
      this.selectedProviderId = "";
      this.originalProviderId = "";
      this.draft = undefined;
      return;
    }
    this.loadProviderDraft(nextId, providers[nextId]);
  }

  override render(): TemplateResult {
    const providers = this.configResponse?.config.providers ?? {};
    const providerIds = Object.keys(providers).sort();
    return html`
      <div class="section-heading">
        <div>
          <h2>OMP models and providers</h2>
          <p>Configure <code>models.yml</code> for ${this.machineLabel}. Add OpenAI-compatible gateways, local servers, or explicit custom model entries.</p>
        </div>
        <button class="secondary" ?disabled=${this.loading} @click=${() => { void this.onReload?.(); }}>Reload</button>
      </div>
      ${this.renderMessages()}
      ${this.loading && (this.configResponse === undefined || this.settingsResponse === undefined) ? html`<div class="loading-card">Loading OMP model configuration…</div>` : html`
        ${this.renderModelSelectorDatalist()}
        <div class="config-path-card">
          <span>OMP config file</span>
          <code>${this.settingsResponse?.path ?? "Unknown"}</code>
          <small>${this.settingsResponse?.exists === true ? "Existing file" : "This file will be created on save"}</small>
        </div>
        ${this.renderRoleDefaults()}
        <div class="config-path-card">
          <span>OMP models file</span>
          <code>${this.configResponse?.path ?? "Unknown"}</code>
          <small>${this.configResponse?.exists === true ? "Existing file" : "This file will be created on save"}</small>
        </div>
        <div class="models-layout">
          <aside class="provider-list" aria-label="Configured providers">
            ${providerIds.length === 0 ? html`<div class="empty-list">No custom providers yet.</div>` : providerIds.map((id) => this.renderProviderButton(id, providers[id]))}
            <button class="add-provider" @click=${() => { this.addProvider(); }}>+ Add provider</button>
          </aside>
          <main class="provider-editor">
            ${this.draft === undefined ? this.renderEmptyEditor() : this.renderProviderForm(this.draft)}
          </main>
        </div>
      `}
    `;
  }

  private renderProviderButton(id: string, provider: OmpProviderConfig | undefined): TemplateResult {
    const selected = id === this.originalProviderId;
    const modelCount = provider?.models?.length ?? 0;
    const discovery = provider?.discovery?.type;
    return html`
      <button class=${selected ? "selected" : ""} @click=${() => { this.selectProvider(id); }}>
        <strong>${id}</strong>
        <small>${discovery !== undefined ? `discovery: ${discovery}` : `${String(modelCount)} model${modelCount === 1 ? "" : "s"}`}</small>
      </button>
    `;
  }

  private renderModelSelectorDatalist(): TemplateResult {
    return html`
      <datalist id="omp-model-selectors">
        ${this.modelSelectors().map((selector) => html`<option value=${selector}></option>`)}
      </datalist>
    `;
  }

  private renderRoleDefaults(): TemplateResult {
    return html`
      <form class="roles-card" @submit=${(event: Event) => { void this.saveRoleDefaults(event); }}>
        <div class="models-heading">
          <div>
            <h3>Role defaults and thinking</h3>
            <p>Configure <code>modelRoles</code> in OMP <code>config.yml</code>. Add <code>:high</code>-style thinking by choosing a level per role.</p>
          </div>
          <button class="primary" ?disabled=${this.saving}>${this.saving ? "Saving…" : "Save roles"}</button>
        </div>
        <label class="field compact">
          <span>Default thinking level</span>
          <select .value=${this.defaultThinkingLevel} @change=${(event: Event) => { this.defaultThinkingLevel = defaultThinkingSelectValue(event); }}>
            <option value="">OMP default</option>
            <option value="auto">auto</option>
            ${THINKING_LEVELS.filter((level) => level.value !== "").map((level) => html`<option value=${level.value}>${level.label}</option>`)}
          </select>
        </label>
        <div class="role-grid">
          ${ROLE_IDS.map((roleId) => this.renderRoleRow(roleId))}
        </div>
      </form>
    `;
  }

  private renderRoleRow(roleId: string): TemplateResult {
    const draft = this.roleDrafts[roleId] ?? { selector: "", thinkingLevel: "" };
    return html`
      <div class="role-row">
        <label class="field">
          <span>${roleId}</span>
          <input .value=${draft.selector} list="omp-model-selectors" placeholder=${rolePlaceholder(roleId)} autocomplete="off" spellcheck="false" @input=${(event: Event) => { this.updateRoleDraft(roleId, { selector: inputValue(event) }); }}>
        </label>
        <label class="field">
          <span>Thinking</span>
          <select .value=${draft.thinkingLevel} @change=${(event: Event) => { this.updateRoleDraft(roleId, { thinkingLevel: thinkingSelectValue(event) }); }}>
            ${THINKING_LEVELS.map((level) => html`<option value=${level.value}>${level.label}</option>`)}
          </select>
        </label>
      </div>
    `;
  }

  private renderEmptyEditor(): TemplateResult {
    return html`
      <section class="empty-editor">
        <h3>No provider selected</h3>
        <p>Add a provider to configure a custom OMP endpoint and its models.</p>
        <button class="primary" @click=${() => { this.addProvider(); }}>Add provider</button>
      </section>
    `;
  }

  private renderProviderForm(draft: ProviderDraft): TemplateResult {
    return html`
      <form class="provider-form" @submit=${(event: Event) => { void this.saveDraft(event); }}>
        <div class="form-grid">
          <label class="field">
            <span>Provider id</span>
            <input .value=${draft.id} placeholder="myco" autocomplete="off" spellcheck="false" @input=${(event: Event) => { this.updateDraft({ id: inputValue(event) }); }}>
            <small>Models appear as <code>${draft.id || "provider"}/model-id</code>.</small>
          </label>
          <label class="field">
            <span>API transport</span>
            <select .value=${draft.api} @change=${(event: Event) => { this.updateDraft({ api: modelApiSelectValue(event) }); }}>
              <option value="">Use OMP default</option>
              ${MODEL_APIS.map((api) => html`<option value=${api.value}>${api.label}</option>`)}
            </select>
          </label>
          <label class="field wide">
            <span>Base URL</span>
            <input .value=${draft.baseUrl} placeholder="https://gateway.example.com/v1" autocomplete="off" spellcheck="false" @input=${(event: Event) => { this.updateDraft({ baseUrl: inputValue(event) }); }}>
          </label>
          <label class="field">
            <span>Auth</span>
            <select .value=${draft.auth} @change=${(event: Event) => { this.updateDraft({ auth: authSelectValue(event) }); }}>
              <option value="">Use OMP default</option>
              ${AUTH_MODES.map((mode) => html`<option value=${mode.value}>${mode.label}</option>`)}
            </select>
          </label>
          <label class="field">
            <span>API key env or token</span>
            <input .value=${draft.apiKey} placeholder="MY_PROVIDER_API_KEY" autocomplete="off" spellcheck="false" @input=${(event: Event) => { this.updateDraft({ apiKey: inputValue(event) }); }}>
            <small>OMP checks this as an environment variable name first.</small>
          </label>
        </div>

        <section class="card">
          <label class="checkbox-row">
            <input type="checkbox" .checked=${draft.useDiscovery} @change=${(event: Event) => { this.updateDraft({ useDiscovery: checkedValue(event) }); }}>
            <span>Discover models from the provider at startup</span>
          </label>
          <label class="field compact">
            <span>Discovery type</span>
            <select .value=${draft.discoveryType} ?disabled=${!draft.useDiscovery} @change=${(event: Event) => { this.updateDraft({ discoveryType: discoverySelectValue(event) }); }}>
              ${DISCOVERY_TYPES.map((type) => html`<option value=${type.value}>${type.label}</option>`)}
            </select>
          </label>
          <label class="checkbox-row">
            <input type="checkbox" .checked=${draft.disableStrictTools} @change=${(event: Event) => { this.updateDraft({ disableStrictTools: checkedValue(event) }); }}>
            <span>Disable strict tool schemas for this provider</span>
          </label>
        </section>

        <section class="models-card">
          <div class="models-heading">
            <div>
              <h3>Explicit models</h3>
              <p>Optional when discovery is enabled; useful for local/offline providers or metadata overrides.</p>
            </div>
            <button type="button" class="secondary" @click=${() => { this.addModel(); }}>+ Add model</button>
          </div>
          ${draft.models.length === 0 ? html`<div class="empty-list">No explicit models configured.</div>` : draft.models.map((model, index) => this.renderModelEditor(model, index))}
        </section>

        <footer class="form-actions">
          <button type="button" class="danger" ?disabled=${this.originalProviderId === "" || this.saving} @click=${() => { void this.deleteProvider(); }}>Delete provider</button>
          <span class="spacer"></span>
          <button class="primary" ?disabled=${this.saving}>${this.saving ? "Saving…" : "Save models.yml"}</button>
        </footer>
      </form>
    `;
  }

  private renderModelEditor(model: ModelDraft, index: number): TemplateResult {
    return html`
      <article class="model-row">
        <div class="model-row-header">
          <strong>${model.id || `Model ${String(index + 1)}`}</strong>
          <button type="button" class="icon-button" title="Remove model" @click=${() => { this.removeModel(index); }}>×</button>
        </div>
        <div class="form-grid">
          <label class="field">
            <span>Model id</span>
            <input .value=${model.id} placeholder="model-id" autocomplete="off" spellcheck="false" @input=${(event: Event) => { this.updateModel(index, { id: inputValue(event) }); }}>
          </label>
          <label class="field">
            <span>Display name</span>
            <input .value=${model.name} placeholder="My Model" autocomplete="off" spellcheck="false" @input=${(event: Event) => { this.updateModel(index, { name: inputValue(event) }); }}>
          </label>
          <label class="field">
            <span>Context window</span>
            <input .value=${model.contextWindow} inputmode="numeric" pattern="[0-9]*" placeholder="200000" @input=${(event: Event) => { this.updateModel(index, { contextWindow: inputValue(event) }); }}>
          </label>
          <label class="field">
            <span>Max output tokens</span>
            <input .value=${model.maxTokens} inputmode="numeric" pattern="[0-9]*" placeholder="32000" @input=${(event: Event) => { this.updateModel(index, { maxTokens: inputValue(event) }); }}>
          </label>
        </div>
        <div class="inline-options">
          <label><input type="checkbox" .checked=${model.reasoning} @change=${(event: Event) => { this.updateModel(index, { reasoning: checkedValue(event) }); }}> reasoning</label>
          <label><input type="checkbox" .checked=${model.inputText} @change=${(event: Event) => { this.updateModel(index, { inputText: checkedValue(event) }); }}> text</label>
          <label><input type="checkbox" .checked=${model.inputImage} @change=${(event: Event) => { this.updateModel(index, { inputImage: checkedValue(event) }); }}> image</label>
        </div>
      </article>
    `;
  }

  private renderMessages(): TemplateResult | null {
    const error = this.localError || this.error;
    if (error !== "") return html`<div class="message error-message">${error}</div>`;
    if (this.savedMessage !== "") return html`<div class="message success-message">${this.savedMessage}</div>`;
    return null;
  }

  private updateRoleDraft(roleId: string, patch: Partial<RoleDraft>): void {
    this.roleDrafts = { ...this.roleDrafts, [roleId]: { ...(this.roleDrafts[roleId] ?? { selector: "", thinkingLevel: "" }), ...patch } };
    this.localError = "";
  }

  private loadRoleDrafts(config: OmpModelSettingsConfig): void {
    const modelRoles = config.modelRoles ?? {};
    const drafts: Record<string, RoleDraft> = {};
    for (const roleId of ROLE_IDS) drafts[roleId] = roleDraftFromValue(modelRoles[roleId] ?? "");
    this.roleDrafts = drafts;
    this.defaultThinkingLevel = config.defaultThinkingLevel ?? "";
  }

  private async saveRoleDefaults(event: Event): Promise<void> {
    event.preventDefault();
    this.localError = "";
    const editedRoleIds = new Set<string>(ROLE_IDS);
    const modelRoles: Record<string, string> = {};
    for (const [roleId, value] of Object.entries(this.settingsResponse?.config.modelRoles ?? {})) {
      if (!editedRoleIds.has(roleId)) modelRoles[roleId] = value;
    }
    for (const roleId of ROLE_IDS) {
      const value = roleValueFromDraft(this.roleDrafts[roleId] ?? { selector: "", thinkingLevel: "" });
      if (value !== "") modelRoles[roleId] = value;
    }
    const config = omitDefaultThinkingLevel(this.settingsResponse?.config ?? {});
    config.modelRoles = modelRoles;
    if (this.defaultThinkingLevel !== "") config.defaultThinkingLevel = this.defaultThinkingLevel;
    await this.onSaveSettings?.(config);
  }

  private modelSelectors(): string[] {
    const providers = this.configResponse?.config.providers ?? {};
    return Object.entries(providers)
      .flatMap(([providerId, provider]) => (provider.models ?? []).map((model) => `${providerId}/${model.id}`))
      .sort((a, b) => a.localeCompare(b));
  }

  private selectProvider(id: string): void {
    const provider = this.configResponse?.config.providers?.[id];
    if (provider === undefined) return;
    this.loadProviderDraft(id, provider);
  }

  private addProvider(): void {
    const providers = this.configResponse?.config.providers ?? {};
    const id = uniqueProviderId(providers);
    this.selectedProviderId = id;
    this.originalProviderId = "";
    this.draft = providerDraftFromConfig(id, {});
    this.localError = "";
  }

  private addModel(): void {
    if (this.draft === undefined) return;
    this.draft = { ...this.draft, models: [...this.draft.models, emptyModelDraft()] };
  }

  private removeModel(index: number): void {
    if (this.draft === undefined) return;
    this.draft = { ...this.draft, models: this.draft.models.filter((_model, modelIndex) => modelIndex !== index) };
  }

  private updateModel(index: number, patch: Partial<ModelDraft>): void {
    if (this.draft === undefined) return;
    this.draft = { ...this.draft, models: this.draft.models.map((model, modelIndex) => modelIndex === index ? { ...model, ...patch } : model) };
    this.localError = "";
  }

  private updateDraft(patch: Partial<ProviderDraft>): void {
    if (this.draft === undefined) return;
    this.draft = { ...this.draft, ...patch };
    this.localError = "";
  }

  private loadProviderDraft(id: string, provider: OmpProviderConfig | undefined): void {
    this.selectedProviderId = id;
    this.originalProviderId = id;
    this.draft = providerDraftFromConfig(id, provider ?? {});
    this.localError = "";
  }

  private async saveDraft(event: Event): Promise<void> {
    event.preventDefault();
    if (this.draft === undefined) return;
    this.localError = "";
    try {
      const nextConfig = this.configWithDraft(this.draft);
      await this.onSave?.(nextConfig);
      this.originalProviderId = this.draft.id.trim();
      this.selectedProviderId = this.originalProviderId;
    } catch (error) {
      this.localError = errorMessage(error);
    }
  }

  private async deleteProvider(): Promise<void> {
    if (this.originalProviderId === "") return;
    const providers = { ...(this.configResponse?.config.providers ?? {}) };
    await this.onSave?.({ ...(this.configResponse?.config ?? {}), providers: omitProvider(providers, this.originalProviderId) });
  }

  private configWithDraft(draft: ProviderDraft): OmpModelsConfig {
    const providerId = draft.id.trim();
    if (providerId === "") throw new Error("Provider id is required");
    const providers = { ...(this.configResponse?.config.providers ?? {}) };
    const nextProviders = this.originalProviderId !== "" && this.originalProviderId !== providerId ? omitProvider(providers, this.originalProviderId) : providers;
    const originalProvider = this.originalProviderId === "" ? {} : this.configResponse?.config.providers?.[this.originalProviderId] ?? {};
    nextProviders[providerId] = mergeEditedProviderConfig(originalProvider, providerConfigFromDraft(draft));
    return { ...(this.configResponse?.config ?? {}), providers: nextProviders };
  }

  static override styles = css`
    :host { display: block; }
    .section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
    .section-heading > div { display: grid; gap: 6px; min-width: 0; }
    h2, h3, p { margin: 0; }
    h2 { font-size: 17px; line-height: 1.25; }
    h3 { font-size: 13px; line-height: 1.3; }
    p, small, .empty-list { color: var(--pi-muted); line-height: 1.45; }
    code { border: 1px solid var(--pi-border-muted); border-radius: 5px; background: var(--pi-bg); padding: 1px 4px; color: var(--pi-text); font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
    button, input, select { font: inherit; }
    button { border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); color: var(--pi-text); padding: 7px 9px; cursor: pointer; }
    button:disabled { opacity: .55; cursor: not-allowed; }
    input, select { box-sizing: border-box; width: 100%; min-width: 0; border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-bg); color: var(--pi-text); padding: 9px 10px; outline: none; }
    input:focus, select:focus { border-color: var(--pi-accent); box-shadow: 0 0 0 1px var(--pi-accent-border); }
    .message, .loading-card, .config-path-card, .card, .roles-card, .models-card, .empty-editor, .model-row { border: 1px solid var(--pi-border); border-radius: 10px; background: var(--pi-surface); padding: 12px; }
    .message { margin-bottom: 12px; }
    .error-message { border-color: var(--pi-danger); color: var(--pi-danger); background: color-mix(in srgb, var(--pi-danger) 10%, var(--pi-surface)); }
    .success-message { border-color: var(--pi-success-border); color: var(--pi-success); background: var(--pi-success-surface); }
    .config-path-card { display: grid; gap: 5px; margin-bottom: 14px; }
    .config-path-card span, .field > span { color: var(--pi-muted); font-size: 12px; font-weight: 700; text-transform: uppercase; }
    .roles-card { display: grid; gap: 12px; margin-bottom: 14px; }
    .role-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .role-row { display: grid; grid-template-columns: minmax(0, 1fr) 150px; gap: 10px; align-items: end; }
    .models-layout { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 14px; align-items: start; }
    .provider-list { display: grid; gap: 7px; position: sticky; top: 0; }
    .provider-list button { text-align: left; display: grid; gap: 2px; }
    .provider-list button.selected { border-color: var(--pi-accent); background: var(--pi-selection-bg); }
    .add-provider { justify-content: center; }
    .provider-form { display: grid; gap: 14px; }
    .form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .field { display: grid; gap: 7px; }
    .field.wide { grid-column: 1 / -1; }
    .field.compact { margin-top: 10px; }
    .checkbox-row, .inline-options { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; color: var(--pi-text); }
    .checkbox-row input, .inline-options input { width: auto; }
    .models-card { display: grid; gap: 12px; }
    .models-heading { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
    .models-heading > div { display: grid; gap: 4px; }
    .model-row { display: grid; gap: 10px; background: var(--pi-bg); }
    .model-row-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .icon-button { width: 30px; height: 30px; display: grid; place-items: center; padding: 0; border: 0; background: transparent; color: var(--pi-muted); font-size: 20px; }
    .icon-button:hover, .icon-button:focus { background: var(--pi-surface-hover); color: var(--pi-text); }
    .form-actions { display: flex; gap: 8px; align-items: center; }
    .spacer { flex: 1; }
    .primary { border-color: var(--pi-accent); background: var(--pi-selection-bg); color: var(--pi-text-bright); }
    .danger { border-color: var(--pi-danger); color: var(--pi-danger); background: color-mix(in srgb, var(--pi-danger) 8%, var(--pi-surface)); }
    .empty-editor { display: grid; justify-items: start; gap: 8px; }

    @media (max-width: 860px) {
      .section-heading, .models-heading { display: grid; }
      .models-layout, .role-grid, .role-row { grid-template-columns: minmax(0, 1fr); }
      .provider-list { position: static; }
      .form-grid { grid-template-columns: minmax(0, 1fr); }
    }
  `;
}

function providerDraftFromConfig(id: string, provider: OmpProviderConfig): ProviderDraft {
  return {
    id,
    baseUrl: provider.baseUrl ?? "",
    apiKey: provider.apiKey ?? "",
    api: provider.api ?? "",
    auth: provider.auth ?? "",
    useDiscovery: provider.discovery !== undefined,
    discoveryType: provider.discovery?.type ?? "openai-models-list",
    disableStrictTools: provider.disableStrictTools === true,
    models: (provider.models ?? []).map(modelDraftFromConfig),
  };
}

function modelDraftFromConfig(model: OmpModelDefinition): ModelDraft {
  return {
    id: model.id,
    name: model.name ?? "",
    contextWindow: model.contextWindow === undefined ? "" : String(model.contextWindow),
    maxTokens: model.maxTokens === undefined ? "" : String(model.maxTokens),
    reasoning: model.reasoning === true,
    inputText: model.input?.includes("text") ?? true,
    inputImage: model.input?.includes("image") ?? false,
  };
}

function mergeEditedProviderConfig(original: OmpProviderConfig, edited: OmpProviderConfig): OmpProviderConfig {
  const preserved: OmpProviderConfig = {};
  for (const [key, value] of Object.entries(original)) {
    if (!EDITED_PROVIDER_FIELDS.has(key)) preserved[key] = value;
  }
  return { ...preserved, ...edited };
}

function providerConfigFromDraft(draft: ProviderDraft): OmpProviderConfig {
  const provider: OmpProviderConfig = {};
  if (draft.baseUrl.trim() !== "") provider.baseUrl = draft.baseUrl.trim();
  if (draft.apiKey.trim() !== "") provider.apiKey = draft.apiKey.trim();
  if (draft.api !== "") provider.api = draft.api;
  if (draft.auth !== "") provider.auth = draft.auth;
  if (draft.useDiscovery) provider.discovery = { type: draft.discoveryType };
  if (draft.disableStrictTools) provider.disableStrictTools = true;
  const models = draft.models.map(modelConfigFromDraft).filter((model): model is OmpModelDefinition => model !== undefined);
  if (models.length > 0) provider.models = models;
  return provider;
}

function roleDraftFromValue(value: string): RoleDraft {
  const trimmed = value.trim();
  if (trimmed === "") return { selector: "", thinkingLevel: "" };
  const separator = trimmed.lastIndexOf(":");
  if (separator <= 0) return { selector: trimmed, thinkingLevel: "" };
  const suffix = thinkingLevelFromString(trimmed.slice(separator + 1));
  if (suffix === "") return { selector: trimmed, thinkingLevel: "" };
  return { selector: trimmed.slice(0, separator), thinkingLevel: suffix };
}

function roleValueFromDraft(draft: RoleDraft): string {
  const selector = draft.selector.trim();
  if (selector === "") return "";
  return draft.thinkingLevel === "" ? selector : `${selector}:${draft.thinkingLevel}`;
}

function rolePlaceholder(roleId: string): string {
  switch (roleId) {
    case "default": return "provider/model";
    case "smol": return "provider/fast-model";
    case "slow": return "provider/strong-model";
    case "plan": return "provider/planner-model";
    case "commit": return "provider/cheap-model";
    default: return "provider/model";
  }
}

function omitDefaultThinkingLevel(config: OmpModelSettingsConfig): OmpModelSettingsConfig {
  const result: OmpModelSettingsConfig = {};
  for (const [key, value] of Object.entries(config)) {
    if (key !== "defaultThinkingLevel") result[key] = value;
  }
  return result;
}

function modelConfigFromDraft(draft: ModelDraft): OmpModelDefinition | undefined {
  const id = draft.id.trim();
  if (id === "") return undefined;
  const model: OmpModelDefinition = { id };
  if (draft.name.trim() !== "") model.name = draft.name.trim();
  const contextWindow = optionalPositiveInteger(draft.contextWindow, "Context window");
  const maxTokens = optionalPositiveInteger(draft.maxTokens, "Max output tokens");
  if (contextWindow !== undefined) model.contextWindow = contextWindow;
  if (maxTokens !== undefined) model.maxTokens = maxTokens;
  if (draft.reasoning) model.reasoning = true;
  const input: ("text" | "image")[] = [];
  if (draft.inputText) input.push("text");
  if (draft.inputImage) input.push("image");
  if (input.length > 0) model.input = input;
  return model;
}

function emptyModelDraft(): ModelDraft {
  return { id: "", name: "", contextWindow: "", maxTokens: "", reasoning: false, inputText: true, inputImage: false };
}

function uniqueProviderId(providers: Record<string, OmpProviderConfig>): string {
  const base = "custom-provider";
  if (providers[base] === undefined) return base;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}-${String(index)}`;
    if (providers[candidate] === undefined) return candidate;
  }
  return `${base}-${String(Date.now())}`;
}

function omitProvider(providers: Record<string, OmpProviderConfig>, providerId: string): Record<string, OmpProviderConfig> {
  const result: Record<string, OmpProviderConfig> = {};
  for (const [id, provider] of Object.entries(providers)) {
    if (id !== providerId) result[id] = provider;
  }
  return result;
}

function optionalPositiveInteger(value: string, label: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function inputValue(event: Event): string {
  return event.target instanceof HTMLInputElement ? event.target.value : "";
}

function selectValue(event: Event): string {
  return event.target instanceof HTMLSelectElement ? event.target.value : "";
}

function modelApiSelectValue(event: Event): ProviderDraft["api"] {
  const value = selectValue(event);
  if (value === "") return "";
  const option = MODEL_APIS.find((api) => api.value === value);
  return option?.value ?? "";
}

function authSelectValue(event: Event): ProviderDraft["auth"] {
  const value = selectValue(event);
  if (value === "") return "";
  const option = AUTH_MODES.find((mode) => mode.value === value);
  return option?.value ?? "";
}

function discoverySelectValue(event: Event): OmpProviderDiscoveryType {
  const value = selectValue(event);
  const option = DISCOVERY_TYPES.find((type) => type.value === value);
  return option?.value ?? "openai-models-list";
}

function thinkingSelectValue(event: Event): "" | OmpThinkingLevel {
  return thinkingLevelFromString(selectValue(event));
}

function defaultThinkingSelectValue(event: Event): "" | OmpThinkingLevel | "auto" {
  const value = selectValue(event);
  if (value === "auto") return value;
  return thinkingLevelFromString(value);
}

function thinkingLevelFromString(value: string): "" | OmpThinkingLevel {
  const option = THINKING_LEVELS.find((level) => level.value === value);
  return option?.value ?? "";
}

function checkedValue(event: Event): boolean {
  return event.target instanceof HTMLInputElement && event.target.checked;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
