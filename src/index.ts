import http from 'http';
import path from 'path';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import { setupRouter } from './httpRouter';
import { setupWsHandler } from './wsHandler';

const PORT = 2999;

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  pingInterval: 10_000,
  pingTimeout: 5_000,
  cors: { origin: '*' },
});

app.use(cors());
app.use(express.text({ type: '*/*', limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

setupRouter(app);
setupWsHandler(io);

server.listen(PORT, () => {
  console.log(`[${new Date().toLocaleString('ko-KR')}] Relay server started on http://localhost:${PORT}`);
});
