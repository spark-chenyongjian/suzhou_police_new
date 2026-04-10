import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { sessionRoutes } from "./routes/sessions.js";
import { chatRoutes } from "./routes/chat.js";
import { kbRoutes } from "./routes/knowledge-bases.js";
import { searchRoutes } from "./routes/search.js";
import { settingsRoutes } from "./routes/settings.js";

export function createApp(): Hono {
  const app = new Hono();

  app.use("*", cors());

  // API routes
  app.route("/api/sessions", sessionRoutes);
  app.route("/api/chat", chatRoutes);
  app.route("/api/kb", kbRoutes);
  app.route("/api/search", searchRoutes);
  app.route("/api/settings", settingsRoutes);
  app.get("/api/health", (c) =>
    c.json({ status: "ok", version: "0.1.0", timestamp: new Date().toISOString() }),
  );

  // Serve React frontend build
  app.use("/*", serveStatic({ root: "./frontend/dist" }));

  return app;
}
