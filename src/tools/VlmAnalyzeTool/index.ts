/**
 * vlm_analyze — Agent 工具：调用 VLM 分析图片内容
 *
 * 通过模型路由的 vision 能力分析图片，
 * 返回描述、提取文本、识别实体。
 */

import { z } from "zod";
import { getModelRouter } from "../../models/router.js";
import { readFileSync } from "fs";

export const VlmAnalyzeToolSchema = z.object({
  image_paths: z.array(z.string()).describe("图片文件路径列表"),
  prompt: z.string().optional().describe("分析提示（如: '描述这张图片中的文字和图表'）"),
});

export const VlmAnalyzeTool = {
  name: "vlm_analyze" as const,
  description:
    "使用视觉语言模型(VLM)分析图片内容。支持识别图片中的文字(OCR)、图表数据、场景描述、物体识别。适用于 PDF 中的图表、扫描件、照片等非文本内容。返回详细描述。",
  inputSchema: {
    type: "object",
    properties: {
      image_paths: { type: "array", items: { type: "string" }, description: "图片路径列表" },
      prompt: { type: "string", description: "分析提示" },
    },
    required: ["image_paths"],
  },
  isConcurrencySafe: true as const,

  async call(input: z.infer<typeof VlmAnalyzeToolSchema>): Promise<string> {
    const router = getModelRouter();
    const results: string[] = [];

    for (const imagePath of input.image_paths) {
      try {
        // Read image and convert to base64
        const imageBuffer = readFileSync(imagePath);
        const base64 = imageBuffer.toString("base64");
        const ext = imagePath.split(".").pop()?.toLowerCase() || "png";
        const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg"
          : ext === "png" ? "image/png"
          : ext === "gif" ? "image/gif"
          : ext === "webp" ? "image/webp"
          : "image/png";

        const prompt = input.prompt || "请详细描述这张图片的内容。如果有文字，请提取所有文字内容。如果有图表，请描述数据趋势和关键数值。";

        // Use model router to analyze image
        const response = await router.chat([
          {
            role: "system",
            content: "你是一个专业的图片分析助手。用中文回答，详细准确地描述图片内容。",
          },
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
            ],
          },
        ] as any);

        results.push(`### ${imagePath}\n\n${response.content}\n`);
      } catch (err) {
        results.push(`### ${imagePath}\n\n**分析失败**: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    }

    return results.join("\n---\n\n");
  },
};
