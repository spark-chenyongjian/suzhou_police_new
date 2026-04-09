import { DB } from "./store/database.js";
import { createApp } from "./server/app.js";
import { getModelRouter } from "./models/router.js";
import { startDocling, getDoclingManager } from "./subprocess/docling-client.js";
import { existsSync } from "fs";
import { join } from "path";

// Initialize database
const db = DB.getInstance();
db.migrate();
console.log("[DB] Database initialized.");

// Initialize model router
const modelRouter = getModelRouter();
await modelRouter.initialize();
if (modelRouter.isConfigured()) {
  console.log("[ModelRouter] Initialized.");
} else {
  console.warn("[ModelRouter] No models configured. Edit config/model-config.yaml.");
}

// Start Docling subprocess (optional — requires Python + docling installed)
const doclingServiceDir = join(process.cwd(), "docling-service");
if (existsSync(join(doclingServiceDir, "main.py"))) {
  try {
    await startDocling(process.cwd());
    console.log("[Docling] Subprocess ready.");
  } catch (err) {
    console.warn("[Docling] Failed to start subprocess (document parsing unavailable):", err);
  }
} else {
  console.warn("[Docling] Service not found — document parsing unavailable.");
}

// Start HTTP server
const app = createApp();
const port = parseInt(process.env.PORT || "21000");

Bun.serve({ fetch: app.fetch, port });
console.log(`[DeepAnalyze] Server running at http://localhost:${port}`);

// Graceful shutdown
const shutdown = async () => {
  console.log("\n[DeepAnalyze] Shutting down...");
  await getDoclingManager()?.stopAll?.();
  db.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
