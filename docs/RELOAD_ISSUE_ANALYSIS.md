# 페이지 주기적 새로고침 문제 분석

## 발견된 문제

### 1. Cache-Busting으로 인한 iframe 재로드 가능성

**위치**: `embedded.html:346-362`

`loadProjectFromSrc` 함수가 `.ncft` 파일을 로드할 때마다 `?t=${Date.now()}`를 추가하여 cache-busting을 수행합니다:

```javascript
const cacheBuster = cleanSrc.includes('.ncft') ? `?t=${Date.now()}` : '';
const url = cleanSrc + cacheBuster;
```

**문제점**:
- 이 함수는 초기 로드 시에만 호출되어야 하는데, 파일이 저장된 후 다시 호출되면 iframe이 재로드될 수 있습니다
- 하지만 코드를 보면 `loadInitialProject()`는 초기 로드 시에만 호출되므로 직접적인 원인은 아닙니다

### 2. Auto-Save 후 프로젝트 재로드 가능성

**위치**: `embedded.html:391-400`

`indiv_audio_map.ncft` 파일이 저장된 후, 다음 로드 시 cache-busting을 사용하여 최신 버전을 가져옵니다:

```javascript
if (src.includes('indiv_audio_map.ncft')) {
  try {
    const latest = await loadProjectFromSrc(src);
    console.log('[Load] Loaded latest indiv_audio_map.ncft from server');
    return latest;
  } catch (e) {
    console.warn('[Load] Failed to load latest, trying original:', e);
  }
}
```

**문제점**:
- 이 코드는 초기 로드 시에만 실행되므로 직접적인 원인은 아닙니다
- 하지만 만약 어딘가에서 `loadInitialProject()`가 다시 호출되면 iframe이 재로드될 수 있습니다

### 3. 가능한 원인들

1. **브라우저의 자동 새로고침**: 
   - 개발자 도구가 열려있거나 특정 확장 프로그램이 페이지를 모니터링하고 있을 수 있습니다
   - Service Worker가 페이지를 업데이트하려고 시도할 수 있습니다

2. **에러로 인한 재시도**:
   - JavaScript 에러가 발생하면 브라우저가 자동으로 페이지를 새로고침할 수 있습니다
   - 하지만 코드에서 명시적인 `location.reload()`는 발견되지 않았습니다

3. **iframe src 변경**:
   - iframe의 src가 변경되면 자동으로 재로드됩니다
   - 하지만 코드에서 iframe src를 변경하는 부분은 발견되지 않았습니다

4. **파일 감시 및 자동 새로고침**:
   - 개발 서버나 빌드 도구가 파일 변경을 감지하고 자동으로 새로고침할 수 있습니다
   - Hot Module Replacement (HMR) 같은 기능이 활성화되어 있을 수 있습니다

## 권장 조치

1. **브라우저 개발자 도구 확인**:
   - Network 탭에서 주기적인 요청이 있는지 확인
   - Console 탭에서 에러나 경고 메시지 확인
   - Sources 탭에서 breakpoint를 설정하여 새로고침이 발생하는 시점 확인

2. **Cache-Busting 비활성화 테스트**:
   - 초기 로드 후에는 cache-busting을 사용하지 않도록 수정
   - 파일이 저장되어도 iframe을 재로드하지 않도록 보장

3. **에러 핸들링 강화**:
   - 모든 에러를 catch하여 페이지가 크래시되지 않도록 보장
   - 에러 발생 시 로그만 남기고 페이지는 계속 실행되도록 보장

