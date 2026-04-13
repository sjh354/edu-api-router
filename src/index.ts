import http from 'http';
import path from 'path';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import { setupRouter } from './httpRouter';
import { setupWsHandler } from './wsHandler';

const PORT = process.env.PORT || 2999;
export const ADMIN_PASSWORD = process.env.PASSWORD || 'password';

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

app.get('/admin', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Area"');
    return res.status(401).send('Authentication required');
  }

  const base64 = auth.split(' ')[1];
  if (!base64) return res.status(401).send('Invalid Auth');
  
  const decoded = Buffer.from(base64, 'base64').toString();
  const [, pass] = decoded.split(':');

  if (pass !== ADMIN_PASSWORD) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Area"');
    return res.status(401).send('Invalid password');
  }

  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

setupRouter(app);
setupWsHandler(io);

server.listen(PORT, () => {
  console.log(`[${new Date().toLocaleString('ko-KR')}] Relay server started on http://localhost:${PORT}`);
});
