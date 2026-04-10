export interface LogEntry {
  id: string;
  timestamp: number;
  userId: string;
  requestId: string;
  method: string;
  path: string;
  status: number;
  elapsed: number;
  outcome: 'success' | 'timeout' | 'error' | 'agent-disconnect';
  reqHeaders: Record<string, string>;
  reqBody: string | null;
  resHeaders: Record<string, string>;
  resBody: string;
}

const MAX_LOGS = 100;
const logs: LogEntry[] = [];
let emitFn: ((entry: LogEntry) => void) | null = null;

export const logStore = {
  setEmitFn(fn: (entry: LogEntry) => void): void {
    emitFn = fn;
  },

  push(entry: LogEntry): void {
    logs.push(entry);
    if (logs.length > MAX_LOGS) logs.shift();
    emitFn?.(entry);
  },

  getAll(): LogEntry[] {
    return [...logs];
  },
};
