# Relay Server — 수업용 역방향 터널링 중계 서버

NAT(공유기) 뒤에 있는 학생의 로컬 서버(`localhost:3000`)를 추가 설치 없이 외부에 노출하는 중계 시스템입니다.  
학생은 브라우저 탭 하나만 열면 연결이 완료되며, 이후 `{서버주소}/{studentId}/...` 형태의 URL로 다른 학생이나 외부에서 해당 로컬 서버에 API 요청을 보낼 수 있습니다.

## 동작 원리

```
[학생 B의 로컬 서버]           [Relay Server]             [학생 A / 외부]
  localhost:3000
        ▲
        │ fetch()
        │
  [브라우저 탭] ◄──WebSocket──► Express + Socket.io ◄─── GET /B/api/users
  (에이전트 역할)
```

브라우저 탭이 WebSocket을 유지하면서 에이전트 역할을 합니다.  
외부 HTTP 요청이 들어오면 릴레이 서버가 해당 학생의 브라우저 탭으로 요청을 전달하고, 탭이 `localhost:3000`에 fetch한 뒤 응답을 다시 릴레이 서버로 돌려보냅니다.

## 기술 스택

- **Runtime:** Node.js + TypeScript (`strict: true`)
- **HTTP:** Express.js
- **WebSocket:** Socket.io
- **Frontend:** 순수 HTML + Vanilla JS (빌드 도구 없음)

## 프로젝트 구조

```
relay-server/
├── src/
│   ├── index.ts          # 서버 진입점 (포트 2999)
│   ├── httpRouter.ts     # HTTP 라우팅 및 요청 중계 로직
│   ├── wsHandler.ts      # Socket.io 이벤트 핸들러
│   ├── pendingStore.ts   # 대기 중인 요청 관리 (Map)
│   ├── logStore.ts       # 요청 로그 저장 (최근 100건)
│   └── userIds.ts        # 허용된 학생 ID 목록
└── public/
    ├── index.html        # 학생 대시보드 UI
    ├── agent.js          # 브라우저 에이전트 로직
    └── admin.html        # 관리자 모니터링 페이지
```

## 시작하기

### 의존성 설치

```bash
npm install
```

### 개발 서버 실행

```bash
npm run dev
# http://localhost:2999 에서 실행됩니다
```

### 프로덕션 빌드 및 실행

```bash
npm run build
npm start
```

## 학생 ID 등록

`src/userIds.ts`에서 허용할 학생 ID 목록을 관리합니다:

```typescript
export const ALLOWED_IDS: string[] = [
  "홍길동",
  "김철수",
  "이영희",
  // ...
];
```

목록에 없는 ID는 연결 시 자동으로 거부됩니다.

## 사용법

### 학생 (에이전트 연결)

1. 자신의 Express 서버에 CORS 미들웨어 추가:
   ```javascript
   import cors from "cors";
   app.use(cors());
   ```
2. 로컬 서버를 `localhost:3000`에서 실행
3. 브라우저에서 `http://{서버주소}` 접속
4. 드롭다운에서 자신의 이름 선택 → **Connect** 클릭
5. 연결되면 초록 테두리로 상태가 표시됩니다

### 다른 학생 API 호출

연결된 학생의 API를 다음 형태로 호출합니다:

```
GET http://{서버주소}/{studentId}/api/users
POST http://{서버주소}/{studentId}/api/items
```

`/{studentId}` 프리픽스는 자동으로 제거되어 학생의 로컬 서버로 전달됩니다.

### API 테스터 (대시보드)

대시보드(`/`)의 연결 현황에서 다른 학생 이름 옆 **테스트** 버튼을 클릭하면 오른쪽에 API 테스터 패널이 열립니다.  
Method, Path, Header, Body를 입력하고 **보내기**를 누르면 릴레이 서버를 통해 요청이 전송되고 응답이 바로 표시됩니다.

### 관리자 페이지

`/admin`에서 다음을 모니터링할 수 있습니다:

- 학생별 실시간 연결 현황
- 요청 로그 (최근 100건): 시간, 학생, Method, Path, 상태 코드, 결과, 응답 시간
- 각 요청의 헤더·바디 상세 조회

## HTTP API

| 메서드 | 경로         | 설명                       |
| ------ | ------------ | -------------------------- |
| `GET`  | `/`          | 학생 대시보드              |
| `GET`  | `/admin`     | 관리자 모니터링 페이지     |
| `GET`  | `/api/users` | 전체 학생 목록 + 연결 상태 |
| `ALL`  | `/:userId/*` | 학생 로컬 서버로 요청 중계 |

## 에러 응답

| 상황                             | 응답                  |
| -------------------------------- | --------------------- |
| 등록되지 않은 `userId`           | `404 Not Found`       |
| 학생이 미연결 상태               | `502 Bad Gateway`     |
| 30초 내 응답 없음                | `504 Gateway Timeout` |
| 로컬 서버 연결 실패 (3회 재시도) | `502 Bad Gateway`     |

## WebSocket 이벤트

| 방향            | 이벤트           | 페이로드                                     |
| --------------- | ---------------- | -------------------------------------------- |
| Client → Server | `register`       | `{ userId }`                                 |
| Server → Client | `registered`     | `{ userId }`                                 |
| Server → Client | `register-error` | `{ message }`                                |
| Server → Client | `request`        | `{ requestId, method, path, headers, body }` |
| Client → Server | `response`       | `{ requestId, status, headers, body }`       |
| Server → All    | `status-update`  | `{ userId, connected }`                      |

## 향후 확장 고려사항

| 항목        | 방법                                       |
| ----------- | ------------------------------------------ |
| HTTPS 지원  | Nginx 리버스 프록시 + Let's Encrypt        |
| 인증 추가   | 관리자 패널에서 학생별 토큰 발급           |
| 대용량 파일 | WebSocket 대신 HTTP 청크 스트리밍으로 전환 |
| Redis 연동  | 서버 재시작 시에도 연결 상태 유지          |

## 업데이트 로그

### v0.1.1
- **관리자 페이지 보안 강화**
  - `/admin` 경로 접속 시 Basic Auth 인증 추가
  - 관리자용 WebSocket 연결 시 비밀번호 확인 로직 추가
  - `PASSWORD` 환경변수를 통한 비밀번호 관리 지원 (기본값: `password`)
