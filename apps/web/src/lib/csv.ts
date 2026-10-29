/**
 * Comma-separated values as written by spreadsheet programs (RFC 4180): quoted fields may contain
 * commas, line breaks and doubled quotes; a leading byte-order mark is ignored; lines may end in CRLF
 * or LF. Blank lines are skipped.
 */

export interface CsvTable {
  headers: string[];
  rows: string[][];
  /** Spreadsheet row number of each data row, counting blank rows, as a spreadsheet shows them. */
  rowNumbers: number[];
}

/**
 * Spreadsheet row of a data row numbered from 1, as imports number them. Falls back to the
 * position after the header row when the number is unknown.
 */
export function spreadsheetRow(rowNumbers: readonly number[], dataRow: number): number {
  return rowNumbers[dataRow - 1] ?? dataRow + 1;
}

export class CsvFormatError extends Error {
  constructor(readonly reason: 'empty' | 'unterminated_quote' | 'not_utf8') {
    super(`The file could not be read as CSV: ${reason}`);
    this.name = 'CsvFormatError';
  }
}

export function parseCsv(input: string): CsvTable {
  if (input.includes('\uFFFD')) {
    // A replacement character means the file was not saved as UTF-8 (for example "CSV" instead of
    // "CSV UTF-8" in a spreadsheet program), so Hindi names would be corrupted.
    throw new CsvFormatError('not_utf8');
  }
  const text = input.startsWith('\uFEFF') ? input.slice(1) : input;
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text.charAt(index);
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"' && field === '') {
      inQuotes = true;
    } else if (character === ',') {
      record.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') {
        index += 1;
      }
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else {
      field += character;
    }
  }

  if (inQuotes) {
    throw new CsvFormatError('unterminated_quote');
  }
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  const numbered = records
    .map((row, index) => ({ row, number: index + 1 }))
    .filter(({ row }) => row.some((value) => value.trim() !== ''));
  const [header, ...data] = numbered;
  if (!header) {
    throw new CsvFormatError('empty');
  }
  return {
    headers: header.row.map(normaliseHeader),
    rows: data.map(({ row }) => row),
    rowNumbers: data.map(({ number }) => number),
  };
}

/** `"Full Name "` and `full_name` both become `full_name`. */
export function normaliseHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

export interface RecordsResult {
  records: Record<string, string>[];
  missingColumns: string[];
  unknownColumns: string[];
  /** Import columns named more than once; the file is ambiguous and must not be imported. */
  duplicateColumns: string[];
}

/** Rows as records keyed by header, checked against the columns an import understands. */
export function toRecords(
  table: CsvTable,
  columns: { name: string; required: boolean }[],
): RecordsResult {
  const known = new Set(columns.map((column) => column.name));
  const missingColumns = columns
    .filter((column) => column.required && !table.headers.includes(column.name))
    .map((column) => column.name);
  const unknownColumns = [
    ...new Set(table.headers.filter((header) => header !== '' && !known.has(header))),
  ];
  const duplicateColumns = [
    ...new Set(
      table.headers.filter(
        (header, index) => known.has(header) && table.headers.indexOf(header) !== index,
      ),
    ),
  ];
  const records = table.rows.map((row) => {
    const record: Record<string, string> = {};
    table.headers.forEach((header, index) => {
      if (known.has(header)) {
        record[header] = (row[index] ?? '').trim();
      }
    });
    return record;
  });
  return { records, missingColumns, unknownColumns, duplicateColumns };
}

function quote(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** CSV text with a byte-order mark, so spreadsheet programs open Hindi text correctly. */
export function toCsv(rows: string[][]): string {
  return `\uFEFF${rows.map((row) => row.map(quote).join(',')).join('\r\n')}\r\n`;
}

export function downloadTextFile(
  fileName: string,
  content: string,
  type = 'text/csv;charset=utf-8',
): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
