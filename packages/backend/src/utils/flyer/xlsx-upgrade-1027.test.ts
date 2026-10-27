/**
 * ★ 2026-10-27 xlsx 0.18.5(npm · 프로토타입 오염 · ReDoS) → SheetJS 공식 0.20.3 회귀 — 고객 엑셀 업로드 생일
 *
 * 0.20.3 은 날짜 칸을 「프로세스 시각대의 그날 자정」 Date 로 준다(xlsx · csv 모두).
 * 옛 customers.ts parseDateValue(→ CT sheetDateToYmd 로 옮김)는 UTC 로 읽어 한국 시각대에서 하루 앞 날짜가 저장됐다(엑셀은 옛 판에서도 · csv 는 새 판에서 새로).
 * 기대값 = 엑셀 화면에 보이는 날짜(엑셀 날짜 일련번호 33008 = 1990-05-15 · 36526 = 2000-01-01 · 31412 = 1985-12-31).
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { sheetDateToYmd } from './product/flyer-value-normalizer';

// 운영(tsc → CommonJS)과 같은 판(xlsx.js)을 연다 — vitest 의 import 는 xlsx.mjs 로 간다
const XLSX: typeof import('xlsx') = createRequire(__filename)('xlsx');
// 운영 customers.ts /upload 와 같은 읽기 옵션
const readRows = (buf: Buffer) => {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null }) as any[];
};

describe('고객 업로드 생일 = 엑셀에 보이는 날짜', () => {
  it('xlsx 날짜 칸(일련번호 + 날짜 서식)', () => {
    const ws = XLSX.utils.aoa_to_sheet([['이름', '전화번호', '생일']]);
    [[33008], [36526], [31412]].forEach(([serial], i) => {
      ws[XLSX.utils.encode_cell({ r: i + 1, c: 0 })] = { t: 's', v: `고객${i + 1}` };
      ws[XLSX.utils.encode_cell({ r: i + 1, c: 1 })] = { t: 's', v: `0100000000${i + 1}` };
      ws[XLSX.utils.encode_cell({ r: i + 1, c: 2 })] = { t: 'n', v: serial, z: 'yyyy-mm-dd' };
    });
    ws['!ref'] = 'A1:C4';
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'S');
    const rows = readRows(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
    expect(rows.map(r => sheetDateToYmd(r['생일']))).toEqual(['1990-05-15', '2000-01-01', '1985-12-31']);
  });

  it('csv 날짜 글자(- · . · /)', () => {
    const csv = '﻿이름,전화번호,생일\n가,01000000001,1990-05-15\n나,01000000002,2000.01.01\n다,01000000003,1985/12/31\n';
    expect(readRows(Buffer.from(csv, 'utf-8')).map(r => sheetDateToYmd(r['생일']))).toEqual(['1990-05-15', '2000-01-01', '1985-12-31']);
  });

  it('빈 칸 · 날짜 아닌 글자 = null', () => {
    expect([null, '', '모름', undefined].map(v => sheetDateToYmd(v))).toEqual([null, null, null, null]);
  });
});
