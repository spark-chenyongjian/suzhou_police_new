import { Hono } from "hono";
import { kbSearch } from "../../wiki/search.js";
import { getWikiPage, getWikiPageContent, listWikiPagesByDoc } from "../../wiki/page-manager.js";

export const searchRoutes = new Hono();

// ── Knowledge Base search ─────────────────────────────────────────────────

searchRoutes.post("/:kbId", async (c) => {
  const kbId = c.req.param("kbId");
  const body = await c.req.json<{
    query: string;
    topK?: number;
    levels?: Array<"abstract" | "overview" | "fulltext">;
    expandLinks?: boolean;
  }>();

  if (!body.query) return c.json({ error: "query is required" }, 400);

  const hits = await kbSearch({
    query: body.query,
    kbId,
    topK: body.topK || 10,
    levels: body.levels || ["abstract", "overview"],
    expandLinks: body.expandLinks !== false,
  });

  return c.json({ hits, total: hits.length });
});

// ── Expand page content ───────────────────────────────────────────────────
// Allows Agent to drill down: L0 -> L1 -> L2

searchRoutes.get("/expand/:pageId", (c) => {
  const page = getWikiPage(c.req.param("pageId"));
  if (!page) return c.json({ error: "Page not found" }, 404);
  const content = getWikiPageContent(page);
  return c.json({ page, content });
});

// Expand from docId to a specific level
searchRoutes.get("/expand/doc/:docId/:level", (c) => {
  const { docId, level } = c.req.param();
  const pages = listWikiPagesByDoc(docId);
  const levelMap: Record<string, string> = {
    l0: "abstract", abstract: "abstract",
    l1: "overview", overview: "overview",
    l2: "fulltext", fulltext: "fulltext",
  };
  const targetType = levelMap[level.toLowerCase()];
  if (!targetType) return c.json({ error: `Unknown level: ${level}` }, 400);

  const page = pages.find((p) => p.pageType === targetType);
  if (!page) return c.json({ error: `No ${level} page found for document ${docId}` }, 404);

  const content = getWikiPageContent(page);
  return c.json({ page, content });
});
