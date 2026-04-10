/**
 * Tool Registry — 统一工具注册中心
 *
 * 所有可供 Agent 调用的工具在此注册。
 * 权限系统统一由 autoApproveAll 处理，不阻断执行。
 */

import { KbSearchTool } from "./KbSearchTool/index.js";
import { ExpandTool } from "./ExpandTool/index.js";
import { WikiBrowseTool } from "./WikiBrowseTool/index.js";
import { DoclingParseTool } from "./DoclingParseTool/index.js";
import { ReportGenerateTool } from "./ReportGenerateTool/index.js";
import { XlsxQueryTool } from "./XlsxQueryTool/index.js";
import { WikiEditTool } from "./WikiEditTool/index.js";
import { WikiLintTool } from "./WikiLintTool/index.js";
import { TimelineBuildTool } from "./TimelineBuildTool/index.js";
import { GraphBuildTool } from "./GraphBuildTool/index.js";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  isConcurrencySafe: boolean;
  call(input: unknown): Promise<string>;
}

const _registry = new Map<string, ToolDefinition>();

function register(tool: ToolDefinition) {
  _registry.set(tool.name, tool);
}

// ── Core DeepAnalyze Tools ────────────────────────────────────────────────
register(KbSearchTool as ToolDefinition);
register(ExpandTool as ToolDefinition);
register(WikiBrowseTool as ToolDefinition);
register(DoclingParseTool as ToolDefinition);
register(ReportGenerateTool as ToolDefinition);
register(XlsxQueryTool as ToolDefinition);
register(WikiEditTool as ToolDefinition);
register(WikiLintTool as ToolDefinition);
register(TimelineBuildTool as ToolDefinition);
register(GraphBuildTool as ToolDefinition);

export function getTool(name: string): ToolDefinition | undefined {
  return _registry.get(name);
}

export function listTools(): ToolDefinition[] {
  return [..._registry.values()];
}

export function getToolDefinitions() {
  return listTools().map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

export function registerTool(tool: ToolDefinition): void {
  _registry.set(tool.name, tool);
}
