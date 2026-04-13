import { Server, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { ALLOWED_IDS } from './userIds';
import { pendingStore } from './pendingStore';
import { logStore } from './logStore';
import { ADMIN_PASSWORD } from './index';

const connectedSockets = new Map<string, Socket>();

export function getConnectedSocket(userId: string): Socket | undefined {
  return connectedSockets.get(userId);
}

function log(level: string, message: string): void {
  const time = new Date().toLocaleString('ko-KR');
  console.log(`[${time}] [${level.padEnd(10)}] ${message}`);
}

export function setupWsHandler(io: Server): void {
  logStore.setEmitFn((entry) => io.to('admin').emit('log-entry', entry));

  io.on('connection', (socket: Socket) => {
    let registeredUserId: string | null = null;

    socket.on('join-admin', (password: string) => {
      if (password !== ADMIN_PASSWORD) {
        log('AUTH', '관리자 권한 시도 실패');
        socket.emit('auth-error', { message: '비밀번호가 틀렸습니다.' });
        return;
      }
      void socket.join('admin');
      socket.emit('log-history', logStore.getAll());
    });

    socket.on('register', ({ userId }: { userId: string }) => {
      if (!ALLOWED_IDS.includes(userId)) {
        socket.emit('register-error', { message: `등록되지 않은 ID입니다: ${userId}` });
        return;
      }

      const existing = connectedSockets.get(userId);
      if (existing) {
        if (existing.id === socket.id) {
          socket.emit('register-error', { message: `이미 연결된 ID입니다: ${userId}` });
          return;
        }
        // 좀비 소켓 강제 해제 후 새 소켓으로 교체
        existing.disconnect(true);
        connectedSockets.delete(userId); // 즉시 제거 (disconnect 이벤트보다 먼저)
        log('CONNECT', `${userId} 구 소켓 교체`);
      }

      registeredUserId = userId;
      connectedSockets.set(userId, socket);
      socket.emit('registered', { userId });
      io.emit('status-update', { userId, connected: true });
      log('CONNECT', `${userId} 연결됨`);
    });

    socket.on('response', ({
      requestId,
      status,
      headers,
      body,
    }: {
      requestId: string;
      status: number;
      headers: Record<string, string>;
      body: string;
    }) => {
      const pending = pendingStore.get(requestId);
      if (!pending) return; // 이미 타임아웃 처리됨

      const elapsed = Date.now() - pending.startTime;
      clearTimeout(pending.timer);
      pendingStore.delete(requestId);

      log('RESPONSE', `req-${requestId.slice(0, 6)} → ${status} (${elapsed}ms)`);

      const skipHeaders = new Set(['transfer-encoding', 'content-encoding', 'connection', 'keep-alive']);
      const filteredHeaders: Record<string, string> = {};
      for (const [key, val] of Object.entries(headers)) {
        if (!skipHeaders.has(key.toLowerCase())) {
          filteredHeaders[key] = val;
        }
      }

      logStore.push({
        id: uuidv4(),
        timestamp: pending.startTime,
        userId: pending.userId,
        requestId: requestId.slice(0, 6),
        method: pending.method,
        path: pending.path,
        status,
        elapsed,
        outcome: 'success',
        reqHeaders: pending.reqHeaders,
        reqBody: pending.reqBody,
        resHeaders: filteredHeaders,
        resBody: body,
      });

      pending.res.set(filteredHeaders);
      pending.res.status(status).send(body);
    });

    socket.on('disconnect', () => {
      if (!registeredUserId) return;
      const userId = registeredUserId;
      registeredUserId = null;

      // 좀비 소켓 교체로 이미 제거된 경우 정리 생략
      if (connectedSockets.get(userId) !== socket) return;

      connectedSockets.delete(userId);
      pendingStore.rejectAll(userId);
      io.emit('status-update', { userId, connected: false });
      log('DISCONNECT', `${userId} 연결 해제`);
    });
  });
}
