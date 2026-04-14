/**
 * Audio parser — DashScope speech-to-text transcription.
 *
 * Uses Alibaba Cloud DashScope's OpenAI-compatible audio transcription
 * API (SenseVoice model) to convert speech to text.
 *
 * Endpoint: https://dashscope.aliyuncs.com/compatible-mode/v1/audio/transcriptions
 * Model: sensevoice-v1
 */

import { readFileSync, statSync } from "fs";
import { getModelRouter } from "../models/router.js";
import { parse as parseYaml } from "yaml";
import { readFileSync as readYaml, existsSync } from "fs";
import { join } from "path";
import { CONFIG_DIR } from "../paths.js";

const AUDIO_EXTENSIONS = new Set(["wav", "mp3", "m4a", "flac", "ogg", "aac", "wma", "opus"]);

export function isAudioFile(ext: string): boolean {
  return AUDIO_EXTENSIONS.has(ext.toLowerCase());
}

function getApiKey(): string {
  // Read API key from model config
  const configPath = join(CONFIG_DIR, "model-config.yaml");
  if (!existsSync(configPath)) {
    throw new Error("model-config.yaml not found — cannot get API key for audio transcription");
  }
  const raw = readYaml(configPath, "utf-8");
  const config = parseYaml(raw) as {
    models: Record<string, { apiKey?: string }>;
  };
  for (const cfg of Object.values(config.models)) {
    if (cfg.apiKey) return cfg.apiKey;
  }
  throw new Error("No API key found in model-config.yaml");
}

export async function parseAudio(
  filePath: string,
  filename: string,
): Promise<string> {
  const fileSize = statSync(filePath).size;

  // DashScope limit is ~500MB
  if (fileSize > 500 * 1024 * 1024) {
    return `# ${filename}\n\n*音频文件过大（${(fileSize / 1024 / 1024).toFixed(1)} MB），无法转录。*\n`;
  }

  const apiKey = getApiKey();
  const ext = filename.split(".").pop()?.toLowerCase() || "wav";

  const mimeType =
    ext === "mp3" ? "audio/mpeg" :
    ext === "wav" ? "audio/wav" :
    ext === "m4a" ? "audio/mp4" :
    ext === "flac" ? "audio/flac" :
    ext === "ogg" ? "audio/ogg" :
    ext === "aac" ? "audio/aac" :
    "audio/wav";

  const fileBuffer = readFileSync(filePath);

  // Build multipart/form-data manually
  const boundary = `----FormBoundary${crypto.randomUUID().replace(/-/g, "")}`;
  const parts: Uint8Array[] = [];

  // model field
  const modelHeader = `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nsensevoice-v1\r\n`;
  parts.push(new TextEncoder().encode(modelHeader));

  // file field
  const fileHeader = `--boundary\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`;
  // Actually let me use the proper boundary
  const fileHeaderProper = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`;
  parts.push(new TextEncoder().encode(fileHeaderProper));
  parts.push(new Uint8Array(fileBuffer));
  parts.push(new TextEncoder().encode(`\r\n--${boundary}--\r\n`));

  // Concatenate all parts
  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  const body = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.length;
  }

  console.log(`[AudioParser] Transcribing ${filename} (${(fileSize / 1024).toFixed(0)} KB)...`);

  const resp = await fetch(
    "https://dashscope.aliyuncs.com/compatible-mode/v1/audio/transcriptions",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body: body,
    },
  );

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => "");
    throw new Error(`DashScope STT API error ${resp.status}: ${errorText}`);
  }

  const data = await resp.json() as { text?: string };

  if (!data.text || data.text.trim().length === 0) {
    return `# ${filename}\n\n*语音转录完成，但未识别到有效文字内容。*\n`;
  }

  console.log(`[AudioParser] Transcription complete: ${data.text.length} chars`);

  return `# ${filename}\n\n## 语音转录内容\n\n${data.text}\n`;
}
