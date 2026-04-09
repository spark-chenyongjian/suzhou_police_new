import { parseWithDocling } from "../../subprocess/docling-client.js";
import { z } from "zod";

export const DoclingParseToolSchema = z.object({
  file_path: z.string().describe("Absolute path to the document to parse"),
  ocr: z.boolean().optional().describe("Enable OCR for scanned documents"),
  vlm: z.boolean().optional().describe("Enable VLM for image description"),
});

export type DoclingParseToolInput = z.infer<typeof DoclingParseToolSchema>;

export const DoclingParseTool = {
  name: "docling_parse" as const,
  description:
    "Parse a document (PDF, Word, PPT, image) into structured Markdown. Returns full text content, extracted tables as CSV, image metadata, and document metadata (page count, format). Use this before ingesting a document into the knowledge base.",
  inputSchema: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "Absolute path to the document" },
      ocr: { type: "boolean", description: "Enable OCR (default: false)" },
      vlm: { type: "boolean", description: "Enable VLM image description (default: false)" },
    },
    required: ["file_path"],
  },
  isConcurrencySafe: true as const,

  async call(input: DoclingParseToolInput): Promise<string> {
    const result = await parseWithDocling(input.file_path, {
      ocr: input.ocr,
      vlm: input.vlm,
    });

    const summary = [
      `## Parsed: ${input.file_path}`,
      `**Format:** ${result.metadata.format || "unknown"}`,
      `**Pages:** ${result.metadata.page_count ?? "N/A"}`,
      `**Tables:** ${result.tables.length}`,
      `**Images:** ${result.images.length}`,
      "",
      "## Content",
      result.content,
    ];

    if (result.tables.length > 0) {
      summary.push("", "## Tables");
      result.tables.forEach((t, i) => {
        summary.push(`\n### Table ${i + 1} (page ${t.page ?? "?"})`);
        summary.push("```csv");
        summary.push(t.data.slice(0, 2000)); // limit preview
        summary.push("```");
      });
    }

    return summary.join("\n");
  },
};
