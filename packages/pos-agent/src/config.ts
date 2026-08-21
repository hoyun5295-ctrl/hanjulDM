/**
 * POS Agent 설정 관리
 *
 * 설정 파일: agent-config.json (앱 홈 = exe 옆 고정 경로 — 서비스 모드에서도 동일 위치)
 * ⚠️ DB 접속 비밀번호는 현재 평문 저장이다(암호화는 별도 과제 — 주석과 코드를 일치시켰다).
 */

import fs from 'fs';
import { appPath } from './app-paths';

export interface AgentConfig {
  // 서버 연결
  serverUrl: string;       // https://hanjul-flyer.kr
  agentKey: string;        // FPA-XXXXXXXX-XXXXXXXX

  // POS DB 연결
  db: {
    type: 'mssql' | 'mysql' | 'sqlite';
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
    charset?: string;
    /** SQLite 전용: DB 파일 경로 */
    filePath?: string;
  };

  // 싱크 설정 (서버에서 동적 업데이트)
  sync: {
    salesIntervalMinutes: number;
    membersIntervalMinutes: number;
    inventoryIntervalMinutes: number;
    heartbeatIntervalSeconds: number;
    batchSize: number;
  };

  // 로컬 상태
  lastSalesSync?: string;
  lastMembersSync?: string;
  lastInventorySync?: string;
}

const CONFIG_PATH = appPath('agent-config.json');

const DEFAULT_CONFIG: AgentConfig = {
  serverUrl: 'https://hanjul-flyer.kr',
  agentKey: '',
  db: {
    type: 'mssql',
    host: 'localhost',
    port: 1433,
    database: '',
    username: 'sa',
    password: '',
  },
  sync: {
    salesIntervalMinutes: 5,
    membersIntervalMinutes: 30,
    inventoryIntervalMinutes: 60,
    heartbeatIntervalSeconds: 60,
    batchSize: 500,
  },
};

let config: AgentConfig = { ...DEFAULT_CONFIG };

/** 설정 파일 로드 */
export function loadConfig(): AgentConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
      config = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    }
  } catch (err) {
    console.error('[config] 설정 로드 실패, 기본값 사용:', err);
  }
  return config;
}

/** 설정 저장 */
export function saveConfig(updates: Partial<AgentConfig>): void {
  config = { ...config, ...updates };
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  } catch (err) {
    console.error('[config] 설정 저장 실패:', err);
  }
}

/** 현재 설정 반환 */
export function getConfig(): AgentConfig {
  return config;
}
