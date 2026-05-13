Unicode true

; ============================================================
; 한줄전단 POS Agent — NSIS 인스톨러 (V2)
; ============================================================
;
; 작성: 2026-05-14 (D159)
; 기준: sync-agent 1.5.4 NSIS 패턴 미러
;
; 빌드: npm run build:installer (NSIS 3.x 필수)
;       또는 직접: makensis.exe installer.nsi
;
; 출력: Setup-1.0.0.exe (~25MB)
;
; 설치 위치: $PROGRAMFILES64\HanjulPosAgent
; 자동 가동: HKCU\...\Run (사용자 시작 항목) — 권장
; 서비스 가동: sc.exe create (옵션, 관리자 권한 필요)
; ============================================================

!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"

; ============================================================
; 기본 정보
; ============================================================

!define APP_NAME       "한줄전단 POS Agent"
!define APP_VERSION    "1.0.0"
!define COMPANY        "한줄전단AI"
!define PUBLISHER      "hanjul-flyer.kr"
!define EXE_NAME       "hanjul-pos-agent.exe"
!define UNINSTALL_KEY  "Software\Microsoft\Windows\CurrentVersion\Uninstall\HanjulPosAgent"
!define AUTOSTART_KEY  "Software\Microsoft\Windows\CurrentVersion\Run"
!define SERVICE_NAME   "HanjulPosAgent"

Name "${APP_NAME} v${APP_VERSION}"
OutFile "..\build\Setup-${APP_VERSION}.exe"
InstallDir "$PROGRAMFILES64\HanjulPosAgent"
InstallDirRegKey HKLM "${UNINSTALL_KEY}" "InstallDir"
RequestExecutionLevel admin
ShowInstDetails show
ShowUnInstDetails show

; 압축
SetCompressor /SOLID lzma

; ============================================================
; UI 설정 — assets/icon.ico, header.bmp, welcome.bmp 박히면 활성화
; (현재 placeholder 박힘 — 별도 디자인 작업 후 활성화)
; ============================================================

!define MUI_ABORTWARNING
; !define MUI_ICON "..\assets\icon.ico"
; !define MUI_UNICON "..\assets\icon.ico"
; !define MUI_HEADERIMAGE
; !define MUI_HEADERIMAGE_BITMAP "..\assets\header.bmp"
; !define MUI_HEADERIMAGE_RIGHT
; !define MUI_WELCOMEFINISHPAGE_BITMAP "..\assets\welcome.bmp"

; ============================================================
; 페이지
; ============================================================

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "..\build\LICENSE-DATA-POLICY.txt"
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES

; 완료 페이지 — Agent 즉시 시작 옵션
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE_NAME}"
!define MUI_FINISHPAGE_RUN_TEXT "POS Agent 즉시 시작 (설치 마법사 가동)"
!define MUI_FINISHPAGE_RUN_PARAMETERS "--setup"
!define MUI_FINISHPAGE_SHOWREADME "$INSTDIR\README.txt"
!define MUI_FINISHPAGE_SHOWREADME_TEXT "설치 가이드 보기"
!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_WELCOME
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

; ============================================================
; 언어
; ============================================================

!insertmacro MUI_LANGUAGE "Korean"

; ============================================================
; 컴포넌트 설명
; ============================================================

LangString DESC_SecAgent     ${LANG_KOREAN} "POS Agent 핵심 실행 파일 (필수)"
LangString DESC_SecAutoStart ${LANG_KOREAN} "Windows 로그인 시 자동 가동 (권장)"
LangString DESC_SecService   ${LANG_KOREAN} "Windows 서비스로 등록 — 로그아웃 후에도 백그라운드 가동 (관리자 권한 필요)"
LangString DESC_SecShortcut  ${LANG_KOREAN} "시작 메뉴 + 바탕화면 단축아이콘"

; ============================================================
; 섹션
; ============================================================

Section "Agent 본체 (필수)" SecAgent
  SectionIn RO

  SetOutPath "$INSTDIR"

  ; 모든 build/ 내용 복사
  File /r "..\build\*"

  ; 언인스톨러 생성
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; 레지스트리 — 제어판 프로그램 추가/제거 노출
  WriteRegStr HKLM "${UNINSTALL_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "Publisher" "${COMPANY}"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "URLInfoAbout" "https://${PUBLISHER}"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\${EXE_NAME}"
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "NoRepair" 1

  ; 설치 크기 (KB)
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "EstimatedSize" "$0"
SectionEnd

Section "사용자 시작 시 자동 가동 (권장)" SecAutoStart
  WriteRegStr HKCU "${AUTOSTART_KEY}" "HanjulPosAgent" "$INSTDIR\${EXE_NAME}"
  DetailPrint "Windows 로그인 시 자동 가동 박힘"
SectionEnd

Section /o "Windows 서비스 등록" SecService
  ; sc.exe로 서비스 등록 (관리자 권한 필요)
  DetailPrint "Windows 서비스 등록 시도..."
  nsExec::ExecToLog 'sc.exe create "${SERVICE_NAME}" binPath= "$INSTDIR\${EXE_NAME}" start= auto DisplayName= "${APP_NAME}"'
  Pop $0
  ${If} $0 == 0
    nsExec::ExecToLog 'sc.exe description "${SERVICE_NAME}" "매장 POS 데이터 자동 수집"'
    nsExec::ExecToLog 'sc.exe failure "${SERVICE_NAME}" reset= 86400 actions= restart/60000/restart/60000/restart/60000'
    DetailPrint "Windows 서비스 등록 완료"
  ${Else}
    DetailPrint "Windows 서비스 등록 실패 (코드: $0) — 사용자 시작 모드로 가동"
  ${EndIf}
SectionEnd

Section "시작 메뉴 단축아이콘" SecShortcut
  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\${EXE_NAME}" "" "$INSTDIR\${EXE_NAME}" 0
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\설정 마법사.lnk" "$INSTDIR\${EXE_NAME}" "--setup" "$INSTDIR\${EXE_NAME}" 0
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\로그 폴더.lnk" "$INSTDIR\logs" "" "" 0
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\제거.lnk" "$INSTDIR\Uninstall.exe"
SectionEnd

; ============================================================
; 컴포넌트 설명 매핑
; ============================================================

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecAgent}     $(DESC_SecAgent)
  !insertmacro MUI_DESCRIPTION_TEXT ${SecAutoStart} $(DESC_SecAutoStart)
  !insertmacro MUI_DESCRIPTION_TEXT ${SecService}   $(DESC_SecService)
  !insertmacro MUI_DESCRIPTION_TEXT ${SecShortcut}  $(DESC_SecShortcut)
!insertmacro MUI_FUNCTION_DESCRIPTION_END

; ============================================================
; 언인스톨러
; ============================================================

Section "Uninstall"
  ; 1. 서비스 해제 (있으면)
  DetailPrint "Windows 서비스 해제..."
  nsExec::ExecToLog 'sc.exe stop "${SERVICE_NAME}"'
  nsExec::ExecToLog 'sc.exe delete "${SERVICE_NAME}"'

  ; 2. 자동 시작 해제
  DeleteRegValue HKCU "${AUTOSTART_KEY}" "HanjulPosAgent"

  ; 3. Agent 프로세스 종료
  DetailPrint "Agent 프로세스 종료..."
  nsExec::ExecToLog 'taskkill /F /IM ${EXE_NAME}'

  ; 4. 파일 + 폴더 삭제
  Delete "$INSTDIR\${EXE_NAME}"
  Delete "$INSTDIR\Uninstall.exe"
  Delete "$INSTDIR\*.node"
  Delete "$INSTDIR\*.exe"
  Delete "$INSTDIR\*.json"
  Delete "$INSTDIR\*.txt"
  Delete "$INSTDIR\*.bat"
  RMDir /r "$INSTDIR\assets"
  RMDir /r "$INSTDIR\scripts"
  RMDir /r "$INSTDIR\logs"
  RMDir "$INSTDIR"

  ; 5. 시작 메뉴 삭제
  RMDir /r "$SMPROGRAMS\${APP_NAME}"

  ; 6. 레지스트리 정리
  DeleteRegKey HKLM "${UNINSTALL_KEY}"

  DetailPrint "한줄전단 POS Agent 제거 완료"
SectionEnd
