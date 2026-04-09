/**
 * Wiki Compiler — L0/L1/L2 分层编译器
 *
 * 参考 Karpathy LLM Wiki 理念：
 *   L0 (~100 tokens): 一句话摘要 + 关键实体标签
 *   L1 (~2000 tokens): 结构导航 + 实体列表 + 正反向链接
 *   L2: Docling 解析的完整 Markdown (无限制)
 *
 * 编译流程: Docling输出 -> L2(存储原文) -> L1(Agent生成概览) -> L0(Agent压缩摘要)
 */

import { join } from "path";
import { getModelRouter } from "../models/router.js";
import { createWikiPage, listWikiPagesByDoc, wikiDir, docDir } from "./page-manager.js";
import type { ChatMessage } from "../models/provider.js";

export interface CompileOptions {
  kbId: string;
  docId: string;
  filename: string;
  parsedContent: string; // L2: Docling Markdown output
  metadata?: Record<string, unknown>;
  onProgress?: (stage: string) => void;
}

export interface CompileResult {
  l0PageId: string;
  l1PageId: string;
  l2PageId: string;
}

export async function compileDocument(opts: CompileOptions): Promise<CompileResult> {
  const { kbId, docId, filename, parsedContent, metadata, onProgress } = opts;
  const router = getModelRouter();
  const basePath = join("wiki", kbId, "documents", docId);

  // ── L2: Store raw Docling output ──────────────────────────────────────────
  onProgress?.("L2: 存储原始解析内容");
  const l2Page = createWikiPage({
    kbId,
    docId,
    pageType: "fulltext",
    title: filename,
    content: parsedContent,
    filePath: join(basePath, "parsed.md"),
    metadata,
  });

  // ── L1: Agent generates structured overview ───────────────────────────────
  onProgress?.("L1: 生成结构化概览 (Agent)");
  const l1Prompt = buildL1Prompt(filename, parsedContent);
  const l1Resp = await router.chat(l1Prompt);
  const l1Content = l1Resp.content;
  const l1Tokens = router.estimateTokens(l1Content);

  const l1Page = createWikiPage({
    kbId,
    docId,
    pageType: "overview",
    title: `[L1] ${filename}`,
    content: l1Content,
    filePath: join(basePath, ".overview.md"),
    tokenCount: l1Tokens,
    metadata,
  });

  // ── L0: Agent compresses to abstract ─────────────────────────────────────
  onProgress?.("L0: 生成一句话摘要 (Agent)");
  const l0Prompt = buildL0Prompt(filename, l1Content);
  const l0Resp = await router.chat(l0Prompt);
  const l0Content = l0Resp.content;
  const l0Tokens = router.estimateTokens(l0Content);

  const l0Page = createWikiPage({
    kbId,
    docId,
    pageType: "abstract",
    title: `[L0] ${filename}`,
    content: l0Content,
    filePath: join(basePath, ".abstract.md"),
    tokenCount: l0Tokens,
    metadata,
  });

  return { l0PageId: l0Page.id, l1PageId: l1Page.id, l2PageId: l2Page.id };
}

// ─── Prompt builders ─────────────────────────────────────────────────────────

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
