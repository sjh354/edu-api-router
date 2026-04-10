/* =========================================================
   agent.js — 대시보드 UI + WebSocket 에이전트 로직
   ========================================================= */

const MAX_RETRY = 3;

// ── 상태 ──────────────────────────────────────────────────
let socket = null;
let registeredAs = null; // 현재 등록된 userId

// ── DOM 참조 ──────────────────────────────────────────────
const userSelect  = document.getElementById('user-select');
const connectBtn  = document.getElementById('connect-btn');
const errorMsg    = document.getElementById('error-msg');
const userList    = document.getElementById('user-list');

// ── 유틸 ─────────────────────────────────────────────────
function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.style.display = 'block';
  setTimeout(() => { errorMsg.style.display = 'none'; }, 4000);
}

function serverBase() {
  return window.location.origin;
}

// ── /api/users 로드 및 UI 렌더 ───────────────────────────
async function loadUsers() {
  const res  = await fetch('/api/users');
  const data = await res.json();
  renderUsers(data.users);
}

function renderUsers(users) {
  // 드롭다운 갱신 (이미 연결된 ID는 비활성화)
  const prev = userSelect.value;
  userSelect.innerHTML = '';
  for (const u of users) {
    const opt = document.createElement('option');
    opt.value    = u.id;
    opt.textContent = u.id;
    opt.disabled = u.connected && u.id !== registeredAs;
    userSelect.appendChild(opt);
  }
  if (prev) userSelect.value = prev;

  // 상태 목록 렌더
  userList.innerHTML = '';
  for (const u of users) {
    const li = document.createElement('li');
    li.className = u.connected ? 'connected' : 'disconnected';
    li.innerHTML = u.connected
      ? `<span class="dot green">●</span> <strong>${u.id}</strong> &nbsp;
         <a href="${serverBase()}/${encodeURIComponent(u.id)}/" target="_blank">
           ${serverBase()}/${u.id}/
         </a>`
      : `<span class="dot gray">○</span> ${u.id} <em>(미연결)</em>`;
    userList.appendChild(li);
  }
}

// ── 상태 업데이트 브로드캐스트 처리 ──────────────────────
function applyStatusUpdate({ userId, connected }) {
  // 드롭다운의 해당 option만 토글
  for (const opt of userSelect.options) {
    if (opt.value === userId) {
      opt.disabled = connected && userId !== registeredAs;
    }
  }
  // 목록의 해당 항목 업데이트
  for (const li of userList.children) {
    const name = li.querySelector('strong')?.textContent || li.textContent?.split('(')[0]?.replace(/[●○\s]/g, '').trim();
    if (name === userId) {
      if (connected) {
        li.className = 'connected';
        li.innerHTML = `<span class="dot green">●</span> <strong>${userId}</strong> &nbsp;
          <a href="${serverBase()}/${encodeURIComponent(userId)}/" target="_blank">
            ${serverBase()}/${userId}/
          </a>`;
      } else {
        li.className = 'disconnected';
        li.innerHTML = `<span class="dot gray">○</span> ${userId} <em>(미연결)</em>`;
      }
      return;
    }
  }
  // 목록에 없으면 다시 로드
  loadUsers();
}

// ── 에이전트: localhost:3000 포워딩 (재시도 포함) ─────────
async function fetchWithRetry(url, options) {
  let lastError;
  for (let i = 0; i < MAX_RETRY; i++) {
    try {
      return await fetch(url, options);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

async function handleRequest({ requestId, method, path, headers, body }) {
  try {
    const response = await fetchWithRetry(`http://localhost:3000${path}`, {
      method,
      headers,
      body: body ?? undefined,
    });

    const responseBody = await response.text();

    if (!socket?.connected) return; // fetch 중 소켓 해제됨
    socket.emit('response', {
      requestId,
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: responseBody,
    });
  } catch {
    if (!socket?.connected) return;
    socket.emit('response', {
      requestId,
      status: 502,
      headers: {},
      body: 'Local server unreachable',
    });
  }
}

// ── 소켓 연결 & 등록 ─────────────────────────────────────
function connect(userId) {
  connectBtn.disabled = true;
  connectBtn.textContent = '연결 중...';

  socket = io({ autoConnect: false });

  socket.on('connect', () => {
    socket.emit('register', { userId });
  });

  socket.on('registered', ({ userId: uid }) => {
    registeredAs = uid;
    connectBtn.disabled  = false;
    connectBtn.textContent = 'Disconnect';
    connectBtn.classList.add('active');
    userSelect.disabled  = true;
    showError('');
    errorMsg.style.display = 'none';
  });

  socket.on('register-error', ({ message }) => {
    showError(message);
    socket.disconnect();
    socket = null;
    registeredAs = null;
    connectBtn.disabled  = false;
    connectBtn.textContent = 'Connect';
    connectBtn.classList.remove('active');
    userSelect.disabled  = false;
  });

  socket.on('request', handleRequest);

  socket.on('status-update', applyStatusUpdate);

  socket.on('disconnect', () => {
    if (registeredAs) {
      registeredAs = null;
      connectBtn.textContent = 'Connect';
      connectBtn.classList.remove('active');
      userSelect.disabled = false;
      loadUsers();
    }
    socket = null;
  });

  socket.connect();
}

function disconnect() {
  if (socket) {
    socket.disconnect();
  }
}

// ── 버튼 이벤트 ──────────────────────────────────────────
connectBtn.addEventListener('click', () => {
  if (registeredAs) {
    disconnect();
  } else {
    const userId = userSelect.value;
    if (!userId) { showError('이름을 선택해주세요.'); return; }
    connect(userId);
  }
});

// ── 초기 로드 ─────────────────────────────────────────────
loadUsers();
