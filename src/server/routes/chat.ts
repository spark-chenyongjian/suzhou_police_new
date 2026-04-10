import { Hono } from "hono";
import { createMessage, getMessages } from "../../store/messages.js";
import { getSession } from "../../store/sessions.js";
import { getModelRouter } from "../../models/router.js";
import { getToolDefinitions, getTool } from "../../tools/registry.js";
import { autoApproveAll } from "../../core/permissions.js";
import type { ChatMessage } from "../../models/provider.js";
import { listKnowledgeBases } from "../../store/knowledge-bases.js";

export const chatRoutes = new Hono();

const MAX_TOOL_ROUNDS = 10; // TAOR loop limit
const MAX_TOOL_RESULT_CHARS = 4000; // Truncate large tool results to prevent context overflow

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
            // Map by index — OpenAI streaming identifies tool calls by index across deltas
            const pendingByIndex = new Map<number, { id: string; name: string; argsRaw: string }>();

            // Stream from model
            for await (const chunk of router.chatStream(msgs, { tools })) {
              if (chunk.type === "text" && chunk.content) {
                assistantText += chunk.content;
                fullReply += chunk.content;
                send({ type: "text", content: chunk.content });
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

            const pendingToolCalls = Array.from(pendingByIndex.values()).filter((tc) => tc.name);

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

              // Truncate large tool results to prevent context overflow
              const truncated = toolResult.length > MAX_TOOL_RESULT_CHARS
                ? toolResult.slice(0, MAX_TOOL_RESULT_CHARS) + `\n...[结果已截断，共 ${toolResult.length} 字符]`
                : toolResult;

              // Add tool result to msg history
              msgs.push({ role: "user", content: `[Tool: ${tc.name}]\n${truncated}` });

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

  return `你是 DeepAnalyze 深度分析系统的 AI 助手。${kbSection}

## 可用工具
- **kb_search**: 全文检索知识库（优先使用，效率最高）
- **wiki_browse**: 浏览知识库索引/摘要/实体（view=abstracts 可快速了解全局）
- **expand**: 展开具体页面的详细内容（L0→L1→L2）
- **report_generate**: 生成并保存分析报告（最终步骤，必须调用才能保存报告）

## 工作原则
1. **高效检索**：优先 kb_search，必要时才用 wiki_browse；避免重复检索相同内容
2. **控制轮次**：3~5 次检索后即可整合分析，不要无限循环
3. **必须生成报告**：用户要求生成报告时，最终必须调用 report_generate 保存，否则报告不会出现在分析报告页面
4. **引用来源**：所有结论标注来源文档
5. **中文回复**：始终用中文回答`;
}
