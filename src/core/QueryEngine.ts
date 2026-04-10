/**
 * QueryEngine — DeepAnalyze 核心 Agent 循环引擎
 *
 * 基于 Claude Code 的 TAOR 设计模式（Think → Act → Observe → Repeat），
 * 用 DeepAnalyze 的模型路由接口重写。
 *
 * 核心能力：
 * 1. TAOR 循环 — 多轮 Think/Act/Observe
 * 2. 工具编排 — 只读工具并行执行，写工具串行执行（参考 Claude Code toolOrchestration.ts）
 * 3. 自动压缩 — 上下文超阈值时触发摘要压缩（参考 Claude Code autoCompact.ts）
 * 4. 流式输出 — SSE 事件流实时推送
 * 5. Plugin prompt 增强 — 自动注入到 system prompt
 */

import { getModelRouter } from "../models/router.js";
import { getToolDefinitions, getTool } from "../tools/registry.js";
import { autoApproveAll } from "./permissions.js";
import { getPluginPromptEnhancements } from "../plugins/loader.js";
import type { ChatMessage, ToolDefinition } from "../models/provider.js";
import { estimateTokensCJK } from "../models/provider.js";
import { createMessage, getMessages } from "../store/messages.js";
import { listKnowledgeBases } from "../store/knowledge-bases.js";

// ── Configuration ────────────────────────────────────────────────────────

const MAX_TOOL_ROUNDS = 15;
const MAX_TOOL_RESULT_CHARS = 8000;
const COMPACTION_THRESHOLD_TOKENS = 100_000;
const COMPACTION_KEEP_RECENT_MESSAGES = 6; // Keep last N messages (3 exchanges)

// ── Types ────────────────────────────────────────────────────────────────

export interface QueryEvent {
  type: "text" | "tool_calls_start" | "tool_call" | "tool_result" | "compaction" | "done" | "error";
  content?: string;
  name?: string;
  count?: number;
  resultLength?: number;
  error?: string;
}

export interface PendingToolCall {
  id: string;
  name: string;
  argsRaw: string;
}

export interface QueryOptions {
  sessionId: string;
  content: string;
  kbId?: string;
  maxRounds?: number;
  onEvent?: (event: QueryEvent) => void;
}

// ── QueryEngine ──────────────────────────────────────────────────────────

export class QueryEngine {
  private router = getModelRouter();
  private tools: ToolDefinition[];

  constructor() {
    this.tools = getToolDefinitions();
  }

  async run(options: QueryOptions): Promise<string> {
    const { sessionId, content, kbId, maxRounds = MAX_TOOL_ROUNDS, onEvent } = options;
    const emit = (event: QueryEvent) => onEvent?.(event);

    // Store user message
    createMessage(sessionId, "user", content);

    // Build conversation history
    const history = getMessages(sessionId);
    const messages: ChatMessage[] = history.map((m) => ({
      role: m.role === "tool" ? "assistant" : (m.role as "user" | "assistant"),
      content: m.content || "",
    }));

    // System prompt with plugin enhancements
    const systemPrompt = this.buildSystemPrompt(kbId);
    const msgs: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...messages,
    ];

    let fullReply = "";
    let round = 0;

    // TAOR Loop
    while (round < maxRounds) {
      round++;

      // ── Check if compaction is needed ──
      const estimatedTokens = this.estimateMessagesTokens(msgs);
      if (estimatedTokens > COMPACTION_THRESHOLD_TOKENS) {
        emit({ type: "compaction" });
        await this.compactMessages(msgs);
      }

      // ── Think: Stream model response ──
      const { assistantText, toolCalls } = await this.streamModelResponse(msgs, emit);

      // Add assistant turn to history
      msgs.push({ role: "assistant", content: assistantText });
      fullReply += assistantText;

      // If no tool calls, we're done
      if (toolCalls.length === 0) break;

      // ── Act: Execute tool calls with orchestration ──
      emit({ type: "tool_calls_start", count: toolCalls.length });

      const toolResults = await this.orchestrateToolCalls(toolCalls, sessionId, emit);

      // ── Observe: Add tool results to context ──
      for (const result of toolResults) {
        msgs.push({ role: "user", content: result.formatted });
      }
    }

    // Store final assistant reply
    if (fullReply) {
      createMessage(sessionId, "assistant", fullReply);
    }

    emit({ type: "done" });
    return fullReply;
  }

  // ── Private: Stream model response ──────────────────────────────────

  private async streamModelResponse(
    msgs: ChatMessage[],
    emit: (event: QueryEvent) => void,
  ): Promise<{ assistantText: string; toolCalls: PendingToolCall[] }> {
    let assistantText = "";
    const pendingByIndex = new Map<number, PendingToolCall>();

    for await (const chunk of this.router.chatStream(msgs, { tools: this.tools })) {
      if (chunk.type === "text" && chunk.content) {
        assistantText += chunk.content;
        emit({ type: "text", content: chunk.content });
      } else if (chunk.type === "tool_call_delta" && chunk.toolCall) {
        const tc = chunk.toolCall;
        const idx = tc.index ?? 0;
        const existing = pendingByIndex.get(idx);
        if (existing) {
          if (!existing.name && tc.function?.name) existing.name = tc.function.name;
          existing.argsRaw += tc.function?.arguments || "";
        } else {
          pendingByIndex.set(idx, {
            id: tc.id || crypto.randomUUID(),
            name: tc.function?.name || "",
            argsRaw: tc.function?.arguments || "",
          });
        }
      } else if (chunk.type === "done") {
        break;
      }
    }

    const toolCalls = Array.from(pendingByIndex.values()).filter((tc) => tc.name);
    return { assistantText, toolCalls };
  }

  // ── Private: Tool orchestration ──────────────────────────────────────
  // Read-only tools run in parallel, write tools run serially.
  // Pattern from Claude Code's toolOrchestration.ts

  private async orchestrateToolCalls(
    toolCalls: PendingToolCall[],
    sessionId: string,
    emit: (event: QueryEvent) => void,
  ): Promise<Array<{ name: string; result: string; formatted: string }>> {
    const results: Array<{ name: string; result: string; formatted: string }> = [];
    const batches = this.partitionToolCalls(toolCalls);

    for (const batch of batches) {
      if (batch.isReadOnly && batch.calls.length > 1) {
        // Execute read-only tools in parallel
        const batchResults = await Promise.all(
          batch.calls.map((tc) => this.executeToolCall(tc, sessionId, emit)),
        );
        results.push(...batchResults);
      } else {
        // Execute write tools (or single reads) serially
        for (const tc of batch.calls) {
          const result = await this.executeToolCall(tc, sessionId, emit);
          results.push(result);
        }
      }
    }

    return results;
  }

  private partitionToolCalls(toolCalls: PendingToolCall[]): Array<{ isReadOnly: boolean; calls: PendingToolCall[] }> {
    const batches: Array<{ isReadOnly: boolean; calls: PendingToolCall[] }> = [];

    for (const tc of toolCalls) {
      const tool = getTool(tc.name);
      const isReadOnly = tool?.isConcurrencySafe ?? false;

      const lastBatch = batches[batches.length - 1];
      if (lastBatch && lastBatch.isReadOnly && isReadOnly) {
        lastBatch.calls.push(tc);
      } else {
        batches.push({ isReadOnly, calls: [tc] });
      }
    }

    return batches;
  }

  private async executeToolCall(
    tc: PendingToolCall,
    sessionId: string,
    emit: (event: QueryEvent) => void,
  ): Promise<{ name: string; result: string; formatted: string }> {
    await autoApproveAll(tc.name, tc.argsRaw, sessionId);
    emit({ type: "tool_call", name: tc.name });

    let toolResult: string;
    try {
      const tool = getTool(tc.name);
      if (!tool) {
        toolResult = `[Error] Unknown tool: ${tc.name}`;
      } else {
        const input = JSON.parse(tc.argsRaw || "{}");
        toolResult = await tool.call(input);
      }
    } catch (err) {
      toolResult = `[Tool Error] ${tc.name}: ${err instanceof Error ? err.message : String(err)}`;
    }

    // Store tool result in DB
    createMessage(sessionId, "tool", toolResult, { toolName: tc.name, toolCallId: tc.id });

    // Truncate large results
    const truncated = toolResult.length > MAX_TOOL_RESULT_CHARS
      ? toolResult.slice(0, MAX_TOOL_RESULT_CHARS) + `\n...[结果已截断，共 ${toolResult.length} 字符]`
      : toolResult;

    emit({ type: "tool_result", name: tc.name, resultLength: toolResult.length });

    return {
      name: tc.name,
      result: toolResult,
      formatted: `[Tool: ${tc.name}]\n${truncated}`,
    };
  }

  // ── Private: Auto-compaction ────────────────────────────────────────
  // Pattern from Claude Code's autoCompact.ts + compact.ts

  private estimateMessagesTokens(msgs: ChatMessage[]): number {
    let total = 0;
    for (const msg of msgs) {
      total += estimateTokensCJK(msg.content || "");
    }
    return total;
  }

  private async compactMessages(msgs: ChatMessage[]): Promise<void> {
    if (msgs.length < COMPACTION_KEEP_RECENT_MESSAGES + 2) return;

    const systemMsg = msgs[0];
    const recentStartIdx = Math.max(1, msgs.length - COMPACTION_KEEP_RECENT_MESSAGES);
    const oldMessages = msgs.slice(1, recentStartIdx);
    const recentMessages = msgs.slice(recentStartIdx);

    if (oldMessages.length === 0) return;

    const summaryContent = oldMessages
      .map((m) => `[${m.role}]: ${(m.content || "").slice(0, 500)}`)
      .join("\n");

    try {
      const summary = await this.router.chat([
        {
          role: "system",
          content: "你是一个对话摘要专家。将以下对话历史压缩为简洁的摘要，保留关键信息、已完成的操作和重要发现。用中文输出，不超过500字。",
        },
        { role: "user", content: summaryContent },
      ]);

      const compactSummary = `[对话摘要]\n${summary.content}\n[/对话摘要]`;

      msgs.length = 0;
      msgs.push(systemMsg);
      msgs.push({ role: "user", content: compactSummary });
      msgs.push({ role: "assistant", content: "我已了解之前的分析内容，继续为您服务。" });
      msgs.push(...recentMessages);

      console.log(`[QueryEngine] Compacted: ${oldMessages.length} old messages -> summary`);
    } catch (err) {
      console.warn("[QueryEngine] Compaction failed, truncating:", err);
      const removed = msgs.splice(1, Math.min(4, msgs.length - 4));
      console.log(`[QueryEngine] Fallback: removed ${removed.length} oldest messages`);
    }
  }

  // ── Private: System prompt assembly with Plugin enhancements ────────

  private buildSystemPrompt(kbId?: string): string {
    let kbSection: string;
    if (kbId) {
      kbSection = `\n\n## 当前知识库\n- **kbId**: \`${kbId}\`（所有工具调用必须使用此 ID）`;
    } else {
      const kbs = listKnowledgeBases();
      if (kbs.length > 0) {
        const kbList = kbs.map((kb) => `- \`${kb.id}\` — ${kb.name}`).join("\n");
        kbSection = `\n\n## 可用知识库（未指定当前知识库，请根据用户问题选择合适的 kbId）\n${kbList}`;
      } else {
        kbSection = "\n\n## 知识库：暂无知识库，无法检索文档";
      }
    }

    const pluginEnhancements = getPluginPromptEnhancements();
    const toolList = this.tools.map((t) => `- **${t.name}**: ${t.description.split(".")[0]}`).join("\n");

    return `你是 DeepAnalyze 深度分析系统的 AI 助手。${kbSection}

## 可用工具
${toolList}

## 工作原则
1. **高效检索**：优先 kb_search，必要时才用 wiki_browse；避免重复检索相同内容
2. **结构化数据分析**：当涉及 Excel/CSV 数据查询、统计、聚合时，使用 xlsx_query 工具；先用 action=list 查看可用表格，再用 action=schema 了解列结构，最后用 action=sql 或 action=search 执行查询
3. **控制轮次**：3~5 次检索后即可整合分析，不要无限循环
4. **必须生成报告**：用户要求生成报告时，最终必须调用 report_generate 保存
5. **引用来源**：所有结论标注来源文档
6. **中文回复**：始终用中文回答
${pluginEnhancements}`;
  }
}
