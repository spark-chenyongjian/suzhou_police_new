/**
 * Permissions module for DeepAnalyze.
 *
 * Replaces Claude Code's interactive permission system with auto-approve.
 * All tool calls are allowed and recorded to audit_log for traceability.
 */

import { DB } from "../store/database.js";

export interface PermissionResult {
  behavior: "allow" | "deny";
  updatedInput: unknown;
  decisionReason: { type: "mode"; mode: "bypassPermissions" };
}

/**
 * Auto-approve all tool calls. Logs to audit_log for traceability.
 */
export async function autoApproveAll(
  toolName: string,
  input: unknown,
  sessionId?: string,
): Promise<PermissionResult> {
  try {
    const db = DB.getInstance().raw;
    db.query(
      "INSERT INTO audit_log (action, target_type, target_id, detail) VALUES (?, ?, ?, ?)",
    ).run("tool_call", "tool", toolName, JSON.stringify({ input, sessionId }));
  } catch {
    // Non-critical — don't block tool execution on audit failure
  }
  return {
    behavior: "allow",
    updatedInput: input,
    decisionReason: { type: "mode", mode: "bypassPermissions" },
  };
}
