# 한줄전단 POS Agent — 빌드 & 배포 가이드

> **버전:** v1.0.0 (D159, 2026-05-14)
> **타겟:** Windows x64 (매장 사무실 PC = MySQL 서버 PC)

---

## 빌드 흐름 (개발자/주인님)

### 사전 요건

1. **Node.js 18+** (pkg가 node18 타겟 빌드)
2. **NSIS 3.x** — https://nsis.sourceforge.io/Download
   - 기본 경로: `C:\Program Files (x86)\NSIS\makensis.exe`
   - 다른 경로: `$env:NSIS_PATH="C:\path\to\makensis.exe"`
3. **트레이 아이콘 .ico 4종** (`assets/icon-green.ico`, `icon-yellow.ico`, `icon-red.ico`, `icon-gray.ico`)
   - **현재 placeholder 박힘** — 별도 디자인 작업으로 박음
4. **NSIS 이미지 .bmp 2종** (`assets/header.bmp`, `welcome.bmp`)
   - 옵션 — 없으면 NSIS 기본 사용

### 빌드 명령

```powershell
cd C:\Users\ceo\projects\hanjulDM\packages\pos-agent

# 1. 의존성 설치
npm install

# 2. tsc + pkg + native 모듈 복사
npm run build:exe
# 결과: build/hanjul-pos-agent.exe (~25MB)

# 3. NSIS 인스톨러 빌드
npm run build:installer
# 결과: build/Setup-1.0.0.exe (~30MB)

# 한 번에:
npm run build:all
```

---

## 설치 흐름 (매장 사장님)

### 표준 설치 (사용자 모드, 권장)

1. 슈퍼관리자가 `Setup-1.0.0.exe` + `agent_key (FPA-XXXXXXXX...)` 전달
2. 매장 사장님이 `Setup-1.0.0.exe` 더블클릭
3. 약관 동의 → 설치 위치 (기본 `C:\Program Files\HanjulPosAgent`)
4. 컴포넌트 선택:
   - ✓ Agent 본체 (필수)
   - ✓ 사용자 시작 시 자동 가동 (권장)
   - ☐ Windows 서비스 등록 (선택, 관리자 권한 필요)
   - ✓ 시작 메뉴 단축아이콘
5. 설치 완료 → "POS Agent 즉시 시작" 체크박스 → 설치 마법사 자동 가동
6. 마법사 입력:
   - Agent Key (FPA-XXXXXXXX-XXXXXXXX)
   - POS DB 종류 (MS-SQL / MySQL / SQLite)
   - DB 호스트/포트/계정/비번
     - **V2: 비번 비어있으면 Credential Discovery 7 어댑터 자동 시도**
7. 연결 테스트 통과 → 트레이 아이콘 상주 (녹색 = 정상)

### Windows 서비스 설치 (백그라운드 가동, 로그아웃 후에도)

- 설치 시 "Windows 서비스 등록" 체크
- 또는 수동: `npm run service:install` (관리자 PowerShell)
- 해제: `npm run service:uninstall` (관리자 PowerShell)
- 단점: 서비스 모드는 트레이 UI 없음 (UI 세션 X)

---

## 자동 업데이트 (v1.0.0 → v1.1.0+)

### 슈퍼관리자가 새 .exe 배포

1. `npm run build:all` 로 신규 `Setup-1.1.0.exe` 빌드
2. 출력된 SHA-256 + 파일 크기 확인
3. 서버에 `.exe` 업로드:
   ```
   scp build/Setup-1.1.0.exe administrator@hanjul-flyer.kr:/home/administrator/hanjuldm-app/downloads/
   ```
4. PostgreSQL에 신규 버전 박음 (스크립트가 SQL 출력해 줌):
   ```sql
   INSERT INTO flyer_settings (setting_key, setting_value)
   VALUES ('latest_pos_agent_version', '{
     "latestVersion": "1.1.0",
     "downloadUrl": "https://hanjul-flyer.kr/downloads/Setup-1.1.0.exe",
     "checksum": "<sha256>",
     "fileSize": <bytes>,
     "releaseNotes": "v1.1.0 — ...",
     "mandatory": false
   }')
   ON CONFLICT (setting_key) DO UPDATE SET
     setting_value = EXCLUDED.setting_value,
     updated_at = NOW();
   ```
5. Agent가 1시간 주기로 자동 체크 → 새벽 2~5시에 자동 업데이트 (mandatory=false)
6. mandatory=true 박으면 즉시 업데이트

### 매장 사장님 입장

- 트레이 알림 "업데이트 가동 중" 1회 표시
- 약 5초 후 새 .exe로 자동 재가동
- 다운타임 0

### 롤백

- 새 .exe 가동 후 60초 안에 heartbeat 실패 시 update.bat이 `.old` → `.exe` 복구
- 슈퍼관리자에서 REVOKE 명령 발행 시 Agent 자살 + agent_key wipe

---

## 슈퍼관리자 양방향 명령

`sys.hanjul-flyer.co.kr` 슈퍼관리자 → POS Agent 탭 → 명령 발행:

| 명령 | 효과 |
|------|------|
| FORCE_SYNC | 즉시 강제 싱크 (1초 이내) |
| RESEND_SCHEMA | 스키마 재읽기 + 서버 재분석 |
| FETCH_LOGS | 최근 로그 200줄 가져오기 |
| REVOKE | Agent 자살 (config.agentKey wipe + 종료) |
| UPDATE | 자동 업데이트 트리거 (mandatory=true와 동일) |
| DIAGNOSE_MASK_BYPASS | 마스킹 우회 진단 (DIRECT_SQL/BACKUP_FILE/UI_AUTOMATION 가능 여부) |

---

## 파일 구조 (설치 후)

```
C:\Program Files\HanjulPosAgent\
├── hanjul-pos-agent.exe       # 메인 실행 파일
├── hanjul-pos-agent.old.exe   # 자동 업데이트 시 자동 백업 (롤백용)
├── better_sqlite3.node        # SQLite native (local-cache 의존)
├── tray_windows.exe           # systray2 helper
├── agent-config.json          # 매장 설정 (Agent Key + DB 정보)
├── pos-cache.sqlite           # 로컬 큐 (sales/members/inventory 멱등)
├── update.bat                 # 자동 업데이트 임시 스크립트 (가동 시만)
├── Uninstall.exe              # 언인스톨러
├── README.txt                 # 설치 가이드
├── LICENSE-DATA-POLICY.txt    # 약관
├── assets\
│   ├── icon.ico
│   ├── icon-green.ico
│   ├── icon-yellow.ico
│   ├── icon-red.ico
│   └── icon-gray.ico
├── scripts\
│   ├── install-service.js
│   └── uninstall-service.js
└── logs\
    └── agent-{날짜}.log       # 일자별 로그 (5MB 초과 시 자동 rotation)
```

---

## 문제 해결

### Agent가 시작되지 않음
1. `agent-config.json` 확인 (agentKey + DB 정보)
2. `logs\agent-{날짜}.log` 정독
3. 트레이에서 "강제 싱크" → 에러 메시지 확인

### DB 연결 실패
1. POS DB 서비스 가동 중 확인 (`netstat -ano | findstr 3306`)
2. `agent-config.json` db.password 정확 입력
3. **V2: 비번 비우고 재시작 → Credential Discovery 7 어댑터 자동 시도**

### 마스킹된 phone (010-**95-8517 등)
1. 트레이 → 강제 싱크 → 로그 "DIRECT_SQL: DB phone 마스킹 발견" 확인
2. 슈퍼관리자가 DIAGNOSE_MASK_BYPASS 명령 발행 → 진단 결과 확인
3. 권장 전략에 따라:
   - BACKUP_FILE 가능: 백업 파일 경로 자동 발견, 다음 cron 사이클에 자동 추출
   - UI_AUTOMATION 가능: 새벽 2~5시 자동 가동 (어댑터 박힌 POS만)
   - 모두 불가: 사장님에게 POS 비번 입력 안내 (Plan Z)

### 자동 업데이트 실패
1. `logs\agent-{날짜}.log` "auto-updater" 검색
2. checksum 불일치 시 → 슈퍼관리자가 SQL의 checksum 재확인
3. 60초 내 heartbeat 실패 시 자동 롤백 → 옛 .exe 복구

---

## 보안

- HTTPS 필수 (TLS 1.2+)
- agent_key 발급 = 슈퍼관리자만
- agent_key 유출 시 슈퍼관리자에서 REVOKE → Agent 자살 + config wipe
- POS DB SELECT 권한만 (INSERT/UPDATE/DELETE 절대 금지)
- 주민번호/카드번호 자동 마스킹 (`schema-reader.ts collectSamples`)
- 약관 명시: 데이터 소유권 사장님, POS 업체 X
