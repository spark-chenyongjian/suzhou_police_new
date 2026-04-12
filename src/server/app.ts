import { Hono } from "hono";
import { cors } from "hono/cors";
import { join } from "path";
import { readFileSync, existsSync } from "fs";
import { sessionRoutes } from "./routes/sessions.js";
import { chatRoutes } from "./routes/chat.js";
import { kbRoutes } from "./routes/knowledge-bases.js";
import { searchRoutes } from "./routes/search.js";
import { settingsRoutes } from "./routes/settings.js";
import { pluginRoutes } from "./routes/plugins.js";
import { FRONTEND_DIST } from "../paths.js";

// MIME types for static files
const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export function createApp(): Hono {
  const app = new Hono();

  app.use("*", cors());

  // API routes
  app.route("/api/sessions", sessionRoutes);
  app.route("/api/chat", chatRoutes);
  app.route("/api/kb", kbRoutes);
  app.route("/api/search", searchRoutes);
  app.route("/api/settings", settingsRoutes);
  app.route("/api/plugins", pluginRoutes);
  app.get("/api/health", (c) =>
    c.json({ status: "ok", version: "0.1.0", timestamp: new Date().toISOString() }),
  );

  // Serve React frontend build — manual static file serving
  app.get("/*", (c) => {
    let reqPath = c.req.path;
    // Skip API routes
    if (reqPath.startsWith("/api/")) return c.notFound();

    const filePath = join(FRONTEND_DIST, reqPath === "/" ? "index.html" : reqPath);

    if (existsSync(filePath) && !filePath.endsWith("/")) {
      const ext = filePath.slice(filePath.lastIndexOf("."));
      const contentType = MIME[ext] || "application/octet-stream";
      return new Response(readFileSync(filePath), {
        headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=3600" },
      });
    }

    // SPA fallback: serve index.html for client-side routing
    const indexPath = join(FRONTEND_DIST, "index.html");
    if (existsSync(indexPath)) {
      return new Response(readFileSync(indexPath), {
        headers: { "Content-Type": "text/html" },
      });
    }

    return c.text("Frontend not built. Run: cd frontend && bun run build", 404);
  });

  return app;
}
