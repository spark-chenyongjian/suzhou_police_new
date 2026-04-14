import { describe, it, expect, vi } from 'vitest';
import { KbSearchTool } from '../../src/tools/KbSearchTool/index.js';

// Mock the kbSearch function
vi.mock('../../src/wiki/search.js', () => ({
  kbSearch: vi.fn().mockResolvedValue([])
}));

describe('KBSearchTool', () => {
  it('should have correct tool definition', () => {
    expect(KbSearchTool.name).toBe('kb_search');
    expect(KbSearchTool.isConcurrencySafe).toBe(true);
    expect(typeof KbSearchTool.call).toBe('function');
  });

  it('should return no results message when no hits found', async () => {
    const result = await KbSearchTool.call({
      query: 'test query',
      kbId: 'test-kb'
    });

    expect(result).toContain('未找到结果');
    expect(result).toContain('test query');
    expect(result).toContain('test-kb');
  });

  it('should format search results correctly', async () => {
    // Mock kbSearch to return results
    (vi.mocked(await import('../../src/wiki/search.js')).kbSearch as any).mockResolvedValue([
      {
        pageId: 'page-1',
        title: 'Test Document',
        pageType: 'abstract',
        score: 0.85,
        sources: ['doc-1'],
        snippet: 'This is a test snippet'
      }
    ]);

    const result = await KbSearchTool.call({
      query: 'test query',
      kbId: 'test-kb'
    });

    expect(result).toContain('kb_search 结果');
    expect(result).toContain('Test Document');
    expect(result).toContain('page-1');
    expect(result).toContain('This is a test snippet');
  });
});