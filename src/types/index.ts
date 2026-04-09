export interface KnowledgeBase {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  visibility: "private" | "team" | "public";
  createdAt: string;
  updatedAt: string;
}

export interface Document {
  id: string;
  kbId: string;
  filename: string;
  filePath: string;
  fileHash: string;
  fileSize: number | null;
  fileType: string | null;
  status: "uploaded" | "parsing" | "compiling" | "ready" | "error";
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface WikiPage {
  id: string;
  kbId: string;
  docId: string | null;
  pageType: "abstract" | "overview" | "fulltext" | "entity" | "concept" | "report";
  title: string;
  filePath: string;
  contentHash: string | null;
  tokenCount: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface WikiLink {
  id: number;
  sourcePageId: string;
  targetPageId: string;
  linkType: "forward" | "backward" | "entity_ref" | "concept_ref";
  entityName: string | null;
  context: string | null;
  createdAt: string;
}

export interface Session {
  id: string;
  title: string | null;
  kbScope: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "tool";
  content: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  role: "admin" | "user";
  createdAt: string;
}

export interface AgentTask {
  id: string;
  parentTaskId: string | null;
  sessionId: string | null;
  agentType: string;
  status: "pending" | "running" | "completed" | "failed";
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}
