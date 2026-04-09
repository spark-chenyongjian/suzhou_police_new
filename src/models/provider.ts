import { z } from "zod";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ChatOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  tools?: ToolDefinition[];
  signal?: AbortSignal;
  stream?: boolean;
}

export interface ChatResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage?: { inputTokens: number; outputTokens: number };
  finishReason?: string;
}

export interface StreamChunk {
  type: "text" | "tool_call" | "tool_call_delta" | "done" | "error";
  content?: string;
  toolCall?: Partial<ToolCall>;
  finishReason?: string;
  error?: string;
}

export interface ModelProvider {
  name: string;
  chat(messages: ChatMessage[], options: ChatOptions): Promise<ChatResponse>;
  chatStream(messages: ChatMessage[], options: ChatOptions): AsyncGenerator<StreamChunk>;
  estimateTokens(text: string): number;
}

export const ModelConfigSchema = z.object({
  models: z.record(z.object({
    provider: z.string(),
    endpoint: z.string().optional(),
    apiKey: z.string().optional(),
    model: z.string().optional(),
    modelPath: z.string().optional(),
    maxTokens: z.number().optional(),
    supportsToolUse: z.boolean().optional().default(true),
    dimension: z.number().optional(),
  })),
  defaults: z.object({
    main: z.string(),
    summarizer: z.string().optional(),
    embedding: z.string().optional(),
    vlm: z.string().optional(),
  }),
});

export type ModelConfig = z.infer<typeof ModelConfigSchema>;

/**
 * CJK-aware token estimation.
 * CJK characters typically map to ~1.5 tokens, emoji ~2, ASCII ~0.25.
 * Inspired by lossless-claw's approach to handling multilingual content.
 */
export function estimateTokensCJK(text: string): number {
  let tokens = 0;
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||  // CJK Unified Ideographs
      (code >= 0x3000 && code <= 0x303f) ||  // CJK Symbols and Punctuation
      (code >= 0xff00 && code <= 0xffef) ||  // Fullwidth forms
      (code >= 0x3040 && code <= 0x309f) ||  // Hiragana
      (code >= 0x30a0 && code <= 0x30ff)     // Katakana
    ) {
      tokens += 1.5;
    } else if (code >= 0x1f600 && code <= 0x1f64f) {
      tokens += 2; // Emoji
    } else {
      tokens += 0.25; // ASCII / Latin
    }
  }
  return Math.ceil(tokens);
}
