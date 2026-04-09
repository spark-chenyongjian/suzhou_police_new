import { Hono } from "hono";
import { createMessage, getMessages } from "../../store/messages.js";
import { getSession } from "../../store/sessions.js";
import { getModelRouter } from "../../models/router.js";
import { getToolDefinitions, getTool } from "../../tools/registry.js";
import { autoApproveAll } from "../../core/permissions.js";
import type { ChatMessage } from "../../models/provider.js";

export const chatRoutes = new Hono();

const MAX_TOOL_ROUNDS = 20; // TAOR loop limit

// Non-streaming send (quick ACK)
chatRoutes.post("/send", async (c) => {
  const { sessionId, content } = await c.req.json<{ sessionId: string; content: string }>();
  if (!getSession(sessionId)) return c.json({ error: "Session not found" }, 404);
  const userMsg = createMessage(sessionId, "user", content);
  return c.json({ messageId: userMsg.id, status: "received" });
});

// Streaming chat with Tool Use (TAOR loop via SSE)
chatRoutes.post("/stream", async (c) => {
  const { sessionId, content, kbId } = await c.req.json<{
    sessionId: string;
    content: string;
    kbId?: string;
  }>();

  if (!getSession(sessionId)) return c.json({ error: "Session not found" }, 404);

  // Store user message
  createMessage(sessionId, "user", content);

  // Build conversation history as ChatMessages
  const history = getMessages(sessionId);
  const messages: ChatMessage[] = history.map((m) => ({
    role: m.role === "tool" ? "assistant" : (m.role as "user" | "assistant"),
    content: m.content || "",
  }));

  const router = getModelRouter();
  const tools = getToolDefinitions();

  // System prompt — context assembly
  const systemPrompt = buildSystemPrompt(kbId);

  return new Response(
    new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (data: object) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        try {
          let fullReply = "";
          let round = 0;
          const msgs: ChatMessage[] = [
            { role: "system", content: systemPrompt },
            ...messages,
          ];

          // TAOR Loop: Think → Act → Observe → Repeat
          while (round < MAX_TOOL_ROUNDS) {
            round++;
            let assistantText = "";
            const pendingToolCalls: Array<{ id: string; name: string; argsRaw: string }> = [];

            // Stream from model
            for await (const chunk of router.chatStream(msgs, { tools })) {
              if (chunk.type === "text" && chunk.content) {
                assistantText += chunk.content;
                fullReply += chunk.content;
                send({ type: "text", content: chunk.content });
              } else if (chunk.type === "tool_call_delta" && chunk.toolCall) {
                const tc = chunk.toolCall;
                const existing = pendingToolCalls.find((p) => p.id === tc.id);
                if (existing) {
                  existing.argsRaw += tc.function?.arguments || "";
                } else {
                  pendingToolCalls.push({
                    id: tc.id || crypto.randomUUID(),
                    name: tc.function?.name || "",
                    argsRaw: tc.function?.arguments || "",
                  });
                }
              } else if (chunk.type === "done") {
                break;
              }
            }

            // Add assistant turn to history
            msgs.push({ role: "assistant", content: assistantText });

            // If no tool calls, conversation turn is done
            if (pendingToolCalls.length === 0) break;

            // Execute tool calls (auto-approved)
            send({ type: "tool_calls_start", count: pendingToolCalls.length });

            for (const tc of pendingToolCalls) {
              await autoApproveAll(tc.name, tc.argsRaw, sessionId);

              send({ type: "tool_call", name: tc.name });

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

              // Store tool result in conversation
              createMessage(sessionId, "tool", toolResult, { toolName: tc.name, toolCallId: tc.id });

              // Add tool result to msg history
              msgs.push({ role: "user", content: `[Tool: ${tc.name}]\n${toolResult}` });

              send({ type: "tool_result", name: tc.name, resultLength: toolResult.length });
            }
          }

          // Store final assistant reply
          if (fullReply) {
            createMessage(sessionId, "assistant", fullReply);
          }

          send({ type: "done" });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          send({ type: "error", error: msg });
        } finally {
          controller.close();
        }
      },
    }),
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    },
  );
});

function buildSystemPrompt(kbId?: string): string {
  const base = `你是 DeepAnalyze 深度分析系统的 AI 助手，具备以下能力：
- 通过 kb_search 工具在知识库中检索相关文档
- 通过 expand 工具逐层展开文档细节（L0摘要 → L1概览 → L2全文）
- 通过 wiki_browse 工具浏览知识库索引和实体页面
- 通过 docling_parse 工具解析新文档

工作原则：
1. 所有结论必须基于知识库内容，引用时标注来源文档
2. 先用 kb_search 搜索，再用 expand 深入细节，避免一次加载过多内容
3. 对复杂问题，制定检索计划后再执行
4. 如果检索结果不足，尝试不同关键词或扩展搜索范围`;

  if (kbId) {
    return `${base}\n\n当前知识库 ID: ${kbId}\n检索时请使用此 kbId。`;
  }
  return base;
}
