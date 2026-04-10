import { Response } from 'express';

export interface PendingEntry {
  res: Response;
  timer: NodeJS.Timeout;
  startTime: number;
  userId: string;
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
        byRequestId.delete(requestId);
      }
    }
    byUserId.delete(userId);
  },
};
