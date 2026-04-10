import { Express, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { ALLOWED_IDS } from './userIds';
import { pendingStore } from './pendingStore';
import { getConnectedSocket } from './wsHandler';

const TIMEOUT_MS = 30_000;
const SKIP_REQUEST_HEADERS = new Set(['host', 'connection', 'upgrade']);

function log(level: string, message: string): void {
  const time = new Date().toLocaleString('ko-KR');
  console.log(`[${time}] [${level.padEnd(10)}] ${message}`);
}

function relayHandler(req: Request, res: Response): void {
    const userId = req.params['userId'] as string;

    if (!ALLOWED_IDS.includes(userId)) {
      res.status(404).send('Not Found');
      return;
    }

    const socket = getConnectedSocket(userId);
    if (!socket) {
      log('502', `${userId} - 에이전트 미연결`);
      res.status(502).send('Bad Gateway: agent not connected');
      return;
    }

    const requestId = uuidv4();

    // userId 프리픽스 제거 후 path 추출 (쿼리스트링 포함)
    const [rawPath, rawQuery] = req.url.split('?');
    const segments = rawPath.split('/').slice(2);
    const forwardPath = '/' + segments.join('/') + (rawQuery ? '?' + rawQuery : '');

    // 전달 제외 헤더 필터링
    const headers: Record<string, string> = {};
    for (const [key, val] of Object.entries(req.headers)) {
      if (!SKIP_REQUEST_HEADERS.has(key.toLowerCase()) && typeof val === 'string') {
        headers[key] = val;
      }
    }

    const body =
      typeof req.body === 'string' && req.body.length > 0 ? req.body : null;

    const startTime = Date.now();
    log('REQUEST', `${req.method} /${userId}${forwardPath} → req-${requestId.slice(0, 6)}`);

    const timer = setTimeout(() => {
      if (!pendingStore.get(requestId)) return; // 이미 처리됨
      pendingStore.delete(requestId);
      const elapsed = Date.now() - startTime;
      log('TIMEOUT', `req-${requestId.slice(0, 6)} → 504 (${elapsed}ms)`);
      res.status(504).send('Gateway Timeout');
    }, TIMEOUT_MS);

    pendingStore.set(requestId, { res, timer, startTime, userId });

    socket.emit('request', {
      requestId,
      method: req.method,
      path: forwardPath,
      headers,
      body,
    });
}

export function setupRouter(app: Express): void {
  app.get('/api/users', (_req: Request, res: Response) => {
    const users = ALLOWED_IDS.map((id) => ({
      id,
      connected: getConnectedSocket(id) !== undefined,
    }));
    res.json({ users });
  });

  // trailing slash 없는 루트 경로도 처리 (예: /홍길동)
  app.all('/:userId', relayHandler);
  app.all('/:userId/*splat', relayHandler);
}
