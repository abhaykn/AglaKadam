import { describe, expect, it } from 'vitest';
import { CsvFormatError, parseCsv, spreadsheetRow, toCsv, toRecords } from './csv';

describe('parseCsv', () => {
  it('reads quoted fields with commas, quotes and line breaks', () => {
    const table = parseCsv(
      'School Name,UDISE Code\r\n"Primary School, Rampur","09010100101"\r\n"He said ""hello""","multi\nline"\r\n',
    );
    expect(table).toEqual({
      headers: ['school_name', 'udise_code'],
      rows: [
        ['Primary School, Rampur', '09010100101'],
        ['He said "hello"', 'multi\nline'],
      ],
      rowNumbers: [2, 3],
    });
  });

  it('ignores a byte-order mark and blank lines, and keeps Hindi text intact', () => {
    const table = parseCsv('\uFEFFfull_name,gender\n\nसीता देवी,female\n,\n');
    expect(table.rows).toEqual([['सीता देवी', 'female']]);
  });

  it('keeps a final row without a line break and empty trailing fields', () => {
    expect(parseCsv('a,b,c\n1,,').rows).toEqual([['1', '', '']]);
  });

  it('refuses an empty file, an unterminated quote and text that was not saved as UTF-8', () => {
    expect(() => parseCsv('  \n\n')).toThrow(CsvFormatError);
    expect(() => parseCsv('a\n"open')).toThrow(/unterminated_quote/);
    expect(() => parseCsv('name\nS\uFFFDta')).toThrow(/not_utf8/);
  });
});

describe('toRecords', () => {
  const columns = [
    { name: 'full_name', required: true },
    { name: 'gender', required: true },
    { name: 'section', required: false },
  ];

  it('maps rows by header and trims values', () => {
    const result = toRecords(parseCsv('Full Name, Gender ,Notes\n Asha , female ,x'), columns);
    expect(result).toEqual({
      records: [{ full_name: 'Asha', gender: 'female' }],
      missingColumns: [],
      unknownColumns: ['notes'],
      duplicateColumns: [],
    });
  });

  it('reports required columns that are missing', () => {
    expect(toRecords(parseCsv('full_name\nAsha'), columns).missingColumns).toEqual(['gender']);
  });
});

describe('spreadsheet row numbers', () => {
  it('count blank rows, so problems point at the right row in the spreadsheet', () => {
    const table = parseCsv('name\n\nAsha\n\n\nRavi');
    expect(table.rowNumbers).toEqual([3, 6]);
    expect(spreadsheetRow(table.rowNumbers, 2)).toBe(6);
    expect(spreadsheetRow([], 2)).toBe(3);
  });
});

describe('duplicate columns', () => {
  it('are reported when the import reads them', () => {
    const result = toRecords(parseCsv('full_name,gender,Full Name,notes,Notes\nA,female,B,x,y'), [
      { name: 'full_name', required: true },
      { name: 'gender', required: true },
    ]);
    expect(result.duplicateColumns).toEqual(['full_name']);
    expect(result.unknownColumns).toEqual(['notes']);
  });
});

describe('toCsv', () => {
  it('quotes values that need it and round-trips through the parser', () => {
    const text = toCsv([
      ['name', 'note'],
      ['Primary School, Rampur', 'said "yes"'],
    ]);
    expect(text.startsWith('\uFEFF')).toBe(true);
    expect(parseCsv(text).rows).toEqual([['Primary School, Rampur', 'said "yes"']]);
  });
});
