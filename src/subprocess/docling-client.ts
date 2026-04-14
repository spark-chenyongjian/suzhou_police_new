import { SubprocessManager } from "./manager.js";
import { join } from "path";

export interface DoclingResult {
  content: string;
  tables: Array<{ data: string; page: number | null }>;
  images: Array<{ caption: string | null; page: number | null }>;
  metadata: Record<string, unknown>;
}

export interface DoclingOptions {
  ocr?: boolean;
  vlm?: boolean;
}

const PROCESS_NAME = "docling";

let _mgr: SubprocessManager | null = null;

export async function startDocling(baseDir?: string): Promise<SubprocessManager> {
  const dir = baseDir || process.cwd();
  const svcDir = join(dir, "docling-service");

  // Prefer venv Python if available
  const venvPython = join(svcDir, ".venv", "bin", "python3");
  const { existsSync } = await import("fs");
  const pythonBin = existsSync(venvPython) ? venvPython : "python3";

  _mgr = new SubprocessManager();
  await _mgr.start(PROCESS_NAME, [pythonBin, "main.py"], svcDir);
  console.log(`[Docling] Subprocess started (python: ${pythonBin}).`);
  return _mgr;
}

export async function parseWithDocling(
  filePath: string,
  options?: DoclingOptions,
): Promise<DoclingResult> {
  if (!_mgr || !_mgr.isRunning(PROCESS_NAME)) {
    throw new Error("Docling subprocess not running. Call startDocling() first.");
  }
  const result = await _mgr.send(PROCESS_NAME, { file_path: filePath, options: options || {} }) as { data: DoclingResult };
  return result.data;
}

export function getDoclingManager(): SubprocessManager | null {
  return _mgr;
}
