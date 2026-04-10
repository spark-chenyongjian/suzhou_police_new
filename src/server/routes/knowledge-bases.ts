import { Hono } from "hono";
import { createHash } from "crypto";
import { join } from "path";
import { mkdirSync, writeFileSync } from "fs";
import {
  createKnowledgeBase,
  listKnowledgeBases,
  getKnowledgeBase,
  updateKnowledgeBase,
  deleteKnowledgeBase,
  createDocument,
  updateDocumentStatus,
  listDocuments,
  getDocument,
  deleteDocument,
} from "../../store/knowledge-bases.js";
import { compileDocument } from "../../wiki/compiler.js";
import { indexPageInFts } from "../../wiki/search.js";
import {
  getWikiPage, getWikiPageContent, listWikiPagesByDoc, listWikiPagesByKb,
  updateWikiPage, deleteWikiPage,
} from "../../wiki/page-manager.js";
import { estimateTokensCJK } from "../../models/provider.js";

const DATA_DIR = join(process.cwd(), "data");

export const kbRoutes = new Hono();

// ── Knowledge Bases ────────────────────────────────────────────────────────

kbRoutes.get("/", (c) => c.json(listKnowledgeBases()));

kbRoutes.post("/", async (c) => {
  const body = await c.req.json<{ name: string; description?: string }>();
  if (!body.name) return c.json({ error: "name is required" }, 400);
  return c.json(createKnowledgeBase({ name: body.name, description: body.description }), 201);
});

kbRoutes.get("/:kbId", (c) => {
  const kb = getKnowledgeBase(c.req.param("kbId"));
  if (!kb) return c.json({ error: "Knowledge base not found" }, 404);
  return c.json(kb);
});

kbRoutes.patch("/:kbId", async (c) => {
  const body = await c.req.json<{ name?: string; description?: string }>();
  const kb = updateKnowledgeBase(c.req.param("kbId"), body);
  if (!kb) return c.json({ error: "Knowledge base not found" }, 404);
  return c.json(kb);
});

kbRoutes.delete("/:kbId", (c) => {
  const kbId = c.req.param("kbId");
  if (!getKnowledgeBase(kbId)) return c.json({ error: "Knowledge base not found" }, 404);
  deleteKnowledgeBase(kbId);
  return c.json({ ok: true });
});

// ── Wiki pages list ───────────────────────────────────────────────────────

kbRoutes.get("/:kbId/wiki/pages", (c) => {
  const pages = listWikiPagesByKb(c.req.param("kbId"));
  return c.json(pages.map((p) => ({
    id: p.id,
    title: p.title,
    pageType: p.pageType,
    docId: p.docId,
    tokenCount: p.tokenCount,
    createdAt: p.createdAt,
  })));
});

kbRoutes.get("/:kbId/wiki/pages/:pageId/content", (c) => {
  const page = getWikiPage(c.req.param("pageId"));
  if (!page || page.kbId !== c.req.param("kbId")) return c.json({ error: "Not found" }, 404);
  return c.text(getWikiPageContent(page));
});

// ── Documents ─────────────────────────────────────────────────────────────

kbRoutes.get("/:kbId/documents", (c) => {
  return c.json(listDocuments(c.req.param("kbId")));
});

kbRoutes.get("/:kbId/documents/:docId", (c) => {
  const doc = getDocument(c.req.param("docId"));
  if (!doc || doc.kbId !== c.req.param("kbId")) return c.json({ error: "Not found" }, 404);
  return c.json(doc);
});

kbRoutes.delete("/:kbId/documents/:docId", (c) => {
  const doc = getDocument(c.req.param("docId"));
  if (!doc || doc.kbId !== c.req.param("kbId")) return c.json({ error: "Not found" }, 404);
  deleteDocument(doc.id);
  return c.json({ ok: true });
});

kbRoutes.post("/:kbId/documents/:docId/retry", async (c) => {
  const doc = getDocument(c.req.param("docId"));
  if (!doc || doc.kbId !== c.req.param("kbId")) return c.json({ error: "Not found" }, 404);
  if (doc.status !== "error") return c.json({ error: "Document is not in error state" }, 400);

  triggerCompilation(doc.id, doc.kbId, doc.filename, doc.filePath || "").catch((err) => {
    console.error(`[Compile] Retry error for doc ${doc.id}:`, err);
    updateDocumentStatus(doc.id, "error", { error: String(err) });
  });
  return c.json({ ok: true, status: "retrying" });
});

kbRoutes.get("/:kbId/documents/:docId/pages", (c) => {
  const pages = listWikiPagesByDoc(c.req.param("docId"));
  return c.json(pages);
});

kbRoutes.get("/:kbId/documents/:docId/pages/:pageId/content", (c) => {
  const page = getWikiPage(c.req.param("pageId"));
  if (!page) return c.json({ error: "Page not found" }, 404);
  return c.text(getWikiPageContent(page));
});

// ── File Upload + Compile pipeline ────────────────────────────────────────

kbRoutes.post("/:kbId/documents/upload", async (c) => {
  const kbId = c.req.param("kbId");
  const kb = getKnowledgeBase(kbId);
  if (!kb) return c.json({ error: "Knowledge base not found" }, 404);

  // Parse multipart form
  const form = await c.req.formData();
  const file = form.get("file") as File | null;
  if (!file) return c.json({ error: "No file provided" }, 400);

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);
  const hash = createHash("sha256").update(buffer).digest("hex");
  const ext = file.name.split(".").pop() || "bin";
  const safeFilename = file.name.replace(/[^a-zA-Z0-9._\u4e00-\u9fff-]/g, "_");

  // Save original file
  const origDir = join(DATA_DIR, "wiki", kbId, "originals");
  mkdirSync(origDir, { recursive: true });
  const origPath = join(origDir, `${hash.slice(0, 8)}_${safeFilename}`);
  writeFileSync(origPath, buffer);

  // Create document record
  const doc = createDocument({
    kbId,
    filename: file.name,
    filePath: origPath,
    fileHash: hash,
    fileSize: buffer.length,
    fileType: ext,
  });

  // Trigger async compilation (non-blocking)
  triggerCompilation(doc.id, kbId, file.name, origPath).catch((err) => {
    console.error(`[Compile] Error for doc ${doc.id}:`, err);
    updateDocumentStatus(doc.id, "error", { error: String(err) });
  });

  return c.json({ ...doc, compiling: true }, 202);
});

async function triggerCompilation(docId: string, kbId: string, filename: string, filePath: string): Promise<void> {
  // Clean up any existing wiki pages for this doc before recompiling (prevents duplicates on retry)
  const existingPages = listWikiPagesByDoc(docId);
  for (const page of existingPages) {
    deleteWikiPage(page.id);
  }

  updateDocumentStatus(docId, "parsing");

  let parsedContent: string;
  const ext = filename.split(".").pop()?.toLowerCase() || "";

  if (["md", "txt"].includes(ext)) {
    // Plain text — use as-is
    const { readFileSync } = await import("fs");
    parsedContent = readFileSync(filePath, "utf-8");
  } else {
    // Try Docling (if available)
    try {
      const { parseWithDocling } = await import("../../subprocess/docling-client.js");
      const result = await parseWithDocling(filePath);
      parsedContent = result.content;
    } catch {
      // Fallback: treat as unreadable binary
      parsedContent = `# ${filename}\n\n*文档无法自动解析，请手动提供内容。*\n`;
    }
  }

  updateDocumentStatus(docId, "compiling");

  const result = await compileDocument({
    kbId,
    docId,
    filename,
    parsedContent,
    onProgress: (stage) => console.log(`[Compile:${docId}] ${stage}`),
  });

  // Index pages into FTS
  const pages = listWikiPagesByDoc(docId);
  for (const page of pages) {
    const content = getWikiPageContent(page);
    const level = page.pageType === "abstract" ? "abstract" : page.pageType === "overview" ? "overview" : "fulltext";
    indexPageInFts(page.id, kbId, level, content);
  }

  updateDocumentStatus(docId, "ready", {
    l0PageId: result.l0PageId,
    l1PageId: result.l1PageId,
    l2PageId: result.l2PageId,
  });

  console.log(`[Compile] Document ${docId} (${filename}) compiled successfully.`);
}

// ── Reports (Wiki pages of type "report") ─────────────────────────────────

kbRoutes.get("/:kbId/reports", (c) => {
  const reports = listWikiPagesByKb(c.req.param("kbId"), "report");
  return c.json(reports.map((p) => ({
    id: p.id,
    title: p.title,
    tokenCount: p.tokenCount,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  })));
});

kbRoutes.get("/:kbId/reports/:reportId/content", (c) => {
  const page = getWikiPage(c.req.param("reportId"));
  if (!page || page.kbId !== c.req.param("kbId") || page.pageType !== "report") {
    return c.json({ error: "Report not found" }, 404);
  }
  return c.text(getWikiPageContent(page));
});

kbRoutes.put("/:kbId/reports/:reportId", async (c) => {
  const page = getWikiPage(c.req.param("reportId"));
  if (!page || page.kbId !== c.req.param("kbId") || page.pageType !== "report") {
    return c.json({ error: "Report not found" }, 404);
  }
  const body = await c.req.json<{ content?: string; title?: string }>();
  const newContent = body.content ?? getWikiPageContent(page);
  const tokens = estimateTokensCJK(newContent);
  updateWikiPage(page.id, newContent, tokens);
  return c.json({ ok: true });
});

kbRoutes.delete("/:kbId/reports/:reportId", (c) => {
  const page = getWikiPage(c.req.param("reportId"));
  if (!page || page.kbId !== c.req.param("kbId") || page.pageType !== "report") {
    return c.json({ error: "Report not found" }, 404);
  }
  deleteWikiPage(page.id);
  return c.json({ ok: true });
});
