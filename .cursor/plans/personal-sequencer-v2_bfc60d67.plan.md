---
name: personal-sequencer-v2
overview: "`test-workspace.html`에서 개인 오디오/시퀀서가 어떻게 업데이트되는지(신호 생성→파라미터 매핑→시퀀서 패턴 생성/전송) 정확히 문서화한 뒤, 기존 로직을 건드리지 않고 ‘개인뷰 시퀀서 V2’를 새 모듈+새 NoiseCraft 패치로 추가합니다. 규칙(가장 가까운 2이웃, 원거리 단음, 근거리 스냅/디튠, 노이즈 톤화, 경계 출입 때만 시퀀서 갱신)을 충족하면서 “만났을 때 기분 좋은” 사운드를 이벤트 기반 스위트너로 구현합니다."
todos:
  - id: doc-current-test-workspace
    content: "`test-workspace.html`/`particle-system.js`/`sequencer-logic.js` 기준으로 현재 개인 시퀀서가 어떤 데이터로 어떤 주기로 업데이트되는지(정렬/랜덤성/노드ID/패턴형식) 정리 문서화"
    status: completed
  - id: design-personal-sequencer-v2-module
    content: 새 개인 시퀀서 로직(최근접 2이웃 정렬, 불협 회피 스냅, 경계 출입 감지, 4x13 grid 생성, 이벤트 트리거 인터페이스) 설계/구현
    status: completed
  - id: add-noisecraft-patch-v2
    content: "`noisecraft/examples/indiv_audio_map_v2.ncft`(또는 확장) 추가: 노이즈 톤화(2채널), meetGate 스위트너, detune/glide 제어 노드 구성"
    status: completed
  - id: wire-mobileview-feature-flag
    content: "`MobileView`에 V2 플래그 경로 추가(기존 로직 유지), V2는 시퀀서 grid는 boundary event 때만, 연속 파라미터는 매 프레임 전송"
    status: completed
  - id: tune-and-validate
    content: "거리 시나리오별(0/1/2 이웃, 진입/이탈) 사운드 튜닝: dissonance 회피, 볼륨/필터 Q 커브, 스위트너 타이밍/레벨 검증"
    status: completed
---

## 1) 기존 `test-workspace` 로직 정확 분석 (현재 구현의 실제 동작)

- **입력(물리/거리)**: `noisecraft/public/particle-system.js`에서 `innerRadius/outerRadius` 기준으로 `isInner/isOuter`를 계산합니다.
```116:139:/Users/hyewonhwang/.cursor/worktrees/intersection-nextjs/mni/noisecraft/public/particle-system.js
  calculateInteraction(p1, p2) {
    const gravitational = this.calculateGravitationalForce(p1, p2);
    const distance = gravitational.distance;

    const relVx = p2.velocity.x - p1.velocity.x;
    const relVy = p2.velocity.y - p1.velocity.y;
    const relativeVelocity = Math.sqrt(relVx * relVx + relVy * relVy);

    const dirX = distance > 0 ? (p2.position.x - p1.position.x) / distance : 0;
    const dirY = distance > 0 ? (p2.position.y - p1.position.y) / distance : 0;
    const closingSpeed = Math.max(0, relVx * dirX + relVy * dirY);

    const isInner = distance <= this.innerRadius;
    const isOuter = distance > this.innerRadius && distance <= this.outerRadius;

    return {
      distance,
      relativeVelocity,
      closingSpeed,
      attraction: gravitational.normalizedForce,
      isInner,
      isOuter,
      gravitationalForce: gravitational.force,
    };
  }
```

- **신호 구조**: `generateSignals()`는 `innerParticles/outerParticles`를 **정렬하지 않고**(particle 배열 순서) 담습니다. 이건 “가장 가까운 2이웃”에 그대로 쓰면 오동작합니다.
```237:341:/Users/hyewonhwang/.cursor/worktrees/intersection-nextjs/mni/noisecraft/public/particle-system.js
  generateSignals(targetId) {
    const target = this.particles.find((p) => p.id === targetId);
    if (!target) return null;

    const innerParticles = [];
    const outerParticles = [];

    for (const other of this.particles) {
      if (other.id === targetId) continue;
      const interaction = this.calculateInteraction(target, other);

      if (interaction.isInner) {
        innerParticles.push({ particle: other, interaction });
      } else if (interaction.isOuter) {
        outerParticles.push({ particle: other, interaction });
      }
    }

    // ... closingSpeed 계산 ...

    return {
      attraction,
      velocity: normalizedVelocity,
      distance,
      closingSpeed,
      isInner,
      isOuter,
      innerParticles: innerParticles.map(p => ({
        id: p.particle.id,
        distance: p.interaction.distance,
        closingSpeed: p.interaction.closingSpeed,
        pattern: p.particle.sequencerPattern,
        position: { x: p.particle.position.x, y: p.particle.position.y }
      })),
      outerParticles: outerParticles.map(p => ({
        id: p.particle.id,
        distance: p.interaction.distance,
        pattern: p.particle.sequencerPattern,
        position: { x: p.particle.position.x, y: p.particle.position.y }
      })),
      mostAffectingParticleId: mostAffecting.particle ? mostAffecting.particle.id : null
    };
  }
```

- **시퀀서 업데이트(문제 핵심)**: `test-workspace.html`은 매 프레임(실제로는 `PARAM_UPDATE_INTERVAL`≈30fps) 개인 시퀀서를 갱신하려고 시도합니다. 내부적으로 패턴이 랜덤이라 패턴 키가 계속 바뀌어 업데이트가 과도해집니다.
```2475:2604:/Users/hyewonhwang/.cursor/worktrees/intersection-nextjs/mni/noisecraft/public/test-workspace.html
                // Update sequencer patterns when inner particles change
                const currentInnerParticleIds = new Set(
                  signals0.innerParticles
                    ? signals0.innerParticles.map((p) => p.id)
                    : []
                );

                const innerParticlesChanged =
                  currentInnerParticleIds.size !==
                    previousInnerParticleIds.size ||
                  [...currentInnerParticleIds].some(
                    (id) => !previousInnerParticleIds.has(id)
                  ) ||
                  [...previousInnerParticleIds].some(
                    (id) => !currentInnerParticleIds.has(id)
                  );

                // ALWAYS update sequencer patterns...
                if (iframe && iframe.contentWindow) {
                  const selfParticle = particles.find((p) => p.id === 0);
                  if (selfParticle) {
                    const innerParticleObjects = signals0.innerParticles
                      ? signals0.innerParticles
                          .map((pData) =>
                            particles.find((p) => p.id === pData.id)
                          )
                          .filter((p) => p !== undefined)
                      : [];

                    const sequencerPattern =
                      sequencerLogic.generateIndividualPattern(
                        selfParticle,
                        innerParticleObjects
                      );

                    const patternKey = JSON.stringify({
                      bass: sequencerPattern.bass.map((step) =>
                        Array.isArray(step) ? step.join(",") : step
                      ),
                      baritone: sequencerPattern.baritone.map((step) =>
                        Array.isArray(step) ? step.join(",") : step
                      ),
                      tenor: sequencerPattern.tenor.map((step) =>
                        Array.isArray(step) ? step.join(",") : step
                      ),
                    });

                    const patternActuallyChanged =
                      !previousSequencerPattern ||
                      previousSequencerPattern !== patternKey;

                    if (patternActuallyChanged || (innerParticlesChanged && !previousSequencerPattern)) {
                      requestAnimationFrame(() => {
                        updateMonoSeqSequencer(iframe.contentWindow, "211", 0, sequencerPattern.bass, 12);
                        updateMonoSeqSequencer(iframe.contentWindow, "212", 0, sequencerPattern.baritone, 12);
                        updateMonoSeqSequencer(iframe.contentWindow, "213", 0, sequencerPattern.tenor, 12);
                      });
                      previousSequencerPattern = patternKey;
                    }
                  }

                  previousInnerParticleIds = new Set(currentInnerParticleIds);
                }
```

- **패턴 생성 방식**: `noisecraft/public/sequencer-logic.js`의 개인 패턴은 “자기 + (첫 두 inner particle) 음”을 재료로 해서 **각 voice마다 12-step 랜덤 아르페지오**를 매번 새로 만듭니다.
```93:162:/Users/hyewonhwang/.cursor/worktrees/intersection-nextjs/mni/noisecraft/public/sequencer-logic.js
  generateIndividualPattern(selfParticle, innerParticles) {
    const availableNotes = [];

    if (selfParticle && typeof selfParticle.getActiveNoteIndex === "function") {
      const selfNoteIndex12 = selfParticle.getActiveNoteIndex();
      if (selfNoteIndex12 >= 0 && selfNoteIndex12 < 12) {
        availableNotes.push(selfNoteIndex12);
      }
    }

    if (Array.isArray(innerParticles) && innerParticles.length > 0) {
      innerParticles.forEach((innerParticle, index) => {
        if (!innerParticle || typeof innerParticle.getActiveNoteIndex !== "function") return;
        if (index >= 2) return;
        const noteIndex12 = innerParticle.getActiveNoteIndex();
        if (noteIndex12 >= 0 && noteIndex12 < 12) {
          availableNotes.push(noteIndex12);
        }
      });
    }

    const numSteps = 12;
    const bassPattern = this.generateArpeggiatorPattern(availableNotes, numSteps);
    const baritonePattern = this.generateArpeggiatorPattern(availableNotes, numSteps);
    const tenorPattern = this.generateArpeggiatorPattern(availableNotes, numSteps);

    return { bass: bassPattern, baritone: baritonePattern, tenor: tenorPattern, columns: { bass: null, baritone: null, tenor: null } };
  }
```

- **배경 오디오(현재 가능 범위)**: `background-audio-post-processing.js`는 “가까운 최대 2명”을 **거리순 정렬**해 선택하고, 노드 `183(Vol CHORDS)`, `163(REVERB WET)`를 거리 기반으로 제어합니다. 다만 ‘노이즈가 음처럼 들리게’ 만드는 필터-톤화 로직은 아직 없습니다.

## 2) 새 개인뷰 시퀀서 V2의 목표(규칙 매핑)

- **규칙 1/2**: “각자 1음 + 가장 가까운 2이웃(조건부)”을 개인 화성으로 사용하되, 멀면 자기 음만(단음).
- **규칙 3**: 배경 노이즈는 유지하고, 가까운 이웃의 ‘음/화성 성분’이 **필터로 점점 또렷해지는**(공명/밴드패스 기반) 레이어를 추가.
- **규칙 4**: `SEQUENCER_RADIUS`(파일 상단 const) 안으로 들어온 이웃만 **스냅(불협 회피) + 디튠/글라이드**되어 시퀀서에 반영. 시퀀서는 **bass/baritone/tenor 각 4x13**이며, **경계 출입 이벤트 때만** grid를 갱신.
- **+. 만남이 기분 좋게**: “새 시퀀서 그리드”를 자주 바꾸지 않고도, **경계 진입 순간에만** 짧은 벨/패드/코러스성 detune 스위트너를 트리거(클릭/불쾌감 방지: 느린 attack, 소프트 리미팅).

## 3) 구현 전략(기존 로직 최소 침범)

### 3-1. 코드: 새 모듈로 분리 + 플래그로 온오프

- 새 로직은 기존 파일을 ‘대체’하지 않고 **신규 모듈**로 추가하고, UI에서는 **feature flag**로 선택합니다.
- 작업 타겟(예상):
  - [`src/lib/audio/personalSequencerV2.ts`](src/lib/audio/personalSequencerV2.ts) (신규):
    - 거리 계산(월드 wrap 포함) → 이웃 2명 거리순 선택
    - rawTone 산출(기본: `hashToneIndex(id)` 재사용)
    - **불협 회피 스냅**: 허용 간격 집합(예: {0,3,4,5,7,8,9}) 중 raw와 가장 가까운 것으로 매핑하되, 두 이웃 간 충돌도 최소화(간단한 점수 최적화)
    - 시퀀서 grid 생성(4 steps x 13 rows): 각 voice는 ‘한 row를 4스텝에 채우는’ 기본형 + 옵션으로 소프트 리듬(예: bass는 1010, 상성부는 1110)
    - 경계 출입 감지용 `BoundaryTracker`(prev set vs next set)
  - [`src/components/mobile/MobileView.tsx`](src/components/mobile/MobileView.tsx) (최소 수정):
    - 기존 effect는 유지하고, `NEXT_PUBLIC_PERSONAL_SEQ_V2=1`일 때만 V2 경로를 실행.
    - V2는 “연속 파라미터(노이즈 톤화 등)”는 매 프레임 갱신 가능, “MonoSeq grid”는 boundary event 때만 송신.

### 3-2. NoiseCraft: 개인뷰 전용 새 패치 추가(선택하신 방향)

- 기준 패치: [`noisecraft/examples/indiv_audio_map.ncft`](noisecraft/examples/indiv_audio_map.ncft)
- 여기엔 이미:
  - `211/212/213` = `MonoSeq bass/baritone/tenor` (각 4x13)
  - `183` = `Vol CHORDS`
  - `163` = `REVERB WET`
  - `196` = 세 성부에 공통으로 곱해지는 detune factor(현재는 ADSR로 미세 변조)
- V2 패치(예: `noisecraft/examples/indiv_audio_map_v2.ncft`)에서 추가/정리:
  - **Noise tonalization 채널 2개**
    - `Noise` → `Bandpass(or Filter)`
    - cutoff(혹은 center freq)는 `MonoSeq baritone/tenor`의 `freq`를 기반으로 연결(이웃 음과 동조)
    - resonance(Q)와 gain은 JS에서 보낸 `neighbor1Prox`, `neighbor2Prox`(0..1)로 제어
    - 멀면: Q↓, gain↓ → 그냥 노이즈
    - 가까우면: Q↑, gain↑ → 음처럼 또렷
  - **만남 스위트너**
    - `meetGate`(Knob/Const)로 0→1 pulse를 받으면 ADSR가 짧게 열리도록 구성
    - ADSR 출력으로 `detuneAmount`(미세), `sweetPadGain` 등을 동시에 제어
    - 목표: “딱 만났을 때” 부드럽게 반짝이고, 즉시 불협/클릭 없이 사라짐

### 3-3. 경계 이벤트 정의

- 상단 상수 예시(코드/튜닝 포인트):
  - `const SEQUENCER_RADIUS = 420;` (현재 MobileView의 `MAX_HARMONY_DISTANCE`와 맞추거나 조정)
  - `const SWEETENER_HOLD_MS = 120;` (meetGate pulse 길이)
  - `const PROX_TONALIZE_START = SEQUENCER_RADIUS * 1.2;` (노이즈 톤화는 더 멀리서도 서서히 시작 가능)
- “경계 출입”은 `거리 <= SEQUENCER_RADIUS`를 기준으로, **가장 가까운 2명**에 대해 in/out 변화가 있을 때만 시퀀서 grid 송신.

## 4) ‘조금도 기분 나쁘면 안되게’ 만드는 화성/사운드 제안(avoid_dissonance 선택 반영)

- **불협 회피 스냅 규칙**(피치클래스 기준):
  - 금지: 
    - self 대비 
      - 단2(1), 장2(2), 트라이톤(6), 장7(11)
    - 이웃끼리도 동일 금지
  - 허용/선호: 
    - 0(유니즌), 3/4(단/장3도), 5(완4도), 7(완5도), 8/9(단/장6도)
  - 구현은 “raw tone을 최대한 유지”하되, 금지 간격이면 가장 가까운 허용 간격으로 1~2 semitone만 이동하도록 설계(최소 수정).
- **디튠/글라이드**:
  - 스냅은 즉시 점프 대신 80~150ms 정도의 glide(NoiseCraft 패치에서 포트라멘토/필터 슬루).
  - detune은 ±5~15 cents 정도로 매우 작게(코러스 느낌만).
- **만남 스위트너**:
  - entry 때만 “벨/글라스” 같은 밝은 transient를 아주 작게 섞고(attack 5~15ms, decay 200~400ms), exit 때는 더 짧거나 생략.

## 5) 검증/디버그 계획

- `test-workspace`는 건드리지 않고,
  - 개인뷰(`MobileView`)에서 V2 플래그를 켜서
  - (1) 경계 밖: bass만, (2) 1명 진입: baritone 추가, (3) 2명 진입: tenor 추가, (4) 드나들 때만 grid가 바뀌는지 확인.
- 노이즈 톤화는 연속 파라미터이므로 프레임 업데이트로 자연스러운 변화 확인.