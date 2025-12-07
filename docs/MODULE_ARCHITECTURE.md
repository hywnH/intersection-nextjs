# Module Architecture for Global/Individual Audio

## Overview

이 아키텍처는 Individual Audio와 Global Audio를 각각 별도의 `.ncft` 파일로 관리하고, 각 파티클(유저)마다 고유한 시퀀서 패턴을 부여하는 모듈화된 시스템입니다.

## 모듈 구조

### 1. Sequencer Pattern Generator (`sequencer-pattern-generator.js`)

각 파티클/유저에게 고유한 시퀀서 패턴을 부여하고 관리합니다.

**주요 기능:**
- 파티클 생성 시 고유 패턴 자동 할당
- 중복 패턴 방지
- 음악 이론 기반 패턴 생성 (선택적)
- 패턴 레지스트리 관리 및 내보내기/가져오기

**사용 예시:**
```javascript
import { createPatternGenerator } from '/public/sequencer-pattern-generator.js';

const patternGen = createPatternGenerator({
  numNotes: 12,
  useMusicTheory: true
});

// 새 파티클 생성 시 고유 패턴 부여
const particleId = 0;
const pattern = patternGen.generateUniquePattern(
  particleId,
  'C Pentatonic Major'
);

// 파티클에 패턴 할당
particle.sequencerPattern = pattern;
```

### 2. NCFT File Manager (`ncft-file-manager.js`)

Individual과 Global 오디오를 위한 별도의 `.ncft` 파일을 관리합니다.

**주요 기능:**
- Individual/Global 각각 별도 iframe 관리
- Global 파일이 없으면 Individual 파일에서 복사 생성
- 프로젝트 파일 로드/저장
- iframe 간 메시지 전송

**사용 예시:**
```javascript
import { createNcftFileManager } from '/public/ncft-file-manager.js';

const fileManager = createNcftFileManager({
  basePath: '/public/examples',
  individualFile: 'indiv_audio_map.ncft',
  globalFile: 'global_audio_map.ncft'
});

// Individual 오디오 초기화
await fileManager.initializeIndividual('individual-iframe', (project, iframe) => {
  console.log('Individual audio ready');
});

// Global 오디오 초기화 (없으면 자동으로 Individual에서 복사)
await fileManager.initializeGlobal('global-iframe', (project, iframe) => {
  console.log('Global audio ready');
});

// 각 iframe에 메시지 전송
fileManager.postMessageToIndividual({
  type: 'noiseCraft:setParam',
  nodeId: '211',
  paramName: 'value',
  value: 0.5
});
```

### 3. Mapping Preset Manager (`mapping-preset-manager.js`)

Individual과 Global 오디오를 위한 별도의 매핑 프리셋을 관리합니다.

**주요 기능:**
- 매핑 저장/로드 (localStorage)
- JSON 파일로 내보내기/가져오기
- 프리셋 관리 (이름 지정, 저장, 불러오기)
- Individual/Global 각각 별도 프리셋 지원

**사용 예시:**
```javascript
import { createMappingPresetManager } from '/public/mapping-preset-manager.js';

// Individual용 매핑 매니저
const individualMappings = createMappingPresetManager({
  storageKey: 'noisecraftIndividualMappings'
});

// Global용 매핑 매니저
const globalMappings = createMappingPresetManager({
  storageKey: 'noisecraftGlobalMappings'
});

// 매핑 추가
individualMappings.addMapping({
  nodeId: '211',
  paramName: 'value',
  operation: 'none',
  enabled: true,
  streams: [{
    stream: 'attraction',
    interpolation: 'linear',
    inputMin: 0,
    inputMax: 1,
    outputMin: 0,
    outputMax: 0.1
  }]
});

// 프리셋으로 저장
individualMappings.savePreset('individual-default', 'Default individual audio mapping');
globalMappings.savePreset('global-audience', 'Global audio for audience');

// JSON 파일로 내보내기
individualMappings.exportMappings('individual-mappings.json');
globalMappings.exportMappings('global-mappings.json');
```

## 통합 예시

### test-workspace.html에서의 사용

```javascript
import { createPatternGenerator } from '/public/sequencer-pattern-generator.js';
import { createNcftFileManager } from '/public/ncft-file-manager.js';
import { createMappingPresetManager } from '/public/mapping-preset-manager.js';

// 모듈 초기화
const patternGen = createPatternGenerator();
const fileManager = createNcftFileManager();
const individualMappings = createMappingPresetManager({
  storageKey: 'noisecraftIndividualMappings'
});
const globalMappings = createMappingPresetManager({
  storageKey: 'noisecraftGlobalMappings'
});

// 파티클 생성 시 고유 패턴 부여
function createParticleWithUniquePattern(particleId, x, y, mass) {
  const particle = particleSystem.addParticle(particleId, x, y, 0, mass);
  
  // 기존에 할당된 패턴들 가져오기
  const existingPatterns = patternGen.getAllPatterns().map(p => p.pattern);
  
  // 고유 패턴 생성 및 할당
  const pattern = patternGen.generateUniquePattern(
    particleId,
    'C Pentatonic Major',
    existingPatterns
  );
  
  particle.sequencerPattern = pattern;
  return particle;
}

// Individual 오디오 초기화
await fileManager.initializeIndividual('individual-iframe', async (project, iframe) => {
  // Individual 매핑 로드
  individualMappings.loadFromStorage();
  
  // Auto-save 활성화
  fileManager.enableAutoSaveIndividual(true);
});

// Global 오디오 초기화
await fileManager.initializeGlobal('global-iframe', async (project, iframe) => {
  // Global 매핑 로드 (또는 새로 생성)
  globalMappings.loadFromStorage();
  
  // Global용 매핑이 없으면 기본 프리셋 생성
  if (globalMappings.getMappings().length === 0) {
    // Global용 기본 매핑 설정
    // (Individual과 다른 노드들을 매핑할 수 있음)
  }
  
  fileManager.enableAutoSaveGlobal(true);
});
```

## 워크플로우

### 1. Individual Audio (개별 사용자)

1. 사용자가 입장 → `patternGen.generateUniquePattern()`으로 고유 패턴 부여
2. Individual `.ncft` 파일 로드 → `fileManager.initializeIndividual()`
3. Individual 매핑 프리셋 로드 → `individualMappings.loadFromStorage()`
4. 파티클 상호작용 시 → Individual iframe에 시퀀서 패턴 업데이트
5. 매핑 변경 시 → `individualMappings.savePreset()`으로 저장

### 2. Global Audio (관객)

1. Global `.ncft` 파일 로드 → `fileManager.initializeGlobal()`
   - 파일이 없으면 Individual 파일에서 자동 복사
2. Global 매핑 프리셋 로드 → `globalMappings.loadFromStorage()`
   - 없으면 새로 생성하거나 Individual과 다른 프리셋 사용
3. 모든 파티클의 패턴을 Global iframe에 업데이트
4. 매핑 변경 시 → `globalMappings.savePreset()`으로 저장

## 파일 구조

```
noisecraft/
├── public/
│   ├── sequencer-pattern-generator.js  # 패턴 생성 모듈
│   ├── ncft-file-manager.js            # 파일 관리 모듈
│   ├── mapping-preset-manager.js        # 매핑 프리셋 모듈
│   └── test-workspace.html              # 통합 사용 예시
├── examples/
│   ├── indiv_audio_map.ncft            # Individual 오디오 파일
│   └── global_audio_map.ncft           # Global 오디오 파일 (자동 생성)
└── docs/
    └── MODULE_ARCHITECTURE.md          # 이 문서
```

## 장점

1. **모듈화**: 각 기능이 독립적으로 테스트 및 유지보수 가능
2. **재사용성**: 다른 프로젝트에서도 쉽게 사용 가능
3. **확장성**: 새로운 기능 추가가 용이
4. **명확한 책임 분리**: 각 모듈이 명확한 역할을 가짐
5. **프리셋 관리**: Individual/Global 각각 별도 매핑 프리셋 관리

## 다음 단계

1. `test-workspace.html`에 모듈 통합
2. Global 오디오 iframe 추가 (UI)
3. Individual/Global 전환 UI 추가
4. 프리셋 선택 UI 추가
5. 서버 측 파일 저장 API 구현 (선택적)

