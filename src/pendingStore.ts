import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { logStore } from './logStore';

export interface PendingEntry {
  res: Response;
  timer: NodeJS.Timeout;
  startTime: number;
  userId: string;
  method: string;
  path: string;
  reqHeaders: Record<string, string>;
  reqBody: string | null;
}

const byRequestId = new Map<string, PendingEntry>();
const byUserId = new Map<string, Set<string>>();

export const pendingStore = {
  set(requestId: string, entry: PendingEntry): void {
    byRequestId.set(requestId, entry);
    let ids = byUserId.get(entry.userId);
    if (!ids) {
      ids = new Set();
      byUserId.set(entry.userId, ids);
    }
    ids.add(requestId);
  },

  get(requestId: string): PendingEntry | undefined {
    return byRequestId.get(requestId);
  },

  delete(requestId: string): void {
    const entry = byRequestId.get(requestId);
    if (!entry) return;
    byRequestId.delete(requestId);
    byUserId.get(entry.userId)?.delete(requestId);
  },

  // 에이전트 연결 해제 시 해당 userId의 보류 중인 모든 요청을 502로 처리
  rejectAll(userId: string): void {
    const ids = byUserId.get(userId);
    if (!ids) return;
    for (const requestId of [...ids]) {
      const entry = byRequestId.get(requestId);
      if (entry) {
        clearTimeout(entry.timer);
        entry.res.status(502).send('Agent disconnected');
        logStore.push({
          id: uuidv4(),
          timestamp: entry.startTime,
          userId,
          requestId: requestId.slice(0, 6),
          method: entry.method,
          path: entry.path,
          status: 502,
          elapsed: Date.now() - entry.startTime,
          outcome: 'agent-disconnect',
          reqHeaders: entry.reqHeaders,
          reqBody: entry.reqBody,
          resHeaders: {},
          resBody: 'Agent disconnected',
        });
        byRequestId.delete(requestId);
      }
    }
    byUserId.delete(userId);
  },
};
