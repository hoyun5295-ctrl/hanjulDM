/**
 * ★ CT-F 1025 — 전단 파일 등록: 시트 읽기 (17번 설계 §2-2)
 *
 * - 파일은 메모리 버퍼로만 받는다(/tmp 잔존 0).
 * - CSV: UTF-8(엄격) → 실패 시 EUC-KR(CP949) — 엑셀 「CSV」 저장본의 한글 깨짐 차단. 새 의존성 0.
 * - 시트: 「작성 예시」「목록」 제외 → 「상품 입력」 우선 → 헤더 점수 최고.
 * - 헤더 행: 앞 10행 중 동의어 2칸 이상 맞는 첫 행(제목행·안내행 건너뜀).
 * 값은 문자열 그대로 돌려준다 — 해석은 flyer-value-normalizer 한 곳.
 */
import * as XLSX from 'xlsx';
import { headerScore } from './flyer-excel-mapper';

export const INPUT_SHEET = '상품 입력';
export const SKIP_SHEETS = ['작성 예시', '목록'];
const HEADER_SCAN_ROWS = 10;
const MIN_HEADER_SCORE = 2;
export const MAX_DATA_ROWS = 2000;

export class SheetReadError extends Error {}

export interface SheetReadResult {
  /** 고를 수 있는 시트(예시·목록 제외) */
  sheets: string[];
  sheetName: string;
  /** 헤더 행 번호(1부터) */
  headerRow: number;
  headers: string[];
  rows: string[][];
}

function isCsv(buf: Buffer, filename: string): boolean {
  if (/\.(csv|txt)$/i.test(filename)) return true;
  if (/\.(xlsx|xlsm|xls)$/i.test(filename)) return false;
  // 확장자가 없으면 바이트로: xlsx = ZIP(PK) · xls = OLE(D0 CF)
  return !(buf[0] === 0x50 && buf[1] === 0x4b) && !(buf[0] === 0xd0 && buf[1] === 0xcf);
}

/** CSV 바이트 → 문자열. UTF-8로 엄격히 읽고, 깨지면 EUC-KR(CP949)로 다시 읽는다. BOM은 TextDecoder가 걷는다. */
export function decodeCsv(buf: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('euc-kr').decode(buf);
  }
}

function sheetRows(ws: XLSX.WorkSheet): string[][] {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '', blankrows: true });
  return rows.map(r => (Array.isArray(r) ? r.map(c => (c === null || c === undefined ? '' : String(c))) : []));
}

function findHeader(rows: string[][]): { at: number; score: number } {
  let best = { at: -1, score: 0 };
  for (let i = 0; i < Math.min(HEADER_SCAN_ROWS, rows.length); i++) {
    const s = headerScore(rows[i]);
    if (s >= MIN_HEADER_SCORE) return { at: i, score: s };
    if (s > best.score) best = { at: i, score: s };
  }
  return best;
}

export function readProductSheet(buf: Buffer, filename: string, wantSheet?: string): SheetReadResult {
  let wb: XLSX.WorkBook;
  try {
    wb = isCsv(buf, filename)
      ? XLSX.read(decodeCsv(buf), { type: 'string' })
      : XLSX.read(buf, { type: 'buffer' });
  } catch {
    throw new SheetReadError('파일을 읽지 못했습니다. 엑셀(xlsx) 또는 CSV 파일인지 확인해 주세요.');
  }

  const sheets = wb.SheetNames.filter(n => !SKIP_SHEETS.includes(n.trim()));
  if (sheets.length === 0) throw new SheetReadError('상품이 적힌 시트가 없습니다.');

  const scored = sheets.map(name => {
    const rows = sheetRows(wb.Sheets[name]);
    return { name, rows, header: findHeader(rows) };
  });

  const pick =
    (wantSheet && scored.find(s => s.name === wantSheet)) ||
    scored.find(s => s.name.trim() === INPUT_SHEET && s.header.score >= MIN_HEADER_SCORE) ||
    [...scored].sort((a, b) => b.header.score - a.header.score)[0];

  if (pick.header.score < MIN_HEADER_SCORE) {
    throw new SheetReadError('상품명·가격 같은 제목 줄을 찾지 못했습니다. 예시 양식의 첫 줄처럼 제목을 적어 주세요.');
  }

  const headers = pick.rows[pick.header.at].map(h => h.trim());
  const data = pick.rows.slice(pick.header.at + 1);
  // 서식만 있는 꼬리 빈 행(양식의 빈 칸 300줄 등)은 행 수에 넣지 않는다
  while (data.length > 0 && data[data.length - 1].every(c => !c.trim())) data.pop();
  if (data.length > MAX_DATA_ROWS) {
    throw new SheetReadError(`한 번에 ${MAX_DATA_ROWS}행까지 올릴 수 있습니다. (지금 ${data.length}행)`);
  }
  return { sheets, sheetName: pick.name, headerRow: pick.header.at + 1, headers, rows: data };
}
