/**
 * ★ POS DB 자동 감지 — 5단계
 *
 * 사장님 동의 한 번에 설치 완료가 본질.
 * 사장님이 DB 호스트/포트/계정/비번을 모르므로 Agent가 알아서 찾는다.
 *
 * 5단계:
 *  1. detectRunningProcesses     — tasklist로 mysqld/sqlservr/OKPOS exe 등 실행 프로세스 식별
 *  2. detectListeningPorts       — netstat으로 1433/3306/3050 listening 포트 식별
 *  3. detectPosInstallPaths      — 알려진 폴더 (C:\OKPOS\, C:\POSBank\, ...) 스캔
 *  4. parseConfigFileSignatures  — 설치 폴더 안 설정 파일에서 POS 종류 추론
 *  5. detectFromRegistry         — Windows 레지스트리 (HKLM\SOFTWARE\) POS 프로그램 흔적
 *
 * 5단계 결과를 통합 → POS 종류 + DB 후보 식별 → credential-discovery에 컨텍스트 전달.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { logger } from './logger';

// ============================================================
// 타입
// ============================================================

export interface PosDetectionResult {
  /** 감지된 POS 종류 (못 찾으면 'unknown') */
  posType: string;
  /** DB 엔진 후보 */
  dbCandidates: Array<{
    dbType: 'mssql' | 'mysql' | 'sqlite';
    host: string;
    port: number;
    source: 'process' | 'port' | 'registry';
  }>;
  /** POS 설치 폴더 */
  posInstallPaths: string[];
  /** 실행 중인 DB/POS 프로세스 이름 */
  runningProcesses: string[];
  /** Listening 포트 */
  listeningPorts: number[];
  /** 신뢰도 (0~100) */
  confidence: number;
  /** 디버깅 메타 */
  metadata: Record<string, any>;
}

// 알려진 POS 시그니처
interface PosSignature {
  name: string;
  installPathPatterns: string[];
  processPatterns: RegExp[];
  registryKeys: string[];
}

// ★ 우선순위 정정 (D159 정정, Harold 명시): 투게더스(Together's) 1순위 — MS-SQL Server 매장 관리 PC 박힘
//   Windows Authentication (Integrated Security) 박혀있을 가능성 높음 = 자격증명 추출 불필요
const POS_SIGNATURES: PosSignature[] = [
  {
    name: 'togethers',
    installPathPatterns: ['C:\\Together', 'C:\\TogetherPOS', 'C:\\Program Files\\Together', 'C:\\Program Files\\TogetherPOS', 'C:\\Program Files (x86)\\Together', 'C:\\Program Files (x86)\\TogetherPOS', 'D:\\Together', 'D:\\TogetherPOS'],
    processPatterns: [/together/i, /togethers/i],
    registryKeys: ['SOFTWARE\\Togethers', 'SOFTWARE\\WOW6432Node\\Togethers', 'SOFTWARE\\Together', 'SOFTWARE\\WOW6432Node\\Together'],
  },
  {
    name: 'okpos',
    installPathPatterns: ['C:\\OKPOS', 'C:\\Program Files\\OKPOS', 'C:\\Program Files (x86)\\OKPOS', 'D:\\OKPOS'],
    processPatterns: [/okpos/i, /ok_pos/i],
    registryKeys: ['SOFTWARE\\OKPOS', 'SOFTWARE\\WOW6432Node\\OKPOS'],
  },
  {
    name: 'posbank',
    installPathPatterns: ['C:\\POSBank', 'C:\\Program Files\\POSBank', 'C:\\Program Files (x86)\\POSBank'],
    processPatterns: [/posbank/i, /pos_bank/i],
    registryKeys: ['SOFTWARE\\POSBank', 'SOFTWARE\\WOW6432Node\\POSBank'],
  },
  {
    name: 'unipos',
    installPathPatterns: ['C:\\Unipos', 'C:\\Program Files\\Unipos'],
    processPatterns: [/unipos/i],
    registryKeys: ['SOFTWARE\\Unipos'],
  },
  {
    name: 'tomato',
    installPathPatterns: ['C:\\Tomato', 'C:\\Program Files\\Tomato'],
    processPatterns: [/tomato/i],
    registryKeys: ['SOFTWARE\\TomatoSystem'],
  },
  {
    name: 'smartro',
    installPathPatterns: ['C:\\Smartro', 'C:\\Program Files\\Smartro'],
    processPatterns: [/smartro/i],
    registryKeys: ['SOFTWARE\\Smartro'],
  },
  {
    name: 'cashnote',
    installPathPatterns: ['C:\\CashNote', 'C:\\Program Files\\CashNote'],
    processPatterns: [/cashnote/i, /cash_note/i],
    registryKeys: ['SOFTWARE\\CashNote'],
  },
  {
    name: 'samsung-sds',
    installPathPatterns: ['C:\\SamsungSDS', 'C:\\Program Files\\SamsungSDS', 'C:\\UniERP'],
    processPatterns: [/unierp/i, /sams.*sds/i],
    registryKeys: ['SOFTWARE\\SamsungSDS', 'SOFTWARE\\UniERP'],
  },
];

// ============================================================
// 1단계: 실행 프로세스 감지
// ============================================================

function detectRunningProcesses(): string[] {
  if (process.platform !== 'win32') {
    logger.debug('detectRunningProcesses: Windows 전용 — 스킵');
    return [];
  }

  try {
    // tasklist /FO CSV — 프로세스 목록
    const output = execSync('tasklist /FO CSV /NH', {
      encoding: 'utf-8',
      timeout: 5000,
      windowsHide: true,
    });

    const processes: string[] = [];
    const lines = output.split('\n');
    for (const line of lines) {
      const match = line.match(/^"([^"]+\.exe)"/i);
      if (match) processes.push(match[1].toLowerCase());
    }

    logger.debug(`프로세스 ${processes.length}개 감지`);
    return processes;
  } catch (err: any) {
    logger.warn(`tasklist 실행 실패: ${err.message}`);
    return [];
  }
}

// ============================================================
// 2단계: Listening 포트 감지
// ============================================================

function detectListeningPorts(): number[] {
  if (process.platform !== 'win32') {
    logger.debug('detectListeningPorts: Windows 전용 — 스킵');
    return [];
  }

  const TARGET_PORTS = [1433, 3306, 3050]; // MSSQL / MySQL / Firebird

  try {
    const output = execSync('netstat -ano', {
      encoding: 'utf-8',
      timeout: 5000,
      windowsHide: true,
    });

    const listening: Set<number> = new Set();
    const lines = output.split('\n');
    for (const line of lines) {
      // TCP    0.0.0.0:3306    0.0.0.0:0    LISTENING    1234
      const match = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING/i);
      if (match) {
        const port = parseInt(match[1]);
        if (TARGET_PORTS.includes(port)) listening.add(port);
      }
    }

    const result = Array.from(listening);
    logger.debug(`Listening 포트: ${result.join(', ') || '없음'}`);
    return result;
  } catch (err: any) {
    logger.warn(`netstat 실행 실패: ${err.message}`);
    return [];
  }
}

// ============================================================
// 3단계: POS 설치 폴더 스캔
// ============================================================

function detectPosInstallPaths(): { paths: string[]; matchedSignatures: string[] } {
  const paths: string[] = [];
  const matchedSignatures: string[] = [];

  for (const sig of POS_SIGNATURES) {
    for (const candidatePath of sig.installPathPatterns) {
      try {
        if (fs.existsSync(candidatePath)) {
          paths.push(candidatePath);
          if (!matchedSignatures.includes(sig.name)) matchedSignatures.push(sig.name);
        }
      } catch {
        // 권한 부족 등 무시
      }
    }
  }

  logger.debug(`POS 설치 폴더: ${paths.length}개, 매칭 시그니처: ${matchedSignatures.join(', ') || '없음'}`);
  return { paths, matchedSignatures };
}

// ============================================================
// 4단계: 설정 파일 시그니처 추론
// ============================================================

function parseConfigFileSignatures(installPaths: string[]): string[] {
  const signatures: string[] = [];

  for (const installPath of installPaths) {
    try {
      const files = collectFilesShallow(installPath, ['.ini', '.xml', '.config', '.json'], 2);

      for (const file of files) {
        const content = safeReadFile(file);
        if (!content) continue;

        // 각 POS 시그니처의 키워드 매칭
        for (const sig of POS_SIGNATURES) {
          if (signatures.includes(sig.name)) continue;
          if (new RegExp(sig.name, 'i').test(content)) {
            signatures.push(sig.name);
          }
        }
      }
    } catch {
      // 무시
    }
  }

  return signatures;
}

// ============================================================
// 5단계: 레지스트리 스캔
// ============================================================

function detectFromRegistry(): string[] {
  if (process.platform !== 'win32') return [];

  const matched: string[] = [];

  // ⚠️ winreg/reg-cli 의존성 박힌 후 본격 구현. 묶음 2에서 활성화.
  // 현재는 reg 명령어로 단순 존재 확인.
  for (const sig of POS_SIGNATURES) {
    for (const key of sig.registryKeys) {
      try {
        const output = execSync(`reg query "HKLM\\${key}" /ve`, {
          encoding: 'utf-8',
          timeout: 2000,
          windowsHide: true,
        });
        if (output && output.length > 0) {
          if (!matched.includes(sig.name)) matched.push(sig.name);
        }
      } catch {
        // 키 없음 — 정상
      }
    }
  }

  logger.debug(`레지스트리 매칭: ${matched.join(', ') || '없음'}`);
  return matched;
}

// ============================================================
// 통합 진입점
// ============================================================

export async function detectPosDb(): Promise<PosDetectionResult> {
  logger.info('POS DB 자동 감지 시작 (5단계)');

  // Step 1: 프로세스
  const processes = detectRunningProcesses();

  // Step 2: 포트
  const ports = detectListeningPorts();

  // Step 3: 설치 폴더
  const { paths: installPaths, matchedSignatures: pathSigs } = detectPosInstallPaths();

  // Step 4: 설정 파일 시그니처
  const configSigs = parseConfigFileSignatures(installPaths);

  // Step 5: 레지스트리
  const regSigs = detectFromRegistry();

  // 통합: 시그니처 매칭 우선순위 (path > config > registry)
  const allSigs = [...new Set([...pathSigs, ...configSigs, ...regSigs])];

  let posType = 'unknown';
  let confidence = 0;

  if (pathSigs.length === 1 && configSigs.includes(pathSigs[0])) {
    posType = pathSigs[0];
    confidence = 95;
  } else if (pathSigs.length === 1) {
    posType = pathSigs[0];
    confidence = 70;
  } else if (allSigs.length === 1) {
    posType = allSigs[0];
    confidence = 50;
  } else if (allSigs.length > 1) {
    // 가장 많이 매칭된 시그니처 선택
    posType = allSigs[0];
    confidence = 40;
    logger.warn(`다수 POS 시그니처 매칭 (${allSigs.join(', ')}) — confidence 낮음`);
  }

  // DB 후보 추출
  const dbCandidates: PosDetectionResult['dbCandidates'] = [];
  if (ports.includes(1433) || processes.some(p => /sqlservr/i.test(p))) {
    dbCandidates.push({ dbType: 'mssql', host: 'localhost', port: 1433, source: 'process' });
  }
  if (ports.includes(3306) || processes.some(p => /mysqld/i.test(p))) {
    dbCandidates.push({ dbType: 'mysql', host: 'localhost', port: 3306, source: 'process' });
  }
  if (ports.includes(3050) || processes.some(p => /fbserver/i.test(p))) {
    // Firebird는 dbType 'mysql' 아님. 현재는 mysql로 표기 후 묶음 2에서 firebird 정식 지원.
    logger.warn('Firebird 감지 — 묶음 2에서 정식 지원');
  }

  const result: PosDetectionResult = {
    posType,
    dbCandidates,
    posInstallPaths: installPaths,
    runningProcesses: processes.filter(p =>
      /mysqld|sqlservr|fbserver|okpos|posbank|together|unipos|tomato|smartro|cashnote/i.test(p)
    ),
    listeningPorts: ports,
    confidence,
    metadata: {
      allSignatures: allSigs,
      pathSignatures: pathSigs,
      configSignatures: configSigs,
      registrySignatures: regSigs,
    },
  };

  logger.info(`POS 감지 완료: type=${posType}, confidence=${confidence}%, DB후보=${dbCandidates.length}개`);
  return result;
}

// ============================================================
// 유틸
// ============================================================

function collectFilesShallow(dir: string, extensions: string[], maxDepth: number, currentDepth = 0): string[] {
  if (currentDepth > maxDepth) return [];

  const result: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        result.push(...collectFilesShallow(fullPath, extensions, maxDepth, currentDepth + 1));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.includes(ext)) result.push(fullPath);
      }
    }
  } catch {
    // 무시
  }
  return result;
}

function safeReadFile(filePath: string): string | null {
  try {
    const stats = fs.statSync(filePath);
    if (stats.size > 2 * 1024 * 1024) return null;
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}
