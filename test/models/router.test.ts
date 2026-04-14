import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModelRouter } from '../../src/models/router.js';
import * as fs from 'fs';
import * as path from 'path';

// Mock the config file
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    readFileSync: vi.fn(),
    existsSync: vi.fn()
  };
});

describe('ModelRouter', () => {
  let router: ModelRouter;

  beforeEach(() => {
    router = new ModelRouter();
    vi.clearAllMocks();
  });

  it('should initialize with default configuration when config file not found', async () => {
    (fs.existsSync as any).mockReturnValue(false);
    
    await router.initialize();
    
    expect(router.getDefaultModel('main')).toBe('default');
  });

  it('should parse model configuration correctly', async () => {
    const mockConfig = `
models:
  main:
    provider: openai-compatible
    endpoint: http://localhost:11434/v1
    model: deepseek-r1
    maxTokens: 128000
    supportsToolUse: true

defaults:
  main: main
`;
    
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(mockConfig);
    
    await router.initialize();
    
    expect(router.getDefaultModel('main')).toBe('main');
  });

  it('should throw error when provider not found', () => {
    expect(() => router.getProvider('nonexistent')).toThrow('Model provider not found');
  });
});