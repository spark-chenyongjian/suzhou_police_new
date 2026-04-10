import { Hono } from "hono";
import { createSession, listSessions, getSession, updateSession, deleteSession } from "../../store/sessions.js";
import { getMessages } from "../../store/messages.js";

export const sessionRoutes = new Hono();

sessionRoutes.get("/", (c) => c.json(listSessions()));

sessionRoutes.post("/", async (c) => {
  const body = await c.req.json<{ title?: string; kbScope?: Record<string, unknown> }>();
  return c.json(createSession(body.title, body.kbScope), 201);
});

sessionRoutes.get("/:id", (c) => {
  const session = getSession(c.req.param("id"));
  if (!session) return c.json({ error: "Session not found" }, 404);
  return c.json(session);
});

sessionRoutes.patch("/:id", async (c) => {
  const { title } = await c.req.json<{ title: string }>();
  updateSession(c.req.param("id"), title);
  return c.json({ ok: true });
});

sessionRoutes.delete("/:id", (c) => {
  deleteSession(c.req.param("id"));
  return c.json({ ok: true });
});

sessionRoutes.get("/:id/messages", (c) => {
  return c.json(getMessages(c.req.param("id")));
});
