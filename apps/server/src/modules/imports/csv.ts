/**
 * RFC 4180 CSV reader and writer (no dependency).
 * Reader: comma separated; fields may be quoted with `"`; inside quotes a doubled `""` is one quote and commas and line
 * breaks are data; records end with CRLF, LF or a lone CR; a leading UTF-8 byte-order mark is ignored; a final line
 * break does not create an extra record; completely blank lines are skipped.
 */
export class CsvError extends Error {
  readonly line: number;
  readonly tooManyRows: boolean;
  constructor(message: string, line: number, tooManyRows = false) {
    super(message);
    this.name = 'CsvError';
    this.line = line;
    this.tooManyRows = tooManyRows;
  }
}

export interface ParseOptions {
  /** Stop with a CsvError as soon as more than this many records (header included) have been read. */
  maxRecords?: number;
}

export function parseCsv(text: string, options: ParseOptions = {}): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false; // currently inside a quoted field
  let wasQuoted = false; // the current field started with a quote (so "" is an empty value, not a blank line)
  let closed = false; // a quoted field has just been closed; only a delimiter or a line end may follow
  let line = 1;
  let quoteLine = 1;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  const endField = () => {
    record.push(field);
    field = '';
    wasQuoted = false;
    closed = false;
  };
  const endRecord = () => {
    const blank = record.length === 0 && field === '' && !wasQuoted;
    endField();
    if (!blank) {
      records.push(record);
      if (options.maxRecords !== undefined && records.length > options.maxRecords) throw new CsvError('The file has too many rows', line, true);
    }
    record = [];
  };

  for (; i < text.length; i++) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }
    if (ch === ',') endField();
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRecord();
      line++;
    } else if (closed) throw new CsvError(`Line ${line}: unexpected character after a closing quote`, line);
    else if (ch === '"' && field === '') {
      quoted = true;
      wasQuoted = true;
      quoteLine = line;
    } else field += ch; // a quote inside an unquoted field is kept as written
  }
  if (quoted) throw new CsvError(`Line ${quoteLine}: a quoted value is never closed`, quoteLine);
  if (record.length > 0 || field !== '' || wasQuoted) endRecord();
  return records;
}

/**
 * Cells that a spreadsheet would run as a formula are prefixed with an apostrophe (CSV injection guard): the error
 * report is opened in a spreadsheet by an Admin and its cells are copied from an uploaded file.
 */
function safeCell(value: string): string {
  const risky = /^[=+@\t\r]/.test(value) || (value.startsWith('-') && !/^-\d+([.,]\d+)*$/.test(value));
  return risky ? `'${value}` : value;
}
const quote = (value: string) => (/[",\r\n]/.test(value) || value !== value.trim() ? `"${value.replaceAll('"', '""')}"` : value);

export function toCsv(rows: string[][], options: { guardFormulas?: boolean } = {}): string {
  return rows
    .map((r) => r.map((c) => quote(options.guardFormulas ? safeCell(c) : c)).join(','))
    .join('\r\n')
    .concat('\r\n');
}
