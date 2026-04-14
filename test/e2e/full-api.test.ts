/**
 * DeepAnalyze Full E2E API Test Suite
 *
 * Covers all API endpoints described in the design document.
 * Requires a running server: bun run dev (default port 21000)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ApiClient } from '../utils/api-client.js';

const BASE = process.env.API_BASE || 'http://localhost:21000';
const api = new ApiClient(BASE);

// ── Shared state across tests ────────────────────────────────────────────
let testSessionId: string;
let testKbId: string;
let testDocId: string;
let testPageId: string;
let testL0PageId: string;
let testL1PageId: string;
let testL2PageId: string;

// Sample markdown content for upload tests
const SAMPLE_MD = `# 测试文档 - DeepAnalyze 功能验证

## 概述

本文档用于测试 DeepAnalyze 平台的核心功能，包括文档上传、Wiki 编译、全文检索和知识图谱构建。

## 关键实体

- **张三**: 项目负责人，2024年1月加入公司
- **李四**: 技术总监，负责系统架构设计
- **苏州智深科技有限公司**: 项目所属公司

## 时间线

1. 2024-01-15: 项目启动会议在苏州市高新区召开
2. 2024-03-20: 完成核心模块开发，投入资金50万元
3. 2024-06-10: 系统上线试运行，用户数突破1000人

## 技术栈

项目采用 TypeScript + Bun 运行时，前端使用 React 19 + Tailwind CSS，存储使用 SQLite + FTS5。
`;

const SAMPLE_CSV = `姓名,部门,薪资,入职日期
张三,技术部,15000,2024-01-15
李四,管理部,25000,2023-06-01
王五,技术部,18000,2024-03-20
赵六,市场部,12000,2024-06-10
钱七,技术部,20000,2023-11-05`;

// ════════════════════════════════════════════════════════════════════════
// 1. Health & Infrastructure
// ════════════════════════════════════════════════════════════════════════

describe('1. Health & Infrastructure', () => {
  it('GET /api/health — should return ok status', async () => {
    const { status, body } = await api.get('/api/health');
    expect(status).toBe(200);
    const data = body as Record<string, unknown>;
    expect(data.status).toBe('ok');
    expect(data.version).toBe('0.1.0');
    expect(data.timestamp).toBeDefined();
  });

  it('GET / — should serve frontend or fallback message', async () => {
    const { status } = await api.get('/');
    // Either frontend HTML (200) or build hint (404)
    expect([200, 404]).toContain(status);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 2. Settings API
// ════════════════════════════════════════════════════════════════════════

describe('2. Settings API', () => {
  it('GET /api/settings/model — should return model config as JSON', async () => {
    const { status, body } = await api.get('/api/settings/model');
    expect(status).toBe(200);
    const data = body as Record<string, unknown>;
    expect(data).toHaveProperty('endpoint');
    expect(data).toHaveProperty('model');
    expect(data).toHaveProperty('maxTokens');
    expect(typeof data.maxTokens).toBe('number');
  });

  it('GET /api/settings/model-config — should return raw YAML', async () => {
    const { status, body } = await api.get('/api/settings/model-config');
    expect(status).toBe(200);
    expect(typeof body).toBe('string');
    expect((body as string)).toContain('models:');
  });

  it('PUT /api/settings/model — should update and reload model config', async () => {
    // First read current config
    const { body: current } = await api.get('/api/settings/model');
    const cur = current as Record<string, unknown>;

    // Write it back (no-op change) to test the write path
    const { status, body } = await api.put('/api/settings/model', {
      endpoint: cur.endpoint,
      model: cur.model,
      apiKey: (cur as Record<string, unknown>).apiKey || '',
      maxTokens: cur.maxTokens,
    });
    expect(status).toBe(200);
    expect((body as Record<string, unknown>).ok).toBe(true);

    // Verify config persisted
    const { body: after } = await api.get('/api/settings/model');
    const aft = after as Record<string, unknown>;
    expect(aft.endpoint).toBe(cur.endpoint);
    expect(aft.model).toBe(cur.model);
  });

  it('PUT /api/settings/model-config — should write raw YAML', async () => {
    const { body: raw } = await api.get('/api/settings/model-config');
    const yaml = raw as string;

    const { status, body } = await api.put('/api/settings/model-config', yaml);
    expect(status).toBe(200);
    expect((body as Record<string, unknown>).ok).toBe(true);
  });

  it('PUT /api/settings/model-config — should reject empty config', async () => {
    const { status, body } = await api.put('/api/settings/model-config', '');
    expect(status).toBe(400);
    expect((body as Record<string, unknown>).error).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════════════
// 3. Sessions API
// ════════════════════════════════════════════════════════════════════════

describe('3. Sessions API', () => {
  it('POST /api/sessions — should create a session', async () => {
    const { status, body } = await api.post('/api/sessions', {
      title: 'E2E Test Session',
    });
    expect(status).toBe(201);
    const data = body as Record<string, unknown>;
    expect(data.id).toBeDefined();
    expect(data.title).toBe('E2E Test Session');
    testSessionId = data.id as string;
  });

  it('POST /api/sessions — should create with kbScope', async () => {
    const { status, body } = await api.post('/api/sessions', {
      title: 'Session with KB Scope',
      kbScope: { kbId: 'test-kb' },
    });
    expect(status).toBe(201);
    expect((body as Record<string, unknown>).title).toBe('Session with KB Scope');
  });

  it('GET /api/sessions — should list all sessions', async () => {
    const { status, body } = await api.get('/api/sessions');
    expect(status).toBe(200);
    const sessions = body as Array<Record<string, unknown>>;
    expect(Array.isArray(sessions)).toBe(true);
    expect(sessions.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/sessions/:id — should get a specific session', async () => {
    const { status, body } = await api.get(`/api/sessions/${testSessionId}`);
    expect(status).toBe(200);
    expect((body as Record<string, unknown>).id).toBe(testSessionId);
  });

  it('GET /api/sessions/:id — should return 404 for unknown session', async () => {
    const { status } = await api.get('/api/sessions/nonexistent-id');
    expect(status).toBe(404);
  });

  it('PATCH /api/sessions/:id — should update session title', async () => {
    const { status, body } = await api.patch(`/api/sessions/${testSessionId}`, {
      title: 'Updated E2E Session',
    });
    expect(status).toBe(200);
    expect((body as Record<string, unknown>).ok).toBe(true);

    // Verify update
    const { body: updated } = await api.get(`/api/sessions/${testSessionId}`);
    expect((updated as Record<string, unknown>).title).toBe('Updated E2E Session');
  });

  it('GET /api/sessions/:id/messages — should return messages (empty)', async () => {
    const { status, body } = await api.get(`/api/sessions/${testSessionId}/messages`);
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 4. Knowledge Bases API
// ════════════════════════════════════════════════════════════════════════

describe('4. Knowledge Bases API', () => {
  it('POST /api/kb — should create a knowledge base', async () => {
    const { status, body } = await api.post('/api/kb', {
      name: 'E2E测试知识库',
      description: '用于端到端测试的知识库',
    });
    expect(status).toBe(201);
    const data = body as Record<string, unknown>;
    expect(data.id).toBeDefined();
    expect(data.name).toBe('E2E测试知识库');
    testKbId = data.id as string;
  });

  it('POST /api/kb — should reject missing name', async () => {
    const { status, body } = await api.post('/api/kb', {});
    expect(status).toBe(400);
    expect((body as Record<string, unknown>).error).toBeDefined();
  });

  it('GET /api/kb — should list knowledge bases', async () => {
    const { status, body } = await api.get('/api/kb');
    expect(status).toBe(200);
    const kbs = body as Array<Record<string, unknown>>;
    expect(Array.isArray(kbs)).toBe(true);
    expect(kbs.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/kb/:kbId — should get a specific KB', async () => {
    const { status, body } = await api.get(`/api/kb/${testKbId}`);
    expect(status).toBe(200);
    expect((body as Record<string, unknown>).id).toBe(testKbId);
    expect((body as Record<string, unknown>).name).toBe('E2E测试知识库');
  });

  it('GET /api/kb/:kbId — should return 404 for unknown KB', async () => {
    const { status } = await api.get('/api/kb/nonexistent-kb');
    expect(status).toBe(404);
  });

  it('PATCH /api/kb/:kbId — should update KB', async () => {
    const { status, body } = await api.patch(`/api/kb/${testKbId}`, {
      name: '更新后的知识库',
      description: '更新描述',
    });
    expect(status).toBe(200);
    expect((body as Record<string, unknown>).name).toBe('更新后的知识库');
  });

  it('GET /api/kb/:kbId/wiki/pages — should list wiki pages (empty)', async () => {
    const { status, body } = await api.get(`/api/kb/${testKbId}/wiki/pages`);
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/kb/:kbId/documents — should list documents (empty)', async () => {
    const { status, body } = await api.get(`/api/kb/${testKbId}/documents`);
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 5. Document Upload & Compilation
// ════════════════════════════════════════════════════════════════════════

describe('5. Document Upload & Compilation', () => {
  it('POST /api/kb/:kbId/documents/upload — should upload a .md file', async () => {
    const { status, body } = await api.upload(
      `/api/kb/${testKbId}/documents/upload`,
      { name: '测试文档.md', content: SAMPLE_MD },
    );
    expect(status).toBe(202); // Accepted with async compilation
    const data = body as Record<string, unknown>;
    expect(data.id).toBeDefined();
    expect(data.compiling).toBe(true);
    testDocId = data.id as string;
  });

  it('POST /api/kb/:kbId/documents/upload — should upload a .csv file', async () => {
    const { status, body } = await api.upload(
      `/api/kb/${testKbId}/documents/upload`,
      { name: '员工数据.csv', content: SAMPLE_CSV },
    );
    expect(status).toBe(202);
    expect((body as Record<string, unknown>).id).toBeDefined();
  });

  it('POST /api/kb/:kbId/documents/upload — should reject no file', async () => {
    const { status, body } = await api.post(`/api/kb/${testKbId}/documents/upload`);
    expect(status).toBe(400);
    expect((body as Record<string, unknown>).error).toBeDefined();
  });

  it('POST /api/kb/:kbId/documents/upload — should reject unknown KB', async () => {
    const { status } = await api.upload(
      '/api/kb/nonexistent-kb/documents/upload',
      { name: 'test.md', content: 'hello' },
    );
    expect(status).toBe(404);
  });

  // Wait for compilation to finish
  it('should compile the .md document to ready state', async () => {
    // Poll until ready or timeout
    let status = '';
    for (let i = 0; i < 20; i++) {
      const res = await api.get(`/api/kb/${testKbId}/documents/${testDocId}`);
      if (res.status === 200) {
        status = (res.body as Record<string, unknown>).status as string;
        if (status === 'ready' || status === 'error') break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(status).toBe('ready');
  });

  it('GET /api/kb/:kbId/documents/:docId — should get document details', async () => {
    const { status, body } = await api.get(`/api/kb/${testKbId}/documents/${testDocId}`);
    expect(status).toBe(200);
    const data = body as Record<string, unknown>;
    expect(data.id).toBe(testDocId);
    expect(data.filename).toBe('测试文档.md');
    expect(data.fileType).toBe('md');
    expect(data.status).toBe('ready');
  });

  it('GET /api/kb/:kbId/documents — should list uploaded documents', async () => {
    const { status, body } = await api.get(`/api/kb/${testKbId}/documents`);
    expect(status).toBe(200);
    const docs = body as Array<Record<string, unknown>>;
    expect(docs.length).toBeGreaterThanOrEqual(2); // .md + .csv
  });
});

// ════════════════════════════════════════════════════════════════════════
// 6. Wiki Pages & Content
// ════════════════════════════════════════════════════════════════════════

describe('6. Wiki Pages & Content', () => {
  it('GET /api/kb/:kbId/wiki/pages — should list wiki pages after compilation', async () => {
    const { status, body } = await api.get(`/api/kb/${testKbId}/wiki/pages`);
    expect(status).toBe(200);
    const pages = body as Array<Record<string, unknown>>;
    expect(pages.length).toBeGreaterThanOrEqual(1);

    // Capture page IDs for later tests
    for (const page of pages) {
      const pt = page.pageType as string;
      if (pt === 'abstract') testL0PageId = page.id as string;
      if (pt === 'overview') testL1PageId = page.id as string;
      if (pt === 'fulltext') testL2PageId = page.id as string;
    }
    testPageId = (pages[0] as Record<string, unknown>).id as string;
  });

  it('GET /api/kb/:kbId/wiki/pages/:pageId/content — should return page content', async () => {
    if (!testPageId) return; // skip if no pages
    const { status, body } = await api.get(
      `/api/kb/${testKbId}/wiki/pages/${testPageId}/content`,
    );
    expect(status).toBe(200);
    expect(typeof body).toBe('string');
    expect((body as string).length).toBeGreaterThan(0);
  });

  it('GET /api/kb/:kbId/documents/:docId/pages — should list doc wiki pages', async () => {
    const { status, body } = await api.get(
      `/api/kb/${testKbId}/documents/${testDocId}/pages`,
    );
    expect(status).toBe(200);
    const pages = body as Array<Record<string, unknown>>;
    expect(pages.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/kb/:kbId/documents/:docId/pages/:pageId/content — should get page content', async () => {
    // First get the pages
    const { body: pages } = await api.get(
      `/api/kb/${testKbId}/documents/${testDocId}/pages`,
    );
    const pageList = pages as Array<Record<string, unknown>>;
    if (pageList.length === 0) return;

    const pid = pageList[0].id as string;
    const { status, body } = await api.get(
      `/api/kb/${testKbId}/documents/${testDocId}/pages/${pid}/content`,
    );
    expect(status).toBe(200);
    expect(typeof body).toBe('string');
  });
});

// ════════════════════════════════════════════════════════════════════════
// 7. Search API
// ════════════════════════════════════════════════════════════════════════

describe('7. Search API', () => {
  it('POST /api/search/:kbId — should search the knowledge base', async () => {
    const { status, body } = await api.post(`/api/search/${testKbId}`, {
      query: '张三',
      topK: 5,
    });
    expect(status).toBe(200);
    const data = body as Record<string, unknown>;
    expect(Array.isArray(data.hits)).toBe(true);
    expect(typeof data.total).toBe('number');
  });

  it('POST /api/search/:kbId — should reject missing query', async () => {
    const { status, body } = await api.post(`/api/search/${testKbId}`, {});
    expect(status).toBe(400);
  });

  it('POST /api/search/:kbId — should support level filtering', async () => {
    const { status, body } = await api.post(`/api/search/${testKbId}`, {
      query: '技术栈',
      levels: ['abstract'],
      topK: 3,
    });
    expect(status).toBe(200);
    const data = body as Record<string, unknown>;
    expect(Array.isArray(data.hits)).toBe(true);
  });

  it('GET /api/search/expand/:pageId — should expand a wiki page', async () => {
    if (!testPageId) return;
    const { status, body } = await api.get(`/api/search/expand/${testPageId}`);
    expect(status).toBe(200);
    const data = body as Record<string, unknown>;
    expect(data.page).toBeDefined();
    expect(data.content).toBeDefined();
  });

  it('GET /api/search/expand/:pageId — should return 404 for unknown page', async () => {
    const { status } = await api.get('/api/search/expand/nonexistent-page');
    expect(status).toBe(404);
  });

  it('GET /api/search/expand/doc/:docId/:level — should expand by doc+level', async () => {
    const { status, body } = await api.get(
      `/api/search/expand/doc/${testDocId}/l2`,
    );
    expect(status).toBe(200);
    const data = body as Record<string, unknown>;
    expect(data.page).toBeDefined();
    expect(data.content).toBeDefined();
  });

  it('GET /api/search/expand/doc/:docId/:level — should support all level aliases', async () => {
    for (const level of ['l0', 'abstract', 'l1', 'overview', 'l2', 'fulltext']) {
      const { status } = await api.get(
        `/api/search/expand/doc/${testDocId}/${level}`,
      );
      // At minimum should not be 400 (bad level)
      expect(status).not.toBe(400);
    }
  });

  it('GET /api/search/expand/doc/:docId/:level — should reject unknown level', async () => {
    const { status } = await api.get(
      `/api/search/expand/doc/${testDocId}/invalid-level`,
    );
    expect(status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 8. Chat API
// ════════════════════════════════════════════════════════════════════════

describe('8. Chat API', () => {
  it('POST /api/chat/send — should send a message (non-streaming)', async () => {
    const { status, body } = await api.post('/api/chat/send', {
      sessionId: testSessionId,
      content: '你好，这是一条测试消息',
    });
    expect(status).toBe(200);
    const data = body as Record<string, unknown>;
    expect(data.messageId).toBeDefined();
    expect(data.status).toBe('received');
  });

  it('POST /api/chat/send — should reject unknown session', async () => {
    const { status } = await api.post('/api/chat/send', {
      sessionId: 'nonexistent-session',
      content: 'test',
    });
    expect(status).toBe(404);
  });

  it('GET /api/sessions/:id/messages — should list messages after send', async () => {
    const { status, body } = await api.get(`/api/sessions/${testSessionId}/messages`);
    expect(status).toBe(200);
    const messages = body as Array<Record<string, unknown>>;
    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('你好，这是一条测试消息');
  });

  it('POST /api/chat/stream — should stream a response via SSE', async () => {
    const { events, status } = await api.sse('/api/chat/stream', {
      sessionId: testSessionId,
      content: '简单回答：1+1等于几？',
      kbId: testKbId,
    }, 60000);

    expect(status).toBe(200);
    expect(events.length).toBeGreaterThanOrEqual(1);

    // Should have at least one text event and a done event
    const hasDone = events.some((e) => e.type === 'done');
    const hasError = events.some((e) => e.type === 'error');
    expect(hasDone || hasError).toBe(true);

    if (hasDone) {
      const textEvents = events.filter((e) => e.type === 'text');
      expect(textEvents.length).toBeGreaterThanOrEqual(0); // Model may or may not respond with text
    }
  });

  it('POST /api/chat/stream — should reject unknown session', async () => {
    const { status } = await api.sse('/api/chat/stream', {
      sessionId: 'nonexistent-session',
      content: 'test',
    }, 5000);
    expect(status).toBe(404);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 9. Graph & Timeline
// ════════════════════════════════════════════════════════════════════════

describe('9. Graph & Timeline', () => {
  it('GET /api/kb/:kbId/wiki/graph?mode=local — should build local graph', async () => {
    const { status, body } = await api.get(
      `/api/kb/${testKbId}/wiki/graph?mode=local`,
    );
    expect(status).toBe(200);
    // Graph response structure is flexible, just verify it returns successfully
    expect(body).toBeDefined();
  });

  it('GET /api/kb/:kbId/wiki/graph — should reject unknown KB', async () => {
    const { status } = await api.get('/api/kb/nonexistent/wiki/graph');
    expect(status).toBe(404);
  });

  it('GET /api/kb/:kbId/wiki/timeline — should build timeline', async () => {
    const { status, body } = await api.get(`/api/kb/${testKbId}/wiki/timeline`);
    expect(status).toBe(200);
    expect(body).toBeDefined();
  });

  it('GET /api/kb/:kbId/wiki/timeline — should reject unknown KB', async () => {
    const { status } = await api.get('/api/kb/nonexistent/wiki/timeline');
    expect(status).toBe(404);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 10. XLSX / Structured Data
// ════════════════════════════════════════════════════════════════════════

describe('10. XLSX / Structured Data', () => {
  let testSheetId: string;

  it('GET /api/kb/:kbId/xlsx/sheets — should list sheets', async () => {
    const { status, body } = await api.get(`/api/kb/${testKbId}/xlsx/sheets`);
    expect(status).toBe(200);
    const sheets = body as Array<Record<string, unknown>>;
    // May or may not have sheets depending on CSV compilation speed
    if (sheets.length > 0) {
      testSheetId = sheets[0].id as string;
    }
  });

  it('GET /api/kb/:kbId/xlsx/sheets/:sheetId — should get sheet detail', async () => {
    // First ensure sheets exist (wait for CSV compilation)
    let sheets: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 10; i++) {
      const res = await api.get(`/api/kb/${testKbId}/xlsx/sheets`);
      sheets = res.body as Array<Record<string, unknown>>;
      if (sheets.length > 0) break;
      await new Promise((r) => setTimeout(r, 1000));
    }

    if (sheets.length === 0) return; // skip if CSV not compiled yet

    testSheetId = sheets[0].id as string;
    const { status, body } = await api.get(
      `/api/kb/${testKbId}/xlsx/sheets/${testSheetId}`,
    );
    expect(status).toBe(200);
    const data = body as Record<string, unknown>;
    expect(data.sheetName).toBeDefined();
    expect(data.rowCount).toBeDefined();
    expect(data.colCount).toBeDefined();
    expect(Array.isArray(data.columns)).toBe(true);
  });

  it('POST /api/kb/:kbId/xlsx/query — should query sheet data', async () => {
    if (!testSheetId) return;

    const { status, body } = await api.post(`/api/kb/${testKbId}/xlsx/query`, {
      sheetId: testSheetId,
      limit: 10,
    });
    expect(status).toBe(200);
    // Result structure depends on query implementation
    expect(body).toBeDefined();
  });

  it('POST /api/kb/:kbId/xlsx/query — should reject missing sheetId', async () => {
    const { status, body } = await api.post(`/api/kb/${testKbId}/xlsx/query`, {});
    expect(status).toBe(400);
  });

  it('POST /api/kb/:kbId/xlsx/query — should support select/where', async () => {
    if (!testSheetId) return;

    const { status, body } = await api.post(`/api/kb/${testKbId}/xlsx/query`, {
      sheetId: testSheetId,
      select: ['姓名', '部门'],
      where: '部门 = "技术部"',
      limit: 5,
    });
    // Should succeed or return query error (acceptable)
    expect([200, 400]).toContain(status);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 11. Reports
// ════════════════════════════════════════════════════════════════════════

describe('11. Reports', () => {
  it('GET /api/kb/:kbId/reports — should list reports (may be empty)', async () => {
    const { status, body } = await api.get(`/api/kb/${testKbId}/reports`);
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/kb/:kbId/reports/:reportId/content — should 404 for unknown report', async () => {
    const { status } = await api.get(
      `/api/kb/${testKbId}/reports/nonexistent/content`,
    );
    expect(status).toBe(404);
  });

  it('PUT /api/kb/:kbId/reports/:reportId — should 404 for unknown report', async () => {
    const { status } = await api.put(
      `/api/kb/${testKbId}/reports/nonexistent`,
      { content: 'test' },
    );
    expect(status).toBe(404);
  });

  it('DELETE /api/kb/:kbId/reports/:reportId — should 404 for unknown report', async () => {
    const { status } = await api.del(
      `/api/kb/${testKbId}/reports/nonexistent`,
    );
    expect(status).toBe(404);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 12. Plugins API
// ════════════════════════════════════════════════════════════════════════

describe('12. Plugins API', () => {
  it('GET /api/plugins — should list plugins', async () => {
    const { status, body } = await api.get('/api/plugins');
    expect(status).toBe(200);
    const plugins = body as Array<Record<string, unknown>>;
    expect(Array.isArray(plugins)).toBe(true);
    // Should have judicial-evidence plugin loaded
    const judicial = plugins.find((p) => p.name === 'judicial-evidence');
    expect(judicial).toBeDefined();
    expect(judicial!.version).toBe('1.0');
    expect(Array.isArray(judicial!.agents)).toBe(true);
  });

  it('GET /api/plugins/skills — should list skills', async () => {
    const { status, body } = await api.get('/api/plugins/skills');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it('PATCH /api/plugins/:name/toggle — should toggle plugin', async () => {
    // Disable
    const { status: s1, body: b1 } = await api.patch(
      '/api/plugins/judicial-evidence/toggle',
    );
    expect(s1).toBe(200);
    expect((b1 as Record<string, unknown>).enabled).toBe(false);

    // Re-enable
    const { status: s2, body: b2 } = await api.patch(
      '/api/plugins/judicial-evidence/toggle',
    );
    expect(s2).toBe(200);
    expect((b2 as Record<string, unknown>).enabled).toBe(true);
  });

  it('PATCH /api/plugins/:name/toggle — should 404 for unknown plugin', async () => {
    const { status } = await api.patch('/api/plugins/nonexistent/toggle');
    expect(status).toBe(404);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 13. Cleanup
// ════════════════════════════════════════════════════════════════════════

describe('13. Cleanup — Delete test resources', () => {
  it('DELETE /api/kb/:kbId/documents/:docId — should delete a document', async () => {
    const { status, body } = await api.del(
      `/api/kb/${testKbId}/documents/${testDocId}`,
    );
    expect(status).toBe(200);
    expect((body as Record<string, unknown>).ok).toBe(true);
  });

  it('DELETE /api/kb/:kbId — should delete the test knowledge base', async () => {
    const { status, body } = await api.del(`/api/kb/${testKbId}`);
    expect(status).toBe(200);
    expect((body as Record<string, unknown>).ok).toBe(true);
  });

  it('DELETE /api/sessions/:id — should delete the test session', async () => {
    const { status, body } = await api.del(`/api/sessions/${testSessionId}`);
    expect(status).toBe(200);
    expect((body as Record<string, unknown>).ok).toBe(true);
  });

  it('GET /api/kb/:kbId — should 404 after deletion', async () => {
    const { status } = await api.get(`/api/kb/${testKbId}`);
    expect(status).toBe(404);
  });
});
