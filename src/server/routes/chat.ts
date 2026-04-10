import { Hono } from "hono";
import { createMessage } from "../../store/messages.js";
import { getSession } from "../../store/sessions.js";
import { QueryEngine } from "../../core/QueryEngine.js";

export const chatRoutes = new Hono();

// Non-streaming send (quick ACK)
chatRoutes.post("/send", async (c) => {
  const { sessionId, content } = await c.req.json<{ sessionId: string; content: string }>();
  if (!getSession(sessionId)) return c.json({ error: "Session not found" }, 404);
  const userMsg = createMessage(sessionId, "user", content);
  return c.json({ messageId: userMsg.id, status: "received" });
});

// Streaming chat with TAOR loop via SSE
chatRoutes.post("/stream", async (c) => {
  const { sessionId, content, kbId } = await c.req.json<{
    sessionId: string;
    content: string;
    kbId?: string;
  }>();

  if (!getSession(sessionId)) return c.json({ error: "Session not found" }, 404);

  const engine = new QueryEngine();

  return new Response(
    new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (data: object) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        try {
          await engine.run({
            sessionId,
            content,
            kbId,
            onEvent: (event) => {
              if (event.type === "done") {
                send({ type: "done" });
              } else if (event.type === "error") {
                send({ type: "error", error: event.error });
              } else {
                send(event);
              }
            },
          });
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
