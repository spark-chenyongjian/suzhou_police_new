import { Hono } from "hono";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { getModelRouter } from "../../models/router.js";

const CONFIG_PATH = join(process.cwd(), "config", "model-config.yaml");

export const settingsRoutes = new Hono();

settingsRoutes.get("/model-config", (c) => {
  try {
    if (!existsSync(CONFIG_PATH)) return c.json({ error: "Config file not found" }, 404);
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    return c.text(raw, 200, { "Content-Type": "text/plain; charset=utf-8" });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

settingsRoutes.put("/model-config", async (c) => {
  try {
    const body = await c.req.text();
    if (!body.trim()) return c.json({ error: "Empty config" }, 400);
    writeFileSync(CONFIG_PATH, body, "utf-8");
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// Read/write as structured JSON for the UI
settingsRoutes.get("/model", (c) => {
  try {
    if (!existsSync(CONFIG_PATH)) return c.json({ endpoint: "", model: "", apiKey: "", maxTokens: 32768 });
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    // Parse the main model section from YAML manually (avoid heavy dep)
    // Only match uncommented lines (not starting with optional whitespace + #)
    const lines = raw.split("\n");
    const get = (key: string) => {
      const line = lines.find((l) => /^\s+/.test(l) && !l.trimStart().startsWith("#") && l.includes(`${key}:`));
      if (!line) return "";
      return line.split(`${key}:`)[1]?.trim() ?? "";
    };
    return c.json({
      endpoint: get("endpoint"),
      model: get("model"),
      apiKey: get("apiKey"),
      maxTokens: parseInt(get("maxTokens")) || 32768,
    });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

settingsRoutes.put("/model", async (c) => {
  try {
    const body = await c.req.json<{
      endpoint: string;
      model: string;
      apiKey?: string;
      maxTokens?: number;
    }>();

    // Build clean YAML — avoid regex patching which can corrupt commented example blocks
    const apiKeyLine = body.apiKey?.trim()
      ? `    apiKey: ${body.apiKey.trim()}\n`
      : `    # apiKey: sk-xxx  # Required for remote APIs, optional for local\n`;

    const yaml =
      `# DeepAnalyze Model Configuration\n` +
      `# Supports any OpenAI-compatible endpoint (Ollama, vLLM, LM Studio, Claude API, etc.)\n\n` +
      `models:\n` +
      `  main:\n` +
      `    provider: openai-compatible\n` +
      `    endpoint: ${body.endpoint}\n` +
      apiKeyLine +
      `    model: ${body.model}\n` +
      `    maxTokens: ${body.maxTokens || 32768}\n` +
      `    supportsToolUse: true\n\n` +
      `defaults:\n` +
      `  main: main\n`;

    writeFileSync(CONFIG_PATH, yaml, "utf-8");

    // Reload model router with new config
    try {
      await getModelRouter().reload();
      console.log("[Settings] Model router reloaded with new config.");
    } catch (reloadErr) {
      console.warn("[Settings] Failed to reload model router:", reloadErr);
    }
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});
