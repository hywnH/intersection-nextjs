# 파일 손상 문제 해결 가이드

## 파일 손상의 주요 원인

### 1. Python 정규식 치환 문제
- **문제**: Python의 `re.sub()`에서 DOTALL flag를 사용하면 너무 넓은 범위를 매칭할 수 있음
- **예시**: `re.sub(r'pattern1.*?pattern2', replacement, content, flags=re.DOTALL)`
  - 파일이 클 때 잘못된 매칭으로 전체 파일 구조 파괴
- **해결**: 
  - 정확한 라인 범위를 사용
  - 여러 단계로 나누어 수정
  - 작은 변경사항만 한 번에 적용

### 2. 이스케이프 문자 처리 오류
- **문제**: 문자열에서 `\'` 같은 이스케이프가 실제로 파일에 들어감
- **예시**: `import ... from \'/path/file.js\'` → SyntaxError 발생
- **해결**: 
  - Python raw string (`r''`) 사용 주의
  - 실제 파일에는 이스케이프 없이 작성

### 3. 대용량 파일 한 번에 수정
- **문제**: 2700줄 이상의 파일을 한 번에 수정하려고 하면 실패 위험 증가
- **해결**: 
  - 라인 단위 수정 (lines.insert(), lines[i] = ...)
  - 작은 변경사항만 batch로 처리

## 권장 수정 방법

### 방법 1: 라인 단위 수정 (가장 안전)
```python
with open('file.html', 'r') as f:
    lines = f.readlines()

# 특정 라인 뒤에 추가
lines.insert(line_number, "new line\n")

# 특정 라인 교체
lines[line_number] = "new line\n"

with open('file.html', 'w') as f:
    f.writelines(lines)
```

### 방법 2: sed 명령어 (간단한 치환)
```bash
sed -i '' 's|old|new|g' file.html
```

### 방법 3: 작은 정규식 치환
```python
# 큰 범위 피하기
pattern = r'exact_line_content'
replacement = r'new_content'
# flags=re.DOTALL 사용 최소화
content = re.sub(pattern, replacement, content)
```

## 현재 상태

- ✅ `global-workspace.html` 복원됨
- ✅ 기본 수정사항 적용 (title, ncft 파일명)
- ✅ GlobalHarmonicPlacer import 추가
- ⚠️ 나머지 수정사항은 안전하게 단계별로 적용 필요

