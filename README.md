## 개요

`intersection-nextjs`는 Next.js(App Router) 기반의 프런트엔드이며, 실시간 서버는 레포 내 `realtime/`(Socket.IO)로 분리했습니다. 개발 시 도커 컴포즈로 두 서비스를 동시에 띄웁니다.

## 개발 서버 실행

```bash
# Next.js(포트 3000) + Realtime 서버(포트 3001)를 동시에 기동
docker compose up
```

- `web` 서비스: 현재 레포를 마운트하여 Next.js dev 서버를 실행합니다.
- `game` 서비스: `./realtime` 소스를 마운트해 개발용 Socket.IO 서버를 실행합니다. 브라우저는 `http://localhost:3001`로 접속합니다.

## 프로덕션 빌드

프런트엔드 이미지는 기존 `Dockerfile`로 빌드합니다. 실시간 서버는 `realtime/`에서 별도 Dockerfile을 추가하거나 Compose를 사용하세요.

```bash
docker build -t intersection:web .
docker run -p 3000:3000 intersection:web
```

사용 방법

이미지 빌드

```bash
cd intersection-nextjs
docker build -f Dockerfile.all-in-one -t intersection:all .
```

실행

```bash
docker run -p 3000:3000 -p 3001:3001 --name intersection intersection:all
```

프론트엔드: http://localhost:3000
WebSocket: http://localhost:3001 (클라이언트 기본값도 이 주소를 사용)

ENV 기본값
```bash
WEB_PORT=3000, REALTIME_PORT=3001
NEXT_PUBLIC_WS_URL=http://localhost (line 3001)
```


게임 서버를 동일 레포로 완전히 통합하기 전까지는 `../intersection` 컨테이너를 따로 띄워 두어야 합니다.

## 환경 변수

- `NEXT_PUBLIC_WS_URL`: 프런트엔드가 연결할 Socket.IO 서버 주소. 기본값 `http://localhost:3001`.
- `REALTIME_INTERNAL_URL`: SSR 등 서버 내부에서 사용할 내부 주소(예: `http://game:3001`).
- `PORT`, `HOST`: `realtime` 서버에서 사용.

## TODO (서버 통합 로드맵)

1. 기존 게임 로직(맵/물리)을 점진적으로 `realtime/`로 이관.
2. 필요 시 Next Route Handler로 흡수하거나 별도 스케일링 가능한 독립 서비스로 유지.
3. 프로덕션 프록시(Nginx/Traefik)에서 `/socket.io/` WebSocket 업그레이드 설정.
