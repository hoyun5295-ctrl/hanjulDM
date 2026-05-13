/**
 * ★ Windows 시스템 트레이 UI
 *
 * 매장 사장님이 Agent 가동 상태를 한 눈에 인지하도록 트레이 아이콘 상주.
 * systray2 라이브러리 (cross-platform native binary, Windows 검증됨).
 *
 * 트레이 아이콘 상태:
 *  - 녹색  = 정상 (연결됨 + 최근 싱크 5분 이내)
 *  - 노란색 = 경고 (연결됨 + 싱크 30분 이상 지연 OR 대기 큐 100건+)
 *  - 빨간색 = 장애 (DB 연결 끊김 OR 서버 연결 끊김 OR 24h 에러 5건+)
 *  - 회색  = 초기화 중
 *
 * 메뉴 항목:
 *  1. 상태 표시 (disabled, 클릭 불가) — "✅ 연결됨 / 마지막 싱크: 2분 전 / 대기: 0건"
 *  2. POS 종류 표시 (disabled) — "POS: OKPOS / 매장: ○○마트"
 *  3. ── 구분선
 *  4. 강제 싱크 (콜백)
 *  5. 로그 폴더 열기 (Windows Explorer)
 *  6. 설정 파일 열기 (메모장)
 *  7. ── 구분선
 *  8. 한줄전단 대시보드 열기 (브라우저)
 *  9. 종료
 *
 * ⚠️ pkg 빌드 시 systray2 native binary 포함 — scripts/copy-native.js에서 처리.
 * ⚠️ Windows 서비스로 가동 시 트레이 미표시 (UI 세션 X). 묶음 3 NSIS에서 user-mode 옵션 박음.
 */

import path from 'path';
import fs from 'fs';
import { execSync, spawn } from 'child_process';
import { logger } from './logger';
import { getConfig } from './config';
import { isConnected } from './db-connector';
import { getCacheStats } from './local-cache';

// ============================================================
// 타입
// ============================================================

export type ConnectionStatus = 'init' | 'connected' | 'disconnected' | 'syncing' | 'error';

export interface TrayState {
  connectionStatus: ConnectionStatus;
  lastSyncAt: string | null;
  pendingCount: number;
  errorCount24h: number;
  posType: string;
  storeName: string;
  schemaMappingConfidence: number;
}

export interface TrayCallbacks {
  /** 강제 싱크 트리거 (scheduler.ts에서 박음) */
  onForceSync?: () => Promise<void>;
  /** 설정 마법사 재실행 (--setup 옵션) */
  onReconfigure?: () => void;
  /** Agent 종료 (graceful shutdown) */
  onQuit?: () => Promise<void>;
}

// ============================================================
// 내부 상태
// ============================================================

let systray: any = null;
let callbacks: TrayCallbacks = {};
let state: TrayState = {
  connectionStatus: 'init',
  lastSyncAt: null,
  pendingCount: 0,
  errorCount24h: 0,
  posType: 'unknown',
  storeName: '',
  schemaMappingConfidence: 0,
};

let menuItems: any[] = [];
let pollingTimer: NodeJS.Timeout | null = null;

// ============================================================
// 아이콘 (base64 placeholder — 실 ICO는 묶음 3 NSIS에서 assets/icon.ico 박힘)
// ============================================================

const TRAY_ICON_PATHS = {
  green: path.join(__dirname, '..', 'assets', 'icon-green.ico'),
  yellow: path.join(__dirname, '..', 'assets', 'icon-yellow.ico'),
  red: path.join(__dirname, '..', 'assets', 'icon-red.ico'),
  gray: path.join(__dirname, '..', 'assets', 'icon-gray.ico'),
};

const FALLBACK_ICON_BASE64 = 'AAABAAEAEBAAAAEAIABoBAAAFgAAACgAAAAQAAAAIAAAAAEAIAAAAAAAQAQAAAAAAAAAAAAAAAAAAAAAAAA='; // 16x16 transparent

function resolveIconForStatus(status: ConnectionStatus): string {
  let candidatePath = '';
  if (status === 'connected') candidatePath = TRAY_ICON_PATHS.green;
  else if (status === 'syncing') candidatePath = TRAY_ICON_PATHS.green;
  else if (status === 'error' || status === 'disconnected') candidatePath = TRAY_ICON_PATHS.red;
  else candidatePath = TRAY_ICON_PATHS.gray;

  // ICO 파일 없으면 fallback base64
  if (candidatePath && fs.existsSync(candidatePath)) {
    try {
      return fs.readFileSync(candidatePath).toString('base64');
    } catch {
      // 무시
    }
  }
  return FALLBACK_ICON_BASE64;
}

// ============================================================
// 메뉴 빌드
// ============================================================

const MENU_INDEX = {
  STATUS: 0,
  POS_INFO: 1,
  // SEPARATOR
  FORCE_SYNC: 3,
  OPEN_LOGS: 4,
  OPEN_CONFIG: 5,
  // SEPARATOR
  OPEN_DASHBOARD: 7,
  QUIT: 8,
};

function formatRelativeTime(iso: string | null): string {
  if (!iso) return '없음';
  try {
    const diffMs = Date.now() - new Date(iso).getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return '방금';
    if (diffMin < 60) return `${diffMin}분 전`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}시간 전`;
    return `${Math.floor(diffHour / 24)}일 전`;
  } catch {
    return '불명';
  }
}

function buildStatusLabel(): string {
  const map: Record<ConnectionStatus, string> = {
    init: '⏳ 초기화 중',
    connected: '✅ 연결됨',
    syncing: '🔄 싱크 중',
    disconnected: '❌ 연결 끊김',
    error: '⚠️ 장애',
  };
  const head = map[state.connectionStatus] || '?';
  const lastSync = formatRelativeTime(state.lastSyncAt);
  return `${head} (싱크: ${lastSync}, 대기: ${state.pendingCount}건)`;
}

function buildPosInfoLabel(): string {
  const pos = state.posType !== 'unknown' ? state.posType.toUpperCase() : '감지 중';
  const store = state.storeName || '확인 중';
  return `POS: ${pos} / 매장: ${store}`;
}

function buildMenu() {
  return {
    icon: resolveIconForStatus(state.connectionStatus),
    title: '한줄전단 POS Agent',
    tooltip: buildStatusLabel(),
    items: [
      // 0: 상태
      { title: buildStatusLabel(), tooltip: '현재 Agent 가동 상태', checked: false, enabled: false },
      // 1: POS 정보
      { title: buildPosInfoLabel(), tooltip: '감지된 POS 종류와 매장명', checked: false, enabled: false },
      // 2: 구분선
      SEPARATOR_ITEM,
      // 3: 강제 싱크
      { title: '지금 강제 싱크', tooltip: '판매/회원/재고 데이터 즉시 추출 + 푸시', checked: false, enabled: true },
      // 4: 로그 폴더 열기
      { title: '로그 폴더 열기', tooltip: 'agent-{날짜}.log 파일이 들어있는 폴더', checked: false, enabled: true },
      // 5: 설정 파일 열기
      { title: '설정 파일 열기', tooltip: 'agent-config.json (메모장으로 열림)', checked: false, enabled: true },
      // 6: 구분선
      SEPARATOR_ITEM,
      // 7: 대시보드 열기
      { title: '한줄전단 대시보드 열기', tooltip: '브라우저로 매장 사장님 페이지 열기', checked: false, enabled: true },
      // 8: 종료
      { title: '종료', tooltip: 'POS Agent 안전 종료 (대기 큐 자동 저장)', checked: false, enabled: true },
    ],
  };
}

const SEPARATOR_ITEM = { title: '<SEPARATOR>', tooltip: '', checked: false, enabled: false };

// ============================================================
// 트레이 시작
// ============================================================

export async function startTray(initialCallbacks: TrayCallbacks): Promise<boolean> {
  if (systray) {
    logger.warn('Tray가 이미 가동 중');
    return true;
  }

  callbacks = initialCallbacks;

  try {
    // ⚠️ systray2는 native binary 필요 — pkg 빌드 시 scripts/copy-native.js에서 처리.
    // 런타임 동적 require (개발 환경에서 systray2 미설치 시 graceful skip).
    let SysTray: any;
    try {
      SysTray = require('systray2').default || require('systray2');
    } catch (err: any) {
      logger.warn(`systray2 모듈 미로드 — 트레이 UI 없이 가동: ${err.message}`);
      return false;
    }

    const menu = buildMenu();
    menuItems = menu.items;

    systray = new SysTray({
      menu,
      debug: false,
      copyDir: false,
    });

    // 클릭 이벤트 등록
    systray.onClick(async (action: any) => {
      const idx = action.seq_id;
      try {
        if (idx === MENU_INDEX.FORCE_SYNC) await handleForceSync();
        else if (idx === MENU_INDEX.OPEN_LOGS) handleOpenLogs();
        else if (idx === MENU_INDEX.OPEN_CONFIG) handleOpenConfig();
        else if (idx === MENU_INDEX.OPEN_DASHBOARD) handleOpenDashboard();
        else if (idx === MENU_INDEX.QUIT) await handleQuit();
      } catch (err: any) {
        logger.error(`트레이 클릭 처리 실패 (idx=${idx}): ${err.message}`);
      }
    });

    // systray2 자체 종료 이벤트
    systray.onExit(() => {
      logger.info('트레이 종료 신호 수신');
      systray = null;
      stopPolling();
    });

    logger.info('Windows 트레이 UI 가동');

    // 5초마다 상태 폴링 (DB/캐시/싱크 상태 자동 반영)
    startPolling();

    return true;
  } catch (err: any) {
    logger.error(`트레이 시작 실패: ${err.message}`);
    systray = null;
    return false;
  }
}

// ============================================================
// 클릭 핸들러
// ============================================================

async function handleForceSync(): Promise<void> {
  if (!callbacks.onForceSync) {
    logger.warn('강제 싱크 콜백 미박힘');
    showBalloon('강제 싱크 미가용', '스케줄러가 아직 가동되지 않았습니다.');
    return;
  }

  showBalloon('강제 싱크 시작', '판매/회원/재고 데이터를 즉시 추출합니다.');
  state.connectionStatus = 'syncing';
  await refreshTrayState();

  try {
    await callbacks.onForceSync();
    showBalloon('강제 싱크 완료', `대기: ${state.pendingCount}건`);
  } catch (err: any) {
    logger.error(`강제 싱크 실패: ${err.message}`);
    showBalloon('강제 싱크 실패', err.message);
  }
}

function handleOpenLogs(): void {
  const logDir = path.join(process.cwd(), 'logs');
  try {
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    if (process.platform === 'win32') {
      spawn('explorer.exe', [logDir], { detached: true, stdio: 'ignore' }).unref();
    } else {
      logger.warn('로그 폴더 열기는 Windows 전용');
    }
  } catch (err: any) {
    logger.error(`로그 폴더 열기 실패: ${err.message}`);
  }
}

function handleOpenConfig(): void {
  const configPath = path.join(process.cwd(), 'agent-config.json');
  try {
    if (!fs.existsSync(configPath)) {
      showBalloon('설정 파일 없음', '설치 마법사를 먼저 실행하세요 (--setup 옵션).');
      return;
    }
    if (process.platform === 'win32') {
      spawn('notepad.exe', [configPath], { detached: true, stdio: 'ignore' }).unref();
    } else {
      logger.warn('설정 파일 열기는 Windows 전용 (notepad)');
    }
  } catch (err: any) {
    logger.error(`설정 파일 열기 실패: ${err.message}`);
  }
}

function handleOpenDashboard(): void {
  const url = `${getConfig().serverUrl}/dashboard`;
  try {
    if (process.platform === 'win32') {
      spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      logger.warn('브라우저 열기는 Windows 전용');
    }
  } catch (err: any) {
    logger.error(`대시보드 열기 실패: ${err.message}`);
  }
}

async function handleQuit(): Promise<void> {
  logger.info('트레이에서 종료 요청 수신');
  showBalloon('종료 중', '대기 큐를 저장하고 안전 종료합니다.');

  try {
    if (callbacks.onQuit) await callbacks.onQuit();
  } catch (err: any) {
    logger.error(`종료 콜백 실패: ${err.message}`);
  }

  await stopTray();
  process.exit(0);
}

// ============================================================
// 상태 업데이트
// ============================================================

export function updateConnectionStatus(status: ConnectionStatus): void {
  state.connectionStatus = status;
  void refreshTrayState();
}

export function updateLastSync(iso: string): void {
  state.lastSyncAt = iso;
  void refreshTrayState();
}

export function updatePosInfo(posType: string, storeName: string, confidence: number): void {
  state.posType = posType;
  state.storeName = storeName;
  state.schemaMappingConfidence = confidence;
  void refreshTrayState();
}

export function getTrayState(): TrayState {
  return { ...state };
}

async function refreshTrayState(): Promise<void> {
  if (!systray) return;

  // 캐시 상태 반영
  try {
    const cacheStats = getCacheStats();
    state.pendingCount = cacheStats.totalPending;
    state.errorCount24h = cacheStats.syncLog24h.failure;
  } catch {
    // local-cache 미초기화 시 무시
  }

  // 연결 상태 자동 추론
  if (state.connectionStatus !== 'syncing') {
    if (isConnected()) {
      state.connectionStatus = state.errorCount24h >= 5 ? 'error' : 'connected';
    } else {
      state.connectionStatus = 'disconnected';
    }
  }

  // 메뉴 라벨 업데이트
  try {
    const newMenu = buildMenu();
    systray.sendAction({
      type: 'update-item',
      item: { ...menuItems[MENU_INDEX.STATUS], title: newMenu.items[MENU_INDEX.STATUS].title },
      seq_id: MENU_INDEX.STATUS,
    });
    systray.sendAction({
      type: 'update-item',
      item: { ...menuItems[MENU_INDEX.POS_INFO], title: newMenu.items[MENU_INDEX.POS_INFO].title },
      seq_id: MENU_INDEX.POS_INFO,
    });

    // 아이콘 변경 (상태에 따라)
    systray.sendAction({
      type: 'update-menu',
      menu: newMenu,
    });
  } catch (err: any) {
    logger.debug(`트레이 갱신 실패: ${err.message}`);
  }
}

// ============================================================
// 폴링 (5초마다 상태 갱신)
// ============================================================

function startPolling(): void {
  if (pollingTimer) return;
  pollingTimer = setInterval(() => {
    void refreshTrayState();
  }, 5000);
}

function stopPolling(): void {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}

// ============================================================
// 알림 (Balloon Notification)
// ============================================================

export function showBalloon(title: string, message: string): void {
  if (process.platform !== 'win32') {
    logger.info(`[알림] ${title}: ${message}`);
    return;
  }

  try {
    // PowerShell BurntToast 또는 기본 알림 (BurntToast 미설치 시 fallback)
    const psScript = `
      [System.Reflection.Assembly]::LoadWithPartialName("System.Windows.Forms") | Out-Null
      $notify = New-Object System.Windows.Forms.NotifyIcon
      $notify.Icon = [System.Drawing.SystemIcons]::Information
      $notify.BalloonTipTitle = "${title.replace(/"/g, '\\"')}"
      $notify.BalloonTipText = "${message.replace(/"/g, '\\"')}"
      $notify.Visible = $true
      $notify.ShowBalloonTip(3000)
      Start-Sleep -Seconds 4
      $notify.Dispose()
    `;

    spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', psScript], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
  } catch (err: any) {
    logger.debug(`Balloon 알림 실패: ${err.message}`);
  }
}

// ============================================================
// 종료
// ============================================================

export async function stopTray(): Promise<void> {
  stopPolling();

  if (systray) {
    try {
      await systray.kill();
    } catch (err: any) {
      logger.debug(`트레이 kill 실패: ${err.message}`);
    }
    systray = null;
    logger.info('트레이 종료');
  }
}

// ============================================================
// SIGINT/SIGTERM 자동 처리
// ============================================================

process.on('SIGINT', () => { void stopTray(); });
process.on('SIGTERM', () => { void stopTray(); });
