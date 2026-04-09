import type { ModelProvider, ChatMessage, ChatOptions, ChatResponse, StreamChunk, ToolCall } from "./provider.js";
import { estimateTokensCJK } from "./provider.js";

export class OpenAICompatibleProvider implements ModelProvider {
  name: string;
  private endpoint: string;
  private apiKey: string;
  private modelName: string;
  private maxTokens: number;

  constructor(opts: {
    name: string;
    endpoint: string;
    apiKey?: string;
    model: string;
    maxTokens?: number;
  }) {
    this.name = opts.name;
    this.endpoint = opts.endpoint.replace(/\/$/, "");
    this.apiKey = opts.apiKey || "unused";
    this.modelName = opts.model;
    this.maxTokens = opts.maxTokens || 8192;
  }

  async chat(messages: ChatMessage[], options: ChatOptions): Promise<ChatResponse> {
    const body = this.buildRequestBody(messages, options);
    const resp = await fetch(`${this.endpoint}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });
    if (!resp.ok) throw new Error(`Model API error: ${resp.status} ${await resp.text()}`);
    const data = await resp.json() as Record<string, unknown>;
    return this.parseResponse(data);
  }

  async *chatStream(messages: ChatMessage[], options: ChatOptions): AsyncGenerator<StreamChunk> {
    const body = { ...this.buildRequestBody(messages, options), stream: true };
    const resp = await fetch(`${this.endpoint}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });
    if (!resp.ok) throw new Error(`Model API error: ${resp.status}`);

    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") {
          yield { type: "done" };
          return;
        }
        try {
          const parsed = JSON.parse(data);
          yield* this.parseStreamChunk(parsed);
        } catch {
          /* skip malformed chunks */
        }
      }
    }
  }

  estimateTokens(text: string): number {
    return estimateTokensCJK(text);
  }

  private buildRequestBody(messages: ChatMessage[], options: ChatOptions) {
    const formatted = messages.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.toolCalls ? { tool_calls: m.toolCalls } : {}),
      ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
    }));
    return {
      model: options.model || this.modelName,
      messages: formatted,
      max_tokens: options.maxTokens || this.maxTokens,
      temperature: options.temperature,
      ...(options.tools?.length
        ? {
            tools: options.tools.map((t) => ({
              type: "function",
              function: {
                name: t.name,
                description: t.description,
                parameters: t.inputSchema,
              },
            })),
          }
        : {}),
    };
  }

  private parseResponse(data: Record<string, unknown>): ChatResponse {
    const choices = data.choices as Array<{
      message?: { content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> };
      finish_reason?: string;
    }>;
    const choice = choices?.[0];
    return {
      content: choice?.message?.content || "",
      toolCalls: choice?.message?.tool_calls?.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.function.name, arguments: tc.function.arguments },
      })),
      usage: data.usage
        ? {
            inputTokens: (data.usage as { prompt_tokens: number }).prompt_tokens,
            outputTokens: (data.usage as { completion_tokens: number }).completion_tokens,
          }
        : undefined,
      finishReason: choice?.finish_reason,
    };
  }

  private *parseStreamChunk(data: Record<string, unknown>): Generator<StreamChunk> {
    const choices = data.choices as Array<{
      delta?: { content?: string; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> };
      finish_reason?: string | null;
    }>;
    const delta = choices?.[0]?.delta;
    if (!delta) return;
    if (delta.content) yield { type: "text", content: delta.content };
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        yield {
          type: "tool_call_delta",
          toolCall: {
            id: tc.id,
            function: { name: tc.function?.name || "", arguments: tc.function?.arguments || "" },
          },
        };
      }
    }
    const finishReason = choices?.[0]?.finish_reason;
    if (finishReason) yield { type: "done", finishReason };
  }
}
