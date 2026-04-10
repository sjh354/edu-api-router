/* =========================================================
   agent.js — 대시보드 UI + WebSocket 에이전트 로직
   ========================================================= */

const MAX_RETRY = 3;

// ── 상태 ──────────────────────────────────────────────────
let socket       = null;
let registeredAs = null; // 현재 등록된 userId
let testerTarget = null; // API 테스터에서 선택된 userId

// ── DOM 참조 ──────────────────────────────────────────────
const userSelect   = document.getElementById('user-select');
const connectBtn   = document.getElementById('connect-btn');
const connectCard  = document.getElementById('connect-card');
const errorMsg     = document.getElementById('error-msg');
const userList     = document.getElementById('user-list');
const rightPanel   = document.getElementById('right-panel');

const testerTargetName  = document.getElementById('tester-target-name');
const testerMethod      = document.getElementById('tester-method');
const testerPath        = document.getElementById('tester-path');
const headerRows        = document.getElementById('header-rows');
const bodySection       = document.getElementById('body-section');
const testerBody        = document.getElementById('tester-body');
const testerSend        = document.getElementById('tester-send');
const testerResponse    = document.getElementById('tester-response');
const testerStatusBadge = document.getElementById('tester-status-badge');
const testerResponseBody = document.getElementById('tester-response-body');

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

function renderUserLi(li, userId, connected) {
  li.className = connected ? 'connected' : 'disconnected';
  if (connected) {
    li.innerHTML = `
      <span class="dot green">●</span>
      <strong>${userId}</strong>
      <a href="${serverBase()}/${encodeURIComponent(userId)}/" target="_blank">${serverBase()}/${userId}/</a>
      <button class="btn-test" data-userid="${userId}">테스트</button>`;
  } else {
    li.innerHTML = `
      <span class="dot gray">○</span>
      ${userId} <em>(미연결)</em>
      <button class="btn-test" data-userid="${userId}">테스트</button>`;
  }
  if (testerTarget === userId) {
    li.querySelector('.btn-test').classList.add('active');
  }
}

function renderUsers(users) {
  // 드롭다운 갱신 (이미 연결된 ID는 비활성화)
  const prev = userSelect.value;
  userSelect.innerHTML = '';
  for (const u of users) {
    const opt = document.createElement('option');
    opt.value       = u.id;
    opt.textContent = u.id;
    opt.disabled    = u.connected && u.id !== registeredAs;
    userSelect.appendChild(opt);
  }
  if (prev) userSelect.value = prev;

  // 상태 목록 렌더
  userList.innerHTML = '';
  for (const u of users) {
    const li = document.createElement('li');
    li.dataset.userid = u.id;
    renderUserLi(li, u.id, u.connected);
    userList.appendChild(li);
  }
}

// ── 상태 업데이트 브로드캐스트 처리 ──────────────────────
function applyStatusUpdate({ userId, connected }) {
  // 드롭다운 option 토글
  for (const opt of userSelect.options) {
    if (opt.value === userId) {
      opt.disabled = connected && userId !== registeredAs;
    }
  }
  // 목록 항목 업데이트
  const li = userList.querySelector(`li[data-userid="${userId}"]`);
  if (li) {
    renderUserLi(li, userId, connected);
  } else {
    loadUsers();
  }
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

    if (!socket?.connected) return;
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
  connectBtn.disabled     = true;
  connectBtn.textContent  = '연결 중...';

  socket = io({ autoConnect: false });

  socket.on('connect', () => {
    socket.emit('register', { userId });
  });

  socket.on('registered', ({ userId: uid }) => {
    registeredAs           = uid;
    connectBtn.disabled    = false;
    connectBtn.textContent = 'Disconnect';
    connectBtn.classList.add('active');
    connectCard.classList.add('connected');
    userSelect.disabled    = true;
    errorMsg.style.display = 'none';
  });

  socket.on('register-error', ({ message }) => {
    showError(message);
    socket.disconnect();
    socket       = null;
    registeredAs = null;
    connectBtn.disabled    = false;
    connectBtn.textContent = 'Connect';
    connectBtn.classList.remove('active');
    connectCard.classList.remove('connected');
    userSelect.disabled    = false;
  });

  socket.on('request', handleRequest);

  socket.on('status-update', applyStatusUpdate);

  socket.on('disconnect', () => {
    if (registeredAs) {
      registeredAs = null;
      connectBtn.textContent = 'Connect';
      connectBtn.classList.remove('active');
      connectCard.classList.remove('connected');
      userSelect.disabled = false;
      loadUsers();
    }
    socket = null;
  });

  socket.connect();
}

function disconnect() {
  if (socket) socket.disconnect();
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

// ── API 테스터 ────────────────────────────────────────────
function openTester(userId) {
  // 이전 선택 버튼 해제, 새 버튼 활성화
  userList.querySelectorAll('.btn-test').forEach(b => b.classList.remove('active'));
  const btn = userList.querySelector(`.btn-test[data-userid="${userId}"]`);
  if (btn) btn.classList.add('active');

  testerTarget           = userId;
  testerTargetName.textContent = userId;
  rightPanel.style.display     = '';

  // 폼 초기화
  testerMethod.value        = 'GET';
  testerPath.value          = '';
  headerRows.innerHTML      = '';
  testerBody.value          = '';
  testerResponse.style.display = 'none';
  updateBodyVisibility();
}

function closeTester() {
  userList.querySelectorAll('.btn-test').forEach(b => b.classList.remove('active'));
  testerTarget             = null;
  rightPanel.style.display = 'none';
}

function addHeaderRow() {
  const row = document.createElement('div');
  row.className = 'header-row';

  const keyInput = document.createElement('input');
  keyInput.type        = 'text';
  keyInput.placeholder = 'Header name';

  const valInput = document.createElement('input');
  valInput.type        = 'text';
  valInput.placeholder = 'Value';

  const removeBtn = document.createElement('button');
  removeBtn.className   = 'btn-remove-header';
  removeBtn.textContent = '✕';
  removeBtn.onclick     = () => row.remove();

  row.append(keyInput, valInput, removeBtn);
  headerRows.appendChild(row);
}

function updateBodyVisibility() {
  const hasBody = ['POST', 'PUT', 'PATCH'].includes(testerMethod.value);
  bodySection.style.display = hasBody ? '' : 'none';
}

async function sendTesterRequest() {
  if (!testerTarget) return;

  const method  = testerMethod.value;
  const path    = testerPath.value || '/';

  const headers = {};
  for (const row of headerRows.children) {
    const inputs = row.querySelectorAll('input');
    const key    = inputs[0].value.trim();
    const val    = inputs[1].value.trim();
    if (key) headers[key] = val;
  }

  const body = ['POST', 'PUT', 'PATCH'].includes(method) && testerBody.value
    ? testerBody.value
    : undefined;

  testerSend.disabled      = true;
  testerSend.textContent   = '전송 중...';
  testerResponse.style.display = 'none';

  try {
    const url = `${serverBase()}/${encodeURIComponent(testerTarget)}${path}`;
    const res = await fetch(url, { method, headers, body });
    const text = await res.text();

    const cls = res.status < 300 ? 'ok' : res.status < 500 ? 'warn' : 'err';
    testerStatusBadge.textContent = `${res.status} ${res.statusText}`;
    testerStatusBadge.className   = `badge ${cls}`;

    try {
      testerResponseBody.textContent = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      testerResponseBody.textContent = text || '(응답 없음)';
    }
  } catch (e) {
    testerStatusBadge.textContent = 'Error';
    testerStatusBadge.className   = 'badge err';
    testerResponseBody.textContent = e.message;
  } finally {
    testerSend.disabled    = false;
    testerSend.textContent = '보내기';
    testerResponse.style.display = '';
  }
}

// 테스트 버튼 이벤트 (이벤트 위임)
userList.addEventListener('click', (e) => {
  if (e.target.classList.contains('btn-test')) {
    openTester(e.target.dataset.userid);
  }
});

document.getElementById('tester-close-btn').addEventListener('click', closeTester);
document.getElementById('add-header-btn').addEventListener('click', addHeaderRow);
testerMethod.addEventListener('change', updateBodyVisibility);
testerSend.addEventListener('click', sendTesterRequest);

// ── 초기 로드 ─────────────────────────────────────────────
updateBodyVisibility();
loadUsers();
