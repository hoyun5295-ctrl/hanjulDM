/**
 * ★ Credential Discovery — POS DB 자격증명 자동 발견
 *
 * 본질: POS 업체 협조 0%로 매장 사장님 PC에 박혀 있는 자격증명을 합법 발견.
 * "크롤의 변형" = 해킹 X, 사장님 동의 하에 자기 데이터 접근.
 *
 * 7 어댑터 순차 시도:
 *  A. configFile      — POS 클라이언트 설정 파일(.ini/.xml/.json/.config) 평문/암호화 자격증명
 *  B. odbcDsn         — Windows ODBC 데이터 원본 (HKLM\SOFTWARE\ODBC\ODBC.INI)
 *  C. mysqlIni        — MySQL my.ini의 init-file/password 흔적
 *  D. dataFileMount   — MySQL/MSSQL 데이터 파일 사본 → 별도 인스턴스로 마운트 (인증 우회)
 *  E. backupFile      — POS 자동 백업 .sql/.bak 정기 생성 파일
 *  F. memoryDump      — 실행 중 POS 클라이언트 프로세스 메모리에서 자격증명 추출 (마지막 수단)
 *  G. aiInference     — 위 모두 실패 시 LLM에게 설정 파일 통째로 던져 자격증명 추론
 *
 * 합법성 안전망: 매장 사장님 명시 동의 + 자기 PC + 자기 데이터 + SELECT 권한만.
 */

import fs from 'fs';
import path from 'path';
import { logger } from './logger';

// ============================================================
// 타입 정의
// ============================================================

export interface DiscoveredCredential {
  /** DB 엔진 */
  dbType: 'mssql' | 'mysql' | 'sqlite';
  host: string;
  port: number;
  database?: string;
  username?: string;
  password?: string;
  /** SQLite 전용 */
  filePath?: string;
  /** 자격증명 신뢰도 (0~100) */
  confidence: number;
  /** 발견 경로 (디버깅용) */
  source: CredentialSource;
  /** 추가 메타데이터 */
  metadata?: Record<string, any>;
}

export type CredentialSource =
  | 'configFile'
  | 'odbcDsn'
  | 'mysqlIni'
  | 'dataFileMount'
  | 'backupFile'
  | 'memoryDump'
  | 'aiInference';

export interface CredentialDiscoveryAdapter {
  name: CredentialSource;
  priority: number;            // 낮을수록 먼저 시도
  description: string;
  discover(context: DiscoveryContext): Promise<DiscoveredCredential[]>;
}

export interface DiscoveryContext {
  /** db-detector가 감지한 POS 종류 (모르면 'unknown') */
  posType: string;
  /** db-detector가 감지한 POS 설치 경로 */
  posInstallPaths: string[];
  /** db-detector가 감지한 DB 프로세스 목록 */
  runningProcesses: string[];
  /** db-detector가 감지한 listening 포트 */
  listeningPorts: number[];
}

// ============================================================
// Registry
// ============================================================

const adapters: CredentialDiscoveryAdapter[] = [];

export function registerAdapter(adapter: CredentialDiscoveryAdapter): void {
  if (adapters.some(a => a.name === adapter.name)) {
    logger.warn(`Credential Discovery 어댑터 중복 등록 무시: ${adapter.name}`);
    return;
  }
  adapters.push(adapter);
  adapters.sort((a, b) => a.priority - b.priority);
  logger.info(`Credential Discovery 어댑터 등록: ${adapter.name} (priority ${adapter.priority})`);
}

export function listAdapters(): Array<{ name: string; priority: number; description: string }> {
  return adapters.map(a => ({ name: a.name, priority: a.priority, description: a.description }));
}

// ============================================================
// A. configFile — POS 클라이언트 설정 파일 스캔
// ============================================================

const configFileAdapter: CredentialDiscoveryAdapter = {
  name: 'configFile',
  priority: 10,
  description: 'POS 클라이언트 설정 파일(.ini/.xml/.json/.config) 평문/암호화 자격증명',

  async discover(ctx: DiscoveryContext): Promise<DiscoveredCredential[]> {
    const results: DiscoveredCredential[] = [];
    const extensions = ['.ini', '.xml', '.json', '.config', '.cfg', '.conf'];

    for (const installPath of ctx.posInstallPaths) {
      if (!fs.existsSync(installPath)) continue;

      try {
        const files = collectFilesRecursive(installPath, extensions, 3); // 최대 3 depth

        for (const file of files) {
          const content = safeReadFile(file);
          if (!content) continue;

          const found = parseCredentialFromText(content, ctx.posType);
          if (found.length > 0) {
            for (const cred of found) {
              results.push({
                ...cred,
                source: 'configFile',
                metadata: { filePath: file },
              });
            }
          }
        }
      } catch (err: any) {
        logger.debug(`configFile 스캔 실패: ${installPath} — ${err.message}`);
      }
    }

    return results;
  },
};

/** 텍스트에서 자격증명 패턴 추출 (평문 위주, 암호화는 POS별 별도 처리) */
function parseCredentialFromText(text: string, posType: string): DiscoveredCredential[] {
  const results: DiscoveredCredential[] = [];

  // 공통 패턴: host/port/database/user/password
  const hostMatch = text.match(/(?:host|server|address|ip)\s*[=:]\s*["']?([^"'\s\r\n;]+)/i);
  const portMatch = text.match(/(?:port)\s*[=:]\s*["']?(\d+)/i);
  const dbMatch = text.match(/(?:database|db|catalog|initial\s*catalog)\s*[=:]\s*["']?([^"'\s\r\n;]+)/i);
  const userMatch = text.match(/(?:user|uid|username|user\s*id)\s*[=:]\s*["']?([^"'\s\r\n;]+)/i);
  const pwdMatch = text.match(/(?:password|pwd)\s*[=:]\s*["']?([^"'\s\r\n;]+)/i);

  if (hostMatch && portMatch) {
    const port = parseInt(portMatch[1]);
    const dbType: 'mssql' | 'mysql' | 'sqlite' =
      port === 1433 ? 'mssql' :
      port === 3306 ? 'mysql' :
      'mysql';

    results.push({
      dbType,
      host: hostMatch[1],
      port,
      database: dbMatch?.[1],
      username: userMatch?.[1],
      password: pwdMatch?.[1],
      confidence: pwdMatch ? 80 : 40, // 비번 발견 시 신뢰도 ↑
      source: 'configFile',
      metadata: { posType },
    });
  }

  return results;
}

// ============================================================
// B. odbcDsn — Windows ODBC 데이터 원본 (레지스트리)
// ============================================================

const odbcDsnAdapter: CredentialDiscoveryAdapter = {
  name: 'odbcDsn',
  priority: 20,
  description: 'Windows ODBC 시스템 DSN (HKLM\\SOFTWARE\\ODBC\\ODBC.INI)',

  async discover(_ctx: DiscoveryContext): Promise<DiscoveredCredential[]> {
    // Windows 전용: winreg 모듈 (런타임 동적 import)
    if (process.platform !== 'win32') {
      logger.debug('odbcDsn: Windows 전용 — 스킵');
      return [];
    }

    try {
      // ⚠️ winreg는 별도 npm 의존성. 묶음 2에서 박힐 예정.
      // 현재는 placeholder — 매장 검증 후 정확 구현.
      logger.debug('odbcDsn: winreg 의존성 필요 — 묶음 2에서 활성화');
      return [];
    } catch (err: any) {
      logger.debug(`odbcDsn 스캔 실패: ${err.message}`);
      return [];
    }
  },
};

// ============================================================
// C. mysqlIni — MySQL my.ini의 init-file/password 흔적
// ============================================================

const mysqlIniAdapter: CredentialDiscoveryAdapter = {
  name: 'mysqlIni',
  priority: 30,
  description: 'MySQL my.ini의 init-file/password 흔적 + datadir 발견',

  async discover(ctx: DiscoveryContext): Promise<DiscoveredCredential[]> {
    if (!ctx.runningProcesses.some(p => /mysqld/i.test(p))) return [];

    const candidatePaths = [
      'C:\\ProgramData\\MySQL\\MySQL Server 8.0\\my.ini',
      'C:\\ProgramData\\MySQL\\MySQL Server 5.7\\my.ini',
      'C:\\ProgramData\\MySQL\\MySQL Server 5.6\\my.ini',
      'C:\\Program Files\\MySQL\\MySQL Server 8.0\\my.ini',
      'C:\\Program Files\\MySQL\\MySQL Server 5.7\\my.ini',
    ];

    const results: DiscoveredCredential[] = [];

    for (const iniPath of candidatePaths) {
      const content = safeReadFile(iniPath);
      if (!content) continue;

      // port + datadir 추출
      const portMatch = content.match(/^\s*port\s*=\s*(\d+)/im);
      const datadirMatch = content.match(/^\s*datadir\s*=\s*["']?([^"'\r\n]+)/im);

      if (portMatch || datadirMatch) {
        results.push({
          dbType: 'mysql',
          host: 'localhost',
          port: portMatch ? parseInt(portMatch[1]) : 3306,
          confidence: 30, // host/port만 — 비번은 my.ini에 없음 (data 마운트 fallback 필요)
          source: 'mysqlIni',
          metadata: { iniPath, datadir: datadirMatch?.[1] },
        });
      }
    }

    return results;
  },
};

// ============================================================
// D. dataFileMount — 데이터 파일 사본 → 별도 인스턴스 마운트
// ============================================================

const dataFileMountAdapter: CredentialDiscoveryAdapter = {
  name: 'dataFileMount',
  priority: 40,
  description: 'MySQL/MSSQL 데이터 파일 사본을 별도 인스턴스로 마운트 (인증 우회)',

  async discover(_ctx: DiscoveryContext): Promise<DiscoveredCredential[]> {
    // ⚠️ 실 구현은 묶음 2 이후. 핵심 아이디어:
    //  1. mysqlIniAdapter에서 발견한 datadir 또는 MSSQL의 .mdf 위치 식별
    //  2. 라이브 파일은 잠금 → 별도 디렉토리에 사본 떠서
    //  3. 별도 mysqld --datadir=copy / 또는 SQL Server LocalDB 인스턴스로 attach
    //  4. 그 인스턴스에 root 권한으로 직접 접근 → 자격증명 0건 필요
    //
    // 합법성: 매장 사장님 본인 PC의 본인 데이터 파일 사본 생성 — 사장님 권한.
    logger.debug('dataFileMount: 묶음 2 이후 활성화 (별도 mysqld/LocalDB 인스턴스 필요)');
    return [];
  },
};

// ============================================================
// E. backupFile — POS 자동 백업 .sql/.bak 정기 생성
// ============================================================

const backupFileAdapter: CredentialDiscoveryAdapter = {
  name: 'backupFile',
  priority: 50,
  description: 'POS 자동 백업 .sql/.bak/.dump 파일 자동 스캔',

  async discover(ctx: DiscoveryContext): Promise<DiscoveredCredential[]> {
    const results: DiscoveredCredential[] = [];
    const extensions = ['.sql', '.bak', '.dump'];
    const searchPaths = [
      ...ctx.posInstallPaths,
      'C:\\Backup',
      'C:\\POS\\Backup',
      'D:\\Backup',
    ];

    for (const searchPath of searchPaths) {
      if (!fs.existsSync(searchPath)) continue;

      try {
        const files = collectFilesRecursive(searchPath, extensions, 2);

        // 최신 파일 1개만 사용 (전수 파싱은 비효율)
        const latest = files
          .map(f => ({ f, mtime: fs.statSync(f).mtimeMs }))
          .sort((a, b) => b.mtime - a.mtime)
          .slice(0, 3)
          .map(x => x.f);

        for (const file of latest) {
          // 백업 파일 자체에서 자격증명을 캐는 게 아니라,
          // 백업 파일을 통해 마스킹 우회 데이터 추출용 → mask-bypass.ts에서 활용.
          // 여기서는 백업 파일 존재만 보고.
          results.push({
            dbType: 'mysql', // 추정 (.sql 덤프 = MySQL/MSSQL 양쪽 가능, 묶음 2에서 자동 판별)
            host: 'localhost',
            port: 0,
            confidence: 20,
            source: 'backupFile',
            metadata: { backupPath: file, fileSize: fs.statSync(file).size },
          });
        }
      } catch (err: any) {
        logger.debug(`backupFile 스캔 실패: ${searchPath} — ${err.message}`);
      }
    }

    return results;
  },
};

// ============================================================
// F. memoryDump — 실행 중 프로세스 메모리에서 자격증명 추출
// ============================================================

const memoryDumpAdapter: CredentialDiscoveryAdapter = {
  name: 'memoryDump',
  priority: 90, // 마지막 수단
  description: '실행 중 POS 클라이언트 프로세스 메모리 덤프 (마지막 수단, 백신 감지 위험)',

  async discover(_ctx: DiscoveryContext): Promise<DiscoveredCredential[]> {
    // ⚠️ 백신/안티치트가 차단할 수 있음. 묶음 4 이후 신중하게 박음.
    // 합법성: 사장님 본인 PC의 본인이 실행한 프로세스 → 사장님 권한 범위 안.
    logger.debug('memoryDump: 마지막 수단 — 묶음 4 이후 신중 활성화');
    return [];
  },
};

// ============================================================
// G. aiInference — AI에게 설정 파일 통째로 던져 자격증명 추론
// ============================================================

const aiInferenceAdapter: CredentialDiscoveryAdapter = {
  name: 'aiInference',
  priority: 80,
  description: '모든 어댑터 실패 시 LLM에게 설정 파일 통째로 던져 자격증명 추론',

  async discover(ctx: DiscoveryContext): Promise<DiscoveredCredential[]> {
    // ⚠️ 서버 측 새 라우트 필요: POST /api/flyer/pos/infer-credential
    //  - Agent → 서버: 설정 파일들 + 컨텍스트 전송
    //  - 서버 측 LLM (Claude/GPT) → 자격증명 추론 → 반환
    //  - 묶음 3 (양방향 통신) 박힐 때 함께 활성화
    logger.debug('aiInference: 묶음 3에서 서버 라우트와 함께 활성화');
    return [];
  },
};

// ============================================================
// 통합 진입점
// ============================================================

/** 7 어댑터 순차 시도 — 첫 confidence 70%+ 또는 모두 시도 후 반환 */
export async function runCredentialDiscovery(ctx: DiscoveryContext): Promise<DiscoveredCredential[]> {
  if (adapters.length === 0) {
    registerDefaultAdapters();
  }

  logger.info(`Credential Discovery 시작 — POS 종류: ${ctx.posType}, 어댑터: ${adapters.length}개`);

  const allResults: DiscoveredCredential[] = [];

  for (const adapter of adapters) {
    try {
      const results = await adapter.discover(ctx);
      if (results.length > 0) {
        logger.info(`[${adapter.name}] 발견 ${results.length}건 (최고 confidence ${Math.max(...results.map(r => r.confidence))}%)`);
        allResults.push(...results);

        // 조기 종료: confidence 70%+ 1건 이상이면 즉시 반환
        const highConfidence = results.filter(r => r.confidence >= 70);
        if (highConfidence.length > 0) {
          logger.info(`조기 종료: ${adapter.name}에서 confidence 70%+ 발견`);
          break;
        }
      }
    } catch (err: any) {
      logger.warn(`[${adapter.name}] 실행 실패: ${err.message}`);
    }
  }

  // confidence 내림차순 정렬
  allResults.sort((a, b) => b.confidence - a.confidence);

  logger.info(`Credential Discovery 완료 — 총 ${allResults.length}건 발견`);
  return allResults;
}

/** 기본 어댑터 7종 등록 */
export function registerDefaultAdapters(): void {
  registerAdapter(configFileAdapter);
  registerAdapter(odbcDsnAdapter);
  registerAdapter(mysqlIniAdapter);
  registerAdapter(dataFileMountAdapter);
  registerAdapter(backupFileAdapter);
  registerAdapter(memoryDumpAdapter);
  registerAdapter(aiInferenceAdapter);
}

// ============================================================
// 유틸
// ============================================================

function collectFilesRecursive(dir: string, extensions: string[], maxDepth: number, currentDepth = 0): string[] {
  if (currentDepth > maxDepth) return [];

  const result: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        result.push(...collectFilesRecursive(fullPath, extensions, maxDepth, currentDepth + 1));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.includes(ext)) {
          result.push(fullPath);
        }
      }
    }
  } catch {
    // 권한 부족 등 무시
  }
  return result;
}

function safeReadFile(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const stats = fs.statSync(filePath);
    if (stats.size > 5 * 1024 * 1024) return null; // 5MB 초과 스킵
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}
