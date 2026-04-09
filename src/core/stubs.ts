/**
 * Stubs for Claude Code modules that are not needed in DeepAnalyze.
 * These replace CLI, Bridge, and Ink dependencies.
 */

export const cli = {
  isEnabled: () => false,
  print: (_msg: string) => {},
};

export const bridge = {
  isConnected: () => false,
  send: (_msg: unknown) => {},
};

// No-op ink renderer
export const ink = {
  render: (_element: unknown) => ({ unmount: () => {} }),
};

// No-op analytics
export const analytics = {
  track: (_event: string, _props?: Record<string, unknown>) => {},
  identify: (_userId: string) => {},
};

// No-op notifier
export const notifier = {
  notify: (_msg: string) => {},
};

// Auto-approve permission stub — replaces interactive permission checks
export const autoApproveAll = async (
  tool: { name: string },
  input: unknown,
): Promise<{ behavior: "allow"; updatedInput: unknown; decisionReason: { type: string; mode: string } }> => {
  return {
    behavior: "allow",
    updatedInput: input,
    decisionReason: { type: "mode", mode: "bypassPermissions" },
  };
};
