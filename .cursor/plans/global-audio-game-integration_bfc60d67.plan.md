---
name: global-audio-game-integration
overview: noisecraft/public/global-workspace.html에서 쓰던 글로벌 오디오(스트림→매핑→NoiseCraft params + 글로벌 MonoSeq 시퀀서/하모닉 배치)를 분석한 뒤, 서버(realtime)에서 동일한 신호/패턴을 계산해 실제 /global 뷰의 NoiseCraft iframe으로 전달하도록 연결합니다.
todos:
  - id: analyze-workspace-flow
    content: "global-workspace의 signals/매핑/시퀀서 업데이트 흐름을 게임 상태로 치환(입력: players)할 수 있도록 정리"
    status: completed
  - id: server-global-audio-engine
    content: realtime 서버에 globalSignals + pulsar + clusterCount + assignments + grids 생성 엔진 구현
    status: in_progress
  - id: server-mapping-eval
    content: global-workspace-mappings.json 포맷을 TS에서 평가해서 NoiseCraftParam[] 생성
    status: pending
  - id: socket-protocol
    content: audioGlobalV2 이벤트/타입 추가 및 global spectator에게 브로드캐스트
    status: pending
  - id: client-forwarding
    content: /global 뷰에서 audioGlobalV2를 받아 NoiseCraft iframe에 params/toggleCell 전달(그리드 diff 포함)
    status: pending
---

## 목표

- **global-workspace의 로직(글로벌 스트림 + 매핑 + MonoSeq 패턴/하모닉 배치)**을 실제 게임의 글로벌 모드와 연결한다.
- 계산은 **서버(realtime)**에서 수행하고, 클라이언트(/global)는 **NoiseCraft iframe에 전달(postMessage)**만 한다.
- 모바일(/mobile) 오디오는 영향 없이 유지한다(이벤트 분리/스코프 제한).

## 기존 global-workspace 로직 분석(현재 동작)

- **패치 로드/표시**: `noisecraft/public/global-workspace.html`에서 iframe으로 `embedded.html?ui=full&src=/public/examples/glb_audio_map.ncft` 로드.
- **글로벌 스트림 계산**(입력은 particles):
- **entropy**: 속도 크기 분포(12 bins) Shannon entropy (속도는 maxSpeed=100 기준 정규화)
- **rmsVelocity**: \(\sqrt{mean(vx^2+vy^2)}\)
- **particleCount**: particles.length
- **clusterCount**: innerRadius(기본 80) 그래프에서 DFS로 연결요소 수
- **inInnerPulsar/outInnerPulsar**: innerRadius adjacency set이 이전 프레임 대비 **새 연결/끊김**이 생기면 0.5s 동안 1로 유지
- **스트림→노드 매핑**:
- `StreamNodeMapper.generateParams(globalSignals)`로 `NoiseCraftParam[]` 생성 후 `sendToNoiseCraft(params)`로 iframe에 `noiseCraft:setParams` 전달.
- 글로벌 전용 파일 `noisecraft/public/global-workspace-mappings.json`을 1순위로 로드.
- **글로벌 시퀀서(하모닉 배치 + MonoSeq)**:
- `SequencerLogic.generateGlobalPattern(particles, assignments, harmonicPlacer)`가 bass/baritone/tenor 각각 **12 steps × 12 rows** 패턴을 생성.
- `patternPipeline.assignGlobalPositionToParticle()`로 신규 particle에 (voice, column) 할당을 추가하고, 기존 할당은 유지.
- `updateMonoSeqSequencer(iframeWindow, nodeId, patIdx, pattern, 12)`로 NoiseCraft MonoSeq(`211/212/213`) 그리드를 갱신.

## 실제 게임 연결 설계(서버 계산 → 클라 전달)

### 1) 서버(realtime)에서 글로벌 오디오 엔진 추가

- 대상: `realtime/src/index.ts`에 붙일 별도 모듈(권장: `realtime/src/globalAudioEngine.ts`)
- 서버가 매 tick/주기마다 아래 상태를 유지:
- **prevInnerAdjacency**: playerId -> Set<neighborId> (pulsar 계산용)
- **pulsarTimers**: in/out 각각 남은 시간(s)
- **globalAssignments**: playerId -> { voice: 'bass'|'baritone'|'tenor', step: 0..11, noteIndex: 0..11 }
- **harmonicPlacer state**: `noisecraft/public/harmonic-placer.js`의 `GlobalHarmonicPlacer` 알고리즘을 TS로 포팅(브라우저 의존 제거)하거나 동일 로직을 서버용으로 재구현
- 서버 입력 데이터:
- `players` 맵의 (x,y,vx,vy) + 게임 월드 크기(토러스) 사용
- 서버 출력 데이터(클라이언트로 보낼 것):
- **globalSignals**: { entropy, rmsVelocity, particleCount, clusterCount, inInnerPulsar, outInnerPulsar }
- **mappedParams**: global-workspace 매핑(JSON)을 적용한 NoiseCraftParam[]
- **monoSeqGrids**: { bass, baritone, tenor } 각각 [12][12] (또는 더 작은 diff 포맷)

### 2) 서버의 “스트림→매핑”을 타입스크립트로 구현

- 매핑 소스: `noisecraft/public/global-workspace-mappings.json` (서버 시작 시 읽어서 메모리에 캐시)
- 매핑 평가 로직(워크스페이스 구조를 그대로 지원):
- mapping item: { nodeId, paramName, enabled, operation, streams[] }
- stream mapping: { stream, interpolation(linear/log/exponential), inputMin/Max, outputMin/Max }
- per-item에서 streams를 합성(현재는 operation=add 기반) → nodeId/paramName별 합산
- 출력은 클라가 그대로 `postNoiseCraftParams`에 넘길 수 있는 형태(NoiseCraftParam).

### 3) 서버의 글로벌 시퀀서/하모닉 배치 구현

- 노트 부여: playerId 기반 안정 해시(예: 문자열 해시 % 12)로 **noteIndex 0..11** 부여.
- 배치 규칙:
- player join 시 `GlobalHarmonicPlacer.assignNewUser(noteIndex, totalUsers)`로 position(0..35) 선택
- position → voice=floor(pos/12), step=pos%12
- leave 시 해당 position 회수, 나머지 유저는 그대로 유지(안정성)
- 그리드 생성:
- 각 플레이어는 해당 voice의 해당 step에 자신의 noteIndex row를 1로 세팅
- steps=12, rows=12
- 전송 최적화:
- 서버에서 patternKey(hash) 만들어서 변할 때만 전송하거나
- 클라에서 prevGrid를 들고 diff만 postMessage (대량 toggleCell 방지)

### 4) 소켓 이벤트(프로토콜) 확장

- 기존 `audioGlobal`은 cluster 요약만 담고 있으므로 유지.
- 새로운 이벤트 추가 권장:
- `audioGlobalV2` (payload: { signals, params, sequencer:{ grids, version } })
- 타입 추가:
- `src/types/server.ts`에 `ServerAudioGlobalV2` 정의
- `src/lib/socket/events.ts`에 핸들러 추가(단, global 모드에서 state dispatch는 최소화)

### 5) 클라이언트(/global)에서 NoiseCraft로 전달

- 대상: `src/components/global/GlobalPerspectiveView.tsx`
- 변경:
- 현재 클라에서 cluster 기반으로 계산하던 NoiseCraft 파라미터 전송(useEffect)을 **서버가 보내주는 params로 대체**
- `audioGlobalV2` 수신 시:
  - `postNoiseCraftParams(iframe, origin, params)`
  - `toggleCell`로 MonoSeq grids 업데이트(클라 diff 적용)
- `/global/debug`에서는 iframe이 크게 보이도록 유지(이미 UI 쿼리/레이아웃을 준비한 상태).

## 마이그레이션/호환성

- 모바일 오디오: 이벤트 이름 분리(`audioGlobalV2`) + global 모드에서만 구독 → 모바일 영향 없음.
- 글로벌 패치 파일: 기본은 `noisecraft/examples/glb_audio_map.ncft` 유지.

## 검증(간단 체크리스트)

- `/global/debug`에서 NoiseCraft 그래프가 보이고, 노드 값(예: node 22 BPM)이 particleCount에 따라 변한다.
- 유저 수 증감 시 in/out pulsar가 0.5초 동안 1로 펄스된다.
- 유저 join/leave 시에만 MonoSeq 그리드가 의미 있게 바뀌고, 불필요한 full-grid 폭주는 없다.