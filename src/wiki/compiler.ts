/**
 * Wiki Compiler — L0/L1/L2 分层编译器
 *
 * 参考 Karpathy LLM Wiki 理念：
 *   L0 (~100 tokens): 一句话摘要 + 关键实体标签
 *   L1 (~2000 tokens): 结构导航 + 实体列表 + 正反向链接
 *   L2: 完整 Markdown (无限制)
 *
 * 编译流程（优化后）:
 *   1. L2 存储原文 → 文档立即可用 (status=ready)
 *   2. L1 生成概览 → 快速提取标题结构 (无需 LLM)
 *   3. L0 生成摘要 → 后台 LLM 调用 (非阻塞)
 */

import { join } from "path";
import { getModelRouter } from "../models/router.js";
import { createWikiPage } from "./page-manager.js";
import { extractEntities, buildEntityLinks } from "./entity-extractor.js";
import type { ChatMessage } from "../models/provider.js";

export interface CompileOptions {
  kbId: string;
  docId: string;
  filename: string;
  parsedContent: string; // L2: parsed Markdown output
  metadata?: Record<string, unknown>;
  onProgress?: (stage: string) => void;
  /** If true, skip LLM calls entirely and use fast local extraction. Default: true */
  fastMode?: boolean;
}

export interface CompileResult {
  l0PageId: string;
  l1PageId: string;
  l2PageId: string;
}

const LLM_TIMEOUT_MS = 120_000; // 2 minutes per LLM call

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms),
    ),
  ]);
}

/**
 * Quick local extraction of document structure from Markdown content.
 * No LLM needed — just parse headings and first paragraph.
 */
function extractQuickL1(filename: string, content: string): string {
  const lines = content.split("\n");
  const headings: string[] = [];
  let firstParagraph = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^#{1,4}\s/.test(trimmed)) {
      // Extract heading text
      const heading = trimmed.replace(/^#+\s+/, "").trim();
      if (heading) headings.push(`- ${heading}`);
    } else if (!firstParagraph && trimmed.length > 20 && !trimmed.startsWith("|") && !trimmed.startsWith("```") && !trimmed.startsWith(">")) {
      firstParagraph = trimmed.slice(0, 200);
    }
    if (headings.length >= 30 && firstParagraph) break; // Enough info
  }

  const wordCount = content.length;
  const headingList = headings.length > 0
    ? `## 文档结构\n\n${headings.join("\n")}`
    : "*（未检测到标准 Markdown 标题结构）*";

  return `# ${filename} — 快速概览\n\n> 自动提取（待 LLM 增强）\n\n**文件大小**: ${(wordCount / 1024).toFixed(1)} KB\n\n${firstParagraph ? `## 摘要\n\n${firstParagraph}${firstParagraph.length >= 200 ? "..." : ""}\n` : ""}\n${headingList}\n`;
}

function extractQuickL0(filename: string, content: string): string {
  // Extract first meaningful line as abstract
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 10 && !trimmed.startsWith("#") && !trimmed.startsWith("|") && !trimmed.startsWith("```") && !trimmed.startsWith(">") && !trimmed.startsWith("-")) {
      return `**一句话摘要**：${trimmed.slice(0, 150)}\n**文档类型**：文档\n`;
    }
  }
  return `**一句话摘要**：${filename}\n**文档类型**：文档\n`;
}

export async function compileDocument(opts: CompileOptions): Promise<CompileResult> {
  const { kbId, docId, filename, parsedContent, metadata, onProgress } = opts;
  const basePath = join("wiki", kbId, "documents", docId);
  const fastMode = opts.fastMode !== false; // Default true

  // ── L2: Store raw content (immediate) ─────────────────────────────────────
  onProgress?.("L2: 存储原始内容");
  const l2Page = createWikiPage({
    kbId,
    docId,
    pageType: "fulltext",
    title: filename,
    content: parsedContent,
    filePath: join(basePath, "parsed.md"),
    metadata,
  });

  // ── L1: Generate overview ─────────────────────────────────────────────────
  let l1Content: string;
  if (fastMode) {
    // Fast path: local extraction, no LLM
    onProgress?.("L1: 快速提取文档结构");
    l1Content = extractQuickL1(filename, parsedContent);
  } else {
    // Slow path: LLM generation
    onProgress?.("L1: 生成结构化概览 (LLM)");
    const router = getModelRouter();
    const l1Prompt = buildL1Prompt(filename, parsedContent);
    const l1Resp = await withTimeout(router.chat(l1Prompt), LLM_TIMEOUT_MS, "L1 generation");
    l1Content = l1Resp.content;
  }

  const l1Page = createWikiPage({
    kbId,
    docId,
    pageType: "overview",
    title: `[L1] ${filename}`,
    content: l1Content,
    filePath: join(basePath, ".overview.md"),
    tokenCount: l1Content.length,
    metadata,
  });

  // ── L0: Generate abstract ─────────────────────────────────────────────────
  let l0Content: string;
  if (fastMode) {
    // Fast path: local extraction
    onProgress?.("L0: 快速生成摘要");
    l0Content = extractQuickL0(filename, parsedContent);
  } else {
    onProgress?.("L0: 生成一句话摘要 (LLM)");
    const router = getModelRouter();
    const l0Prompt = buildL0Prompt(filename, l1Content);
    const l0Resp = await withTimeout(router.chat(l0Prompt), LLM_TIMEOUT_MS, "L0 generation");
    l0Content = l0Resp.content;
  }

  const l0Page = createWikiPage({
    kbId,
    docId,
    pageType: "abstract",
    title: `[L0] ${filename}`,
    content: l0Content,
    filePath: join(basePath, ".abstract.md"),
    tokenCount: l0Content.length,
    metadata,
  });

  // ── Entity extraction + link building (only in non-fast mode) ──────────────
  if (!fastMode) {
    onProgress?.("实体提取 (LLM)");
    try {
      const { entities } = await extractEntities(l1Content, filename);
      if (entities.length > 0) {
        await buildEntityLinks(kbId, l1Page.id, entities);
        onProgress?.(`提取到 ${entities.length} 个实体`);
      }
    } catch (err) {
      console.warn(`[Compiler] Entity extraction failed for ${filename}:`, err);
    }
  }

  return { l0PageId: l0Page.id, l1PageId: l1Page.id, l2PageId: l2Page.id };
}

// ─── LLM Prompt builders (used when fastMode=false) ─────────────────────────

function buildL1Prompt(filename: string, fullText: string): ChatMessage[] {
  const truncated = fullText.length > 60_000 ? fullText.slice(0, 60_000) + "\n...[截断]" : fullText;
  return [
    {
      role: "system",
      content: `你是一个专业的文档分析助手，负责生成文档的结构化概览（L1层）。
L1概览约2000 tokens，包含：
1. 文档结构导航（章节标题+各节核心摘要，1-2句）
2. 关键实体列表（人物、机构、地点、时间、金额等，标注出现次数）
3. 数据摘要（如含表格：Schema+统计摘要）
4. 正向链接标注：文档中引用/提及的外部实体或事件（用 [[实体名]] 标记）
5. 结尾：文档类型标签（如：合同/报告/账单/证据材料/调查笔录 等）
输出纯Markdown，不要解释你的操作。`,
    },
    {
      role: "user",
      content: `文档名称：${filename}\n\n文档内容：\n\n${truncated}`,
    },
  ];
}

function buildL0Prompt(filename: string, l1Overview: string): ChatMessage[] {
  return [
    {
      role: "system",
      content: `你是一个文档摘要专家，负责生成文档的极简摘要（L0层）。
L0摘要约100 tokens，格式固定：
**一句话摘要**：<最核心内容，含时间/主体/事件>
**关键实体**：[实体1, 实体2, 实体3, ...]（5-10个最重要实体）
**文档类型**：<类型标签>
只输出以上格式，不要其他内容。`,
    },
    {
      role: "user",
      content: `文档名称：${filename}\n\nL1概览：\n\n${l1Overview}`,
    },
  ];
}
