import { OpenAICompatibleProvider } from "./openai-compatible.js";
import type { ModelProvider, ChatMessage, ChatOptions, ChatResponse, StreamChunk, ModelConfig } from "./provider.js";
import { estimateTokensCJK } from "./provider.js";
import { readFileSync, existsSync } from "fs";
import { parse as parseYaml } from "yaml";
import { join } from "path";

export class ModelRouter {
  private providers: Map<string, ModelProvider> = new Map();
  private defaults: { main: string; summarizer?: string; embedding?: string; vlm?: string } = { main: "default" };
  private config: ModelConfig | null = null;

  async initialize(configPath?: string): Promise<void> {
    const path = configPath || join(process.cwd(), "config", "model-config.yaml");
    if (!existsSync(path)) {
      console.warn(`[ModelRouter] Config not found at ${path}, model calls will fail until configured.`);
      return;
    }
    const raw = readFileSync(path, "utf-8");
    this.config = parseYaml(raw) as ModelConfig;
    this.defaults = this.config.defaults;

    for (const [key, cfg] of Object.entries(this.config.models)) {
      if (cfg.provider === "openai-compatible" || cfg.provider === "anthropic") {
        const provider = new OpenAICompatibleProvider({
          name: key,
          endpoint: cfg.endpoint || "http://localhost:11434/v1",
          apiKey: cfg.apiKey,
          model: cfg.model || key,
          maxTokens: cfg.maxTokens,
        });
        this.providers.set(key, provider);
        console.log(`[ModelRouter] Registered provider: ${key} -> ${cfg.endpoint}`);
      }
    }
  }

  getProvider(name?: string): ModelProvider {
    const key = name || this.defaults.main;
    const provider = this.providers.get(key);
    if (!provider) {
      throw new Error(`Model provider not found: "${key}". Check config/model-config.yaml`);
    }
    return provider;
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    return this.getProvider(options?.model).chat(messages, { ...options, model: undefined });
  }

  async *chatStream(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<StreamChunk> {
    yield* this.getProvider(options?.model).chatStream(messages, { ...options, model: undefined });
  }

  estimateTokens(text: string): number {
    const provider = this.providers.get(this.defaults.main);
    return provider ? provider.estimateTokens(text) : estimateTokensCJK(text);
  }

  getDefaultModel(role: "main" | "summarizer" | "embedding" | "vlm"): string {
    return this.defaults[role] || this.defaults.main;
  }

  isConfigured(): boolean {
    return this.providers.size > 0;
  }

  async reload(): Promise<void> {
    this.providers.clear();
    await this.initialize();
  }
}

// Singleton
let _router: ModelRouter | null = null;
export function getModelRouter(): ModelRouter {
  if (!_router) _router = new ModelRouter();
  return _router;
}
