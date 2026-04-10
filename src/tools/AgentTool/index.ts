/**
 * AgentTool — 父子 Agent 委派调度
 *
 * 允许主 Agent 派发子任务给内置 Agent（Explore/Compile/Verify）或通用 Worker Agent。
 * 子 Agent 运行独立的 TAOR 循环，使用受限的工具集。
 *
 * 设计参考: design.md §3.6 内置Agent类型
 */

import { z } from "zod";
import { getModelRouter } from "../../models/router.js";
import { getToolDefinitions, getTool } from "../../tools/registry.js";
import type { ToolDefinition } from "../../tools/registry.js";
import { autoApproveAll } from "../../core/permissions.js";
import type { ChatMessage } from "../../models/provider.js";

// ── Built-in Agent Definitions ────────────────────────────────────────

interface AgentDef {
  name: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  readOnly: boolean;
  maxRounds: number;
}

const BUILTIN_AGENTS: Record<string, AgentDef> = {
  explore: {
    name: "ExploreAgent",
    description: "在知识库中进行多轮深度检索探索，汇总发现",
    systemPrompt: `你是一个知识库探索 Agent。你的任务是：
1. 根据用户的问题，制定搜索策略
2. 使用 kb_search 和 wiki_browse 多轮检索
3. 使用 expand 展开关键文档的细节
4. 汇总所有发现，给出完整答案
注意：你只能读取数据，不能修改任何内容。保持简洁，引用来源。用中文回答。`,
    tools: ["kb_search", "expand", "wiki_browse", "xlsx_query", "xlsx_analyze", "read", "grep", "glob"],
    readOnly: true,
    maxRounds: 8,
  },
  compile: {
    name: "CompileAgent",
    description: "将原始内容编译为 Wiki 页面，执行实体提取和链接构建",
    systemPrompt: `你是一个文档编译 Agent。你的任务是：
1. 阅读原始文档内容
2. 生成结构化的 L1 概览和 L0 摘要
3. 使用 wiki_edit 创建或更新 Wiki 页面
4. 提取实体并构建链接
用中文回答，确保内容准确。`,
    tools: ["wiki_edit", "kb_search", "read", "grep", "glob"],
    readOnly: false,
    maxRounds: 5,
  },
  verify: {
    name: "VerifyAgent",
    description: "验证信息的一致性和准确性，检查矛盾",
    systemPrompt: `你是一个信息验证 Agent。你的任务是：
1. 根据待验证的声明，在知识库中检索相关证据
2. 交叉比对不同来源的信息
3. 标记确认、矛盾和无法验证的内容
4. 给出验证结论和可信度评级
用中文回答，所有判断必须基于知识库中的证据。`,
    tools: ["kb_search", "expand", "wiki_browse", "xlsx_query", "read", "grep", "glob"],
    readOnly: true,
    maxRounds: 6,
  },
  worker: {
    name: "WorkerAgent",
    description: "通用工作 Agent，可执行任何子任务",
    systemPrompt: `你是一个通用工作 Agent。根据分配的任务，使用可用工具完成工作。用中文回答。`,
    tools: [], // Empty = all tools available
    readOnly: false,
    maxRounds: 10,
  },
};

// ── Schema ─────────────────────────────────────────────────────────────

export const AgentToolSchema = z.object({
  agent_type: z.enum(["explore", "compile", "verify", "worker"]).describe("Agent 类型"),
  task: z.string().describe("子任务描述"),
  kb_id: z.string().optional().describe("知识库 ID"),
  context: z.string().optional().describe("额外上下文信息"),
});

// ── AgentTool ──────────────────────────────────────────────────────────

export const AgentTool = {
  name: "agent" as const,
  description:
    "派发子任务给内置 Agent 执行。支持三种内置类型: explore(只读探索检索)、compile(编译写入)、verify(交叉验证)。子 Agent 独立运行 TAOR 循环，完成后返回结果摘要。",
  inputSchema: {
    type: "object",
    properties: {
      agent_type: {
        type: "string",
        enum: ["explore", "compile", "verify", "worker"],
        description: "Agent 类型",
      },
      task: { type: "string", description: "子任务描述" },
      kb_id: { type: "string", description: "知识库 ID" },
      context: { type: "string", description: "额外上下文" },
    },
    required: ["agent_type", "task"],
  },
  isConcurrencySafe: false as const,

  async call(input: z.infer<typeof AgentToolSchema>): Promise<string> {
    const agentDef = BUILTIN_AGENTS[input.agent_type];
    if (!agentDef) return `[Error] Unknown agent type: ${input.agent_type}`;

    const router = getModelRouter();
    if (!router.isConfigured()) return "[Error] Model router not configured";

    // Resolve tools for this agent
    const allTools = getToolDefinitions();
    const agentTools = agentDef.tools.length > 0
      ? allTools.filter((t) => agentDef.tools.includes(t.name))
      : allTools;

    if (agentTools.length === 0) {
      return `[Error] No tools available for ${agentDef.name}`;
    }

    // Build messages
    const kbLine = input.kb_id ? `\n当前知识库 ID: ${input.kb_id}` : "";
    const contextLine = input.context ? `\n\n额外上下文:\n${input.context}` : "";

    const messages: ChatMessage[] = [
      { role: "system", content: agentDef.systemPrompt + kbLine },
      { role: "user", content: input.task + contextLine },
    ];

    let fullReply = "";
    let round = 0;
    const maxRounds = agentDef.maxRounds;

    // TAOR loop
    while (round < maxRounds) {
      round++;

      // Stream model response
      let assistantText = "";
      const pendingCalls = new Map<number, { id: string; name: string; argsRaw: string }>();

      for await (const chunk of router.chatStream(messages, { tools: agentTools })) {
        if (chunk.type === "text" && chunk.content) {
          assistantText += chunk.content;
        } else if (chunk.type === "tool_call_delta" && chunk.toolCall) {
          const tc = chunk.toolCall;
          const idx = tc.index ?? 0;
          const existing = pendingCalls.get(idx);
          if (existing) {
            if (!existing.name && tc.function?.name) existing.name = tc.function.name;
            existing.argsRaw += tc.function?.arguments || "";
          } else {
            pendingCalls.set(idx, {
              id: tc.id || crypto.randomUUID(),
              name: tc.function?.name || "",
              argsRaw: tc.function?.arguments || "",
            });
          }
        } else if (chunk.type === "done") break;
      }

      messages.push({ role: "assistant", content: assistantText });
      fullReply += assistantText;

      const toolCalls = [...pendingCalls.values()].filter((tc) => tc.name);
      if (toolCalls.length === 0) break;

      // Execute tool calls
      for (const tc of toolCalls) {
        await autoApproveAll(tc.name, tc.argsRaw, "");
        const tool = getTool(tc.name);
        let result: string;
        if (!tool) {
          result = `[Error] Unknown tool: ${tc.name}`;
        } else {
          try {
            result = await tool.call(JSON.parse(tc.argsRaw || "{}"));
          } catch (err) {
            result = `[Tool Error] ${tc.name}: ${err instanceof Error ? err.message : String(err)}`;
          }
        }

        // Truncate large results
        const truncated = result.length > 4000
          ? result.slice(0, 4000) + "\n...[截断]"
          : result;

        messages.push({ role: "user", content: `[Tool: ${tc.name}]\n${truncated}` });
      }
    }

    return [
      `## ${agentDef.name} 完成`,
      `**任务**: ${input.task}`,
      `**轮次**: ${round}`,
      "",
      fullReply.slice(0, 8000),
    ].join("\n");
  },
};
