import { describe, expect, it } from 'vitest';
import { csvCell, filenameTimestamp, rowsToCsv, safeFilename } from './download';

describe('download utilities', () => {
  it('creates stable readable safe filenames', () => {
    expect(safeFilename('  Café / Need: 2026  ')).toBe('cafe-need-2026');
    expect(safeFilename('***')).toBe('alur-export');
    expect(filenameTimestamp(new Date('2026-07-24T10:11:12.123Z'))).toBe('20260724-101112Z');
  });

  it('escapes CSV cells without altering values', () => {
    expect(csvCell('King\'s, Cross')).toBe('"King\'s, Cross"');
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(rowsToCsv(['name', 'value'], [['A', 2], ['B, C', null]])).toBe('name,value\r\nA,2\r\n"B, C",');
  });
});
