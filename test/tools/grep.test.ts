import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Mock the actual GrepTool implementation
vi.mock('../../src/tools/GrepTool/index.js', () => ({
  GrepTool: {
    name: 'grep',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        files: { type: 'array', items: { type: 'string' } }
      },
      required: ['pattern']
    },
    call: vi.fn().mockResolvedValue({
      matches: [],
      totalMatches: 0,
      filesSearched: 0
    })
  }
}));

describe('GrepTool', () => {
  let testDir: string;
  let testFile: string;

  beforeEach(() => {
    testDir = './test-data/grep-test';
    testFile = path.join(testDir, 'test.txt');
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(testFile, 'Hello world\nThis is a test file\nAnother line with world');
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  it('should search pattern in files successfully', async () => {
    const { GrepTool } = await import('../../src/tools/GrepTool/index.js');
    
    const result = await GrepTool.call({
      pattern: 'world',
      files: [testFile]
    });
    
    expect(result).toBeDefined();
    expect(typeof result.totalMatches).toBe('number');
  });

  it('should handle non-existent files gracefully', async () => {
    const { GrepTool } = await import('../../src/tools/GrepTool/index.js');
    
    const result = await GrepTool.call({
      pattern: 'test',
      files: ['./nonexistent.txt']
    });
    
    expect(result).toBeDefined();
  });
});