import { describe, it, expect, vi } from 'vitest';
import { compileDocument } from '../../src/wiki/compiler.js';

// Mock dependencies
vi.mock('../../src/models/router.js', () => ({
  getModelRouter: () => ({
    chat: vi.fn().mockResolvedValue({ content: 'Mock LLM response' })
  })
}));

vi.mock('../../src/wiki/page-manager.js', () => ({
  createWikiPage: vi.fn().mockImplementation((opts) => ({
    id: `page-${Date.now()}`,
    ...opts
  }))
}));

vi.mock('../../src/wiki/entity-extractor.js', () => ({
  extractEntities: vi.fn().mockResolvedValue({ entities: [] }),
  buildEntityLinks: vi.fn()
}));

describe('Wiki Compiler', () => {
  const mockContent = `
# Test Document

This is a test document with some content.

## Section 1
Content for section 1.

## Section 2  
More content here.

Some important entity: John Doe
Another entity: ABC Corporation
`;

  it('should compile document in fast mode', async () => {
    const events: string[] = [];
    const result = await compileDocument({
      kbId: 'test-kb',
      docId: 'test-doc',
      filename: 'test.md',
      parsedContent: mockContent,
      onProgress: (stage) => events.push(stage),
      fastMode: true
    });

    expect(result).toBeDefined();
    expect(result.l0PageId).toBeDefined();
    expect(result.l1PageId).toBeDefined();
    expect(result.l2PageId).toBeDefined();
    expect(events).toContain('L2: 存储原始内容');
    expect(events).toContain('L1: 快速提取文档结构');
    expect(events).toContain('L0: 快速生成摘要');
  });
});