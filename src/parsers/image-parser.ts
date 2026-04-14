/**
 * Image parser — VLM-based OCR and content description.
 *
 * Reads an image file, converts to base64, and sends to the
 * configured VLM (Qwen-VL via DashScope) for text extraction
 * and content description.
 */

import { getModelRouter } from "../models/router.js";
import { readFileSync } from "fs";

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp"]);

export function isImageFile(ext: string): boolean {
  return IMAGE_EXTENSIONS.has(ext.toLowerCase());
}

function getMimeType(ext: string): string {
  switch (ext.toLowerCase()) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "bmp":
      return "image/bmp";
    default:
      return "image/png";
  }
}

export async function parseImage(
  filePath: string,
  filename: string,
): Promise<string> {
  const ext = filename.split(".").pop()?.toLowerCase() || "png";
  const imageBuffer = readFileSync(filePath);
  const base64 = imageBuffer.toString("base64");
  const mimeType = getMimeType(ext);

  // Limit base64 size to ~20MB to avoid API limits
  if (base64.length > 20_000_000) {
    return `# ${filename}\n\n*图片文件过大（${(imageBuffer.length / 1024 / 1024).toFixed(1)} MB），无法通过 VLM 分析。请使用较小的图片。*\n`;
  }

  const router = getModelRouter();

  const response = await router.chat(
    [
      {
        role: "system",
        content:
          "你是一个专业的图片内容分析助手。请详细描述图片内容，特别注意：1) 提取所有可见文字（OCR）2) 描述图片中的场景、人物、物体 3) 如果是文档扫描件，完整提取所有文字内容。用中文回答，输出 Markdown 格式。",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "请详细分析这张图片，提取所有文字内容并描述图片内容。",
          },
          {
            type: "image_url",
            image_url: {
              url: `data:${mimeType};base64,${base64}`,
            },
          },
        ],
      },
    ] as any,
    { maxTokens: 4096 },
  );

  return `# ${filename}\n\n${response.content}`;
}
