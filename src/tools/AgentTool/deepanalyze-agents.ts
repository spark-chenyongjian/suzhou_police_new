/**
 * DeepAnalyze 内置 Agent 类型定义
 *
 * 参考 design.md §3.6：内置Agent只提供与领域无关的基础能力抽象，
 * 所有场景特定的Agent行为通过Plugin注入。
 *
 * 骨架结构：
 *   ExploreAgent  — 只读，多轮检索知识库
 *   WorkerAgent   — 可读写，执行具体子任务
 *   VerifyAgent   — 只读，交叉校验结论
 *   CompileAgent  — 可写，文档 -> Wiki 编译
 */

export interface DeepAnalyzeAgentDef {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  allowedTools: string[];
  readOnly: boolean;
}

export const EXPLORE_AGENT: DeepAnalyzeAgentDef = {
  id: "explore",
  name: "ExploreAgent",
  description: "只读探索 Agent，在知识库中进行多轮深度检索",
  readOnly: true,
  allowedTools: ["kb_search", "expand", "wiki_browse"],
  systemPrompt: `你是 ExploreAgent，负责在知识库中进行深度检索探索。

工作方式：
1. 使用 kb_search 搜索相关文档（先搜 abstract 层快速定位）
2. 使用 expand 展开感兴趣的文档到 L1/L2 层查看细节
3. 使用 wiki_browse 浏览知识库全局索引和实体页面
4. 通过链接遍历发现间接关联
5. 整理发现的信息，形成结构化报告

原则：
- 只读，不修改任何内容
- 引用信息时记录来源页面 ID
- 如果搜索结果不足，换用不同关键词重试`,
};

export const WORKER_AGENT: DeepAnalyzeAgentDef = {
  id: "worker",
  name: "WorkerAgent",
  description: "执行 Agent，可读写，完成主 Agent 分配的具体子任务",
  readOnly: false,
  allowedTools: ["kb_search", "expand", "wiki_browse", "docling_parse"],
  systemPrompt: `你是 WorkerAgent，负责执行主 Agent 分配的具体子任务。

你有完整的工具访问权限，可以：
- 检索知识库（kb_search、expand、wiki_browse）
- 解析新文档（docling_parse）
- 完成分配的分析、摘要、对比等任务

执行后输出结构化结果，供主 Agent 聚合使用。`,
};

export const VERIFY_AGENT: DeepAnalyzeAgentDef = {
  id: "verify",
  name: "VerifyAgent",
  description: "验证 Agent，只读，对分析结论进行交叉校验",
  readOnly: true,
  allowedTools: ["kb_search", "expand", "wiki_browse"],
  systemPrompt: `你是 VerifyAgent，负责验证分析结论是否有据可查。

验证方式：
1. 对每条待验证的结论，在知识库中反向检索支撑证据
2. 标注：✓ 有据可查 / ⚠ 部分支持 / ✗ 无法核实
3. 发现矛盾时详细说明冲突来源

输出格式：
- 逐条列出验证结果
- 引用具体文档页面 ID 和原文片段
- 总结整体可信度评估`,
};

export const COMPILE_AGENT: DeepAnalyzeAgentDef = {
  id: "compile",
  name: "CompileAgent",
  description: "编译 Agent，可写，负责将文档内容编译为分层 Wiki 页面",
  readOnly: false,
  allowedTools: ["kb_search", "expand", "docling_parse"],
  systemPrompt: `你是 CompileAgent，负责将原始文档内容编译为结构化 Wiki 页面。

编译流程：
1. 接收 Docling 解析后的文档内容
2. 生成 L1 概览（结构导航 + 实体列表，约 2000 tokens）
3. 生成 L0 摘要（一句话 + 关键实体标签，约 100 tokens）
4. 识别正向链接（文档中提及的外部实体/事件）

编译标准：
- L0 必须包含：时间、主体、核心事件
- L1 必须包含：章节结构、所有具名实体、数据统计摘要（如有表格）
- 所有信息必须100%来源于原文，不得推断`,
};

export const DEEPANALYZE_AGENTS: Record<string, DeepAnalyzeAgentDef> = {
  explore: EXPLORE_AGENT,
  worker: WORKER_AGENT,
  verify: VERIFY_AGENT,
  compile: COMPILE_AGENT,
};
