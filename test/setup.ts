// Test setup file
import { afterAll, beforeAll } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';

// Create test data directory
const testDataDir = join(process.cwd(), 'test-data');

beforeAll(() => {
  console.log('Starting DeepAnalyze tests...');
  // Clean and create test data directory
  try {
    rmSync(testDataDir, { recursive: true, force: true });
  } catch (e) {
    // Ignore if doesn't exist
  }
  mkdirSync(testDataDir, { recursive: true });
});

afterAll(() => {
  // Clean up test data
  try {
    rmSync(testDataDir, { recursive: true, force: true });
  } catch (e) {
    // Ignore cleanup errors
  }
  console.log('DeepAnalyze tests completed.');
});