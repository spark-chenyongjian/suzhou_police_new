import { spawn, type Subprocess } from "bun";

interface PendingRequest {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class SubprocessManager {
  private processes: Map<string, Subprocess> = new Map();
  private pending: Map<string, Map<string, PendingRequest>> = new Map();

  async start(name: string, command: string[], cwd?: string): Promise<void> {
    const proc = spawn({
      cmd: command,
      cwd: cwd || process.cwd(),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    this.processes.set(name, proc);
    this.pending.set(name, new Map());

    // Read stderr for debugging
    (async () => {
      const reader = proc.stderr.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        console.error(`[${name}:stderr]`, decoder.decode(value));
      }
    })();

    // Read stdout line by line, dispatch to pending requests
    (async () => {
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line) as { id?: string; status: string };
            const id = data.id;
            if (!id) continue;
            const requests = this.pending.get(name);
            const req = requests?.get(id);
            if (req) {
              clearTimeout(req.timer);
              requests!.delete(id);
              if (data.status === "error") {
                req.reject(new Error((data as { error?: string }).error || "Subprocess error"));
              } else {
                req.resolve(data);
              }
            }
          } catch {
            /* skip malformed lines */
          }
        }
      }
    })();
  }

  async send(name: string, payload: Record<string, unknown>, timeoutMs = 120_000): Promise<unknown> {
    const proc = this.processes.get(name);
    if (!proc) throw new Error(`Subprocess "${name}" not started`);

    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.get(name)?.delete(id);
        reject(new Error(`Subprocess "${name}" request timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.get(name)!.set(id, { resolve, reject, timer });
      proc.stdin.write(JSON.stringify({ ...payload, id }) + "\n");
    });
  }

  async stop(name: string): Promise<void> {
    const proc = this.processes.get(name);
    if (proc) {
      proc.kill();
      this.processes.delete(name);
      // Reject all pending requests
      const requests = this.pending.get(name);
      if (requests) {
        for (const req of requests.values()) {
          clearTimeout(req.timer);
          req.reject(new Error(`Subprocess "${name}" stopped`));
        }
        this.pending.delete(name);
      }
    }
  }

  async stopAll(): Promise<void> {
    for (const name of [...this.processes.keys()]) {
      await this.stop(name);
    }
  }

  isRunning(name: string): boolean {
    return this.processes.has(name);
  }
}
