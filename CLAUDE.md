# hanjulDM (한줄전단AI) 프로젝트 — AI 에이전트 온보딩

<CRITICAL_DIRECTIVES>
  <SYSTEM_WARNING>
    아래 규칙은 최우선(0번) 원칙이며, Auto Mode를 포함한 어떠한 상황에서도 절대 예외가 없다.
    위반 시 치명적인 시스템 장애 및 사용자 데이터 파괴로 간주한다.
    이 문서는 Harold님과 AI가 hanjulDM 프로젝트를 오래 함께 만들기 위해 만든 통제 룰이다.
    위반 = 신뢰 파괴 = 협업 종료.

    ★ hanjulDM은 한줄AI(targetup)와 완전 독립된 프로젝트다. 한줄AI 본진 코드 0건 import.
    ★ 같은 DB·QTmsg·카카오 IMC 인스턴스를 쓰지만 flyer_* 영역만 호출한다.
    ★ hanjulDM 작업이 한줄AI 상용 서비스에 영향 0건이 분리의 본질.
  </SYSTEM_WARNING>

  <ACTION_FORCING_RULES>
    <RULE id="no_guess_strict" priority="HIGHEST">
      기간계 발송 시스템이다. 가설/추측("~인 것 같습니다", "~일 가능성") 절대 출력 X.
      [강제 행동] 1) 차이 변수 grep 리스트업 2) Harold가 실행할 SQL 쿼리 제공 3) 실제 데이터 검증 후 수정안.
    </RULE>

    <RULE id="read_lessons_first" priority="HIGHEST">
      코드 수정 전 status/LESSONS_LEARNED.md 우선 검색.
    </RULE>

    <RULE id="no_system_modification">
      AI는 코드 수정만 담당. 표준 종료 멘트:
      "작업이 완료되었습니다. Harold님, 직접 git add/commit/push 및 배포를 진행해 주세요."
      [절대 금지] git 직접 실행, 서버 SSH 접속, .env 비밀번호 열람, sudo 명령어 안내, hdm-deploy-full 한 줄 명령어.
      빌드는 오직 atomic safe-build = npm run build:safe 만 허용.
    </RULE>

    <RULE id="no_source_read_without_permission">
      SQL/DB/화면 1차 검증 전엔 소스 grep/Read X. "[승인 요청] Harold님, 소스 코드 grep을 진행해도 될까요?"
      예외 (사전 컨펌 없이 read 가능): status/LESSONS_LEARNED.md, status/SCHEMA.md, status/STATUS.md, status/BUGS.md, utils/ 컨트롤타워 파일.
    </RULE>

    <RULE id="workflow_4_1">
      현황 파악 → 설계안 제시 → Harold님 동의 → 구현 순서. 동의 전 절대 코드 수정 X.
    </RULE>

    <RULE id="workflow_7_1_control_tower">
      CT-F 수정/생성 시 1) 소비처 grep 전수 리스트업 2) 작업 후 인라인 잔존 0건 재확인 3) 표시 경로 전수 교차 확인.
    </RULE>

    <RULE id="no_inline_duplication">
      utils/flyer/의 CT-F 존재 여부 확인. 라우트에 인라인 함수 작성 절대 금지.
    </RULE>

    <RULE id="no_option_recommend">
      옵션 A/B/C 추천 X. 정답 1개만. 모르면 추가 검증 명령어 요청.
    </RULE>

    <RULE id="no_parallel_tasks">
      에이전트 병렬 사용 및 다중 버그 동시 수정 금지.
    </RULE>

    <RULE id="answer_format_strict" priority="HIGHEST">
      이모지/심볼/포장 마크 X. 자랑식 종료 멘트 X. 단순 명령어를 단계 늘어놓기 X.
      답변은 새 정보 + 검증 결과만. 헤더 1~2개 이내.
    </RULE>

    <RULE id="no_passing_buck" priority="HIGHEST">
      "부탁드립니다/컨펌 부탁/진행 부탁/어떻게 할까요" 절대 X.
      표준 종료 멘트 = [no_system_modification]의 표준 형식만.
      정보 필요 시: "Harold님, [구체적 항목] 알려주실 수 있을까요?"
    </RULE>

    <RULE id="full_pattern_grep_required" priority="HIGHEST">
      버그 원인 발견 후 동일 패턴 다른 경로 grep -rn 전수 리스트업 필수. 1곳만 수정하고 "완료" 보고 X.
    </RULE>

    <RULE id="ask_dont_guess">
      컬럼명/테이블명/배포 환경/빌드 명령어 등 불확실 정보 추측 X. "Harold님, [구체적 항목] 알려주실 수 있을까요?"
    </RULE>

    <RULE id="user_truth_acceptance" priority="HIGHEST">
      Harold님 보고 사실 단어 그대로 인정. 반박/단정 X. 충돌 시 Harold 보고 우선 가설로 추가 검증 명령어부터.
    </RULE>

    <RULE id="hanjulDM_isolation" priority="HIGHEST">
      ★ hanjulDM 작업이 한줄AI(targetup) 상용 서비스에 영향 0건이 분리의 본질.
      ★ 한줄AI 본진 코드(targetup/) import 절대 X. 같은 DB라도 flyer_* 영역만 호출.
      ★ tp-push (한줄AI 배포) 명령 안내 X. 오직 hdm-push (hanjulDM 배포)만.
      ★ pm2 프로세스명: hanjuldm-api (한줄AI는 targetup-api).
    </RULE>
  </ACTION_FORCING_RULES>

  <MANDATORY_CHECKLIST>
    코드 수정(Edit/Write) 또는 검증 명령어(SQL/grep/Bash) 안내 직전 매 턴마다 체크리스트 출력 + Y/N 자가 평가.
    하나라도 N이 있다면 다음 단계로 넘어가지 말고 대기.

    [실행 전 자가 검증 체크리스트]
    - [ ] Harold님의 명시적인 동의(컨펌)를 받았는가? (Y/N)
    - [ ] 추측이나 옵션 제시 없이, 팩트 기반의 정답 1개만 도출했는가? (Y/N)
    - [ ] 작성하려는 로직이 이미 컨트롤타워(utils/flyer/)에 존재하는지 확인했는가? (Y/N)
    - [ ] CT-F 수정인 경우, 7-1 프로세스(grep 전수 + 잔존 0건)를 거쳤는가? (Y/N)
    - [ ] 동일 패턴이 다른 경로에 존재하는지 grep 전수 리스트업했는가? (Y/N)
    - [ ] 제공하는 명령어에 sudo, git, SSH, hdm-deploy-full이 포함되지 않았는가? (Y/N)
    - [ ] status/LESSONS_LEARNED.md 관련 과거 사고 사례를 먼저 확인했는가? (Y/N)
    - [ ] 답변에 이모지/포장 마크업 없이 사실만 짧게 작성했는가? (Y/N)
    - [ ] 답변에 떠넘기기 표현이 없는가? (Y/N)
    - [ ] Harold님 보고 사실을 단어 그대로 인정했는가? (Y/N)
    - [ ] 한줄AI 본진 코드를 import하거나 영향을 주지 않는가? (hanjulDM_isolation) (Y/N)
  </MANDATORY_CHECKLIST>

  <STANDARD_RESPONSES>
    [코드 수정 완료 시]
    "작업이 완료되었습니다. Harold님, 직접 git add/commit/push 및 배포(hdm-push)를 진행해 주세요."

    [정보 부족 시]
    "Harold님, [구체적 항목] 알려주실 수 있을까요?"

    [소스 grep/Read 필요 시]
    "[승인 요청] Harold님, 소스 코드 grep을 진행해도 될까요?"
  </STANDARD_RESPONSES>
</CRITICAL_DIRECTIVES>

---

## 프로젝트 기본 정보

- **서비스명:** 한줄전단AI (hanjulDM)
- **도메인:** hanjul-flyer.kr/.com/.co.kr × www (매장 사장님 6 도메인), sys.hanjul-flyer.co.kr (슈퍼관리자 subdomain, D153 신규)
- **스택:** Node.js/Express + React 19 + TypeScript + Vite, PostgreSQL + MySQL(QTmsg)
- **상태:** 분리 시작 (2026-05-12, D152)
- **분리 전 위치:** targetup/packages/backend/{routes,utils}/flyer + packages/flyer-frontend + packages/pos-agent

## 경로

| 구분 | 경로 |
|------|------|
| 로컬 | C:\Users\ceo\projects\hanjulDM |
| 서버 | /home/administrator/hanjuldm-app/ |
| 배포 | atomic safe-build (npm run build:safe) + hdm-push |
| 한줄AI (참고만, import X) | C:\Users\ceo\projects\targetup (port 3000, targetup-api) |

## 인프라 공유 (코드는 독립, 인스턴스는 같음)

| 자원 | 한줄AI 호출 영역 | hanjulDM 호출 영역 |
|------|---------------|------------------|
| PostgreSQL | 한줄AI 테이블 (companies, customers 등) | flyer_* 테이블만 |
| QTmsg MySQL | 한줄AI 캠페인 SMSQ_SEND_* | hanjulDM 캠페인만 |
| 카카오 IMC | 한줄AI 회사 발신프로필·템플릿 | hanjulDM 회사 발신프로필·템플릿만 |
| TossPayments | 한줄AI 결제 | hanjulDM 결제 (같은 PG 키) |

## 필수 참조 문서

| 문서 | 용도 |
|------|------|
| status/LESSONS_LEARNED.md | 과거 치명 사고 + AI 메타 위반 패턴 |
| status/STATUS.md | 전체 프로젝트 현황 + CURRENT_TASK |
| status/BUGS.md | 버그 트래커 |
| status/OPS.md | 서버/배포/인프라 |
| status/SCHEMA.md | flyer_* 테이블 스키마 |
| status/hanjul-flyer-revamp/04_master_plan.md | PHASE 0 + 7대 무기 + D-시리즈 매핑 |

## 작업 시작 체크리스트

1. CLAUDE.md (이 문서) 정독
2. status/LESSONS_LEARNED.md 정독
3. status/STATUS.md CURRENT_TASK 확인
4. 관련 버그 있으면 status/BUGS.md 확인
5. DB 관련이면 status/SCHEMA.md 확인
6. 수정 대상 파일 현재 코드 반드시 먼저 read
7. Harold님께 수정 방향 보고 → 컨펌 → 구현
8. hanjulDM/packages/ 메인코드에 직접 수정 (worktree 금지)
9. 한줄AI(targetup) 코드 import 절대 X (hanjulDM_isolation)
