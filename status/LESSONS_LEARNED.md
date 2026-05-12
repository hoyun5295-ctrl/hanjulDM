# hanjulDM LESSONS_LEARNED

> **분리 시점:** 2026-05-12 (D152)
> **상태:** 분리 초기 골격. 추후 사고·교훈 누적.

## 1. 분리 자체 (D152)

### 1-1. 분리 원칙 — "코드는 복제, 인스턴스는 공유"

한줄AI(targetup)와 hanjulDM은 코드는 완전 독립, 인프라(DB·QTmsg·IMC·PG)는 같은 인스턴스 공유.
같은 인스턴스라도 두 코드는 각자 자기 영역만 호출 (flyer_* vs 한줄AI 테이블).

### 1-2. sync 금지

한줄AI에 버그 fix가 들어가도 hanjulDM에 자동 반영 0건.
1년·3년 후 두 코드 완전 독립 진화. 이게 분리의 본질이자 가치.

### 1-3. 한줄AI 본진에 영향 0건 보장

- hanjulDM 작업 시 절대 한줄AI(targetup/) 코드 수정 X
- hdm-push 실행 시 한줄AI dist·프로세스·로그 흔들림 0건
- 같은 인스턴스 DB라도 flyer_* 테이블만 접근

## 2. PowerShell Copy-Item 함정 (D152 분리 시점)

### 2-1. -Recurse 옵션 버그

`Copy-Item -Path "...\*" -Destination "..." -Recurse` 사용 시 일부 하위 폴더가 leaf로 인식되어
"Container cannot be copied onto existing leaf item" 에러 발생.

**대책:** robocopy 사용
```powershell
robocopy "$src" "$dst" /E /XD node_modules dist .git /NFL /NDL /NJH /NJS
```

## 3. 한줄AI 본진과 공유하는 카테고리 (참고)

한줄AI(targetup) LESSONS_LEARNED와 SCHEMA를 직접 import하지 않지만, 다음 사고 패턴은 hanjulDM에도 적용:

- 백틱 사고 (template literal 안 raw 백틱 X — 큰따옴표 사용)
- 옵션 A/B/C 추천 금지 (정답 1개만)
- 추측 금지 (SQL/grep 검증 후 수정안)
- 컨트롤타워 우선 (라우트 인라인 로직 금지)
- 동일 패턴 grep 전수 (1곳만 수정 후 "완료" 보고 X)

상세는 한줄AI LESSONS_LEARNED 참조 (단, hanjulDM 코드 수정 시 hanjulDM 자체 LESSONS_LEARNED만 의무 로드).

## 4. 향후 누적될 영역

- PHASE 0 트랙 A·B 진행 중 사고
- POS Agent 직접연결 고도화 사고
- CT-F10 RFM 실구현 사고
- POS 매출 귀속 알고리즘 사고
- 정부 스마트상점 결제 모듈 사고
