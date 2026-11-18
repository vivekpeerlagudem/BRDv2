import { describe, expect, it } from 'vitest';
import { CsvError, parseCsv, toCsv } from './csv.ts';

describe('parseCsv (RFC 4180)', () => {
  it('reads plain records with LF, CRLF and lone CR line endings', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('a,b\r\n1,2\r\n3,4')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
    expect(parseCsv('a,b\r1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('ignores a UTF-8 byte-order mark', () => {
    expect(parseCsv('﻿name,domain\nAcme,acme.example')[0]).toEqual(['name', 'domain']);
    expect(parseCsv('﻿"name",x\n')[0]).toEqual(['name', 'x']);
  });

  it('keeps commas, line breaks and doubled quotes inside quoted fields', () => {
    const rows = parseCsv('name,note\r\n"Acme, Inc.","line one\r\nline two"\r\n"She said ""hi""",""\r\n');
    expect(rows).toEqual([
      ['name', 'note'],
      ['Acme, Inc.', 'line one\r\nline two'],
      ['She said "hi"', ''],
    ]);
  });

  it('keeps empty fields, leading/trailing spaces and ragged rows as they are', () => {
    expect(parseCsv('a,,c\n,,\n x , y\nonly')).toEqual([['a', '', 'c'], ['', '', ''], [' x ', ' y'], ['only']]);
  });

  it('skips blank lines but keeps a row that is an explicitly quoted empty value', () => {
    expect(parseCsv('a\n\n\r\nb\n')).toEqual([['a'], ['b']]);
    expect(parseCsv('a\n""\nb')).toEqual([['a'], [''], ['b']]);
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('﻿')).toEqual([]);
    expect(parseCsv('\n\n')).toEqual([]);
  });

  it('keeps a quote that appears inside an unquoted field', () => {
    expect(parseCsv('5" pipe,ok')).toEqual([['5" pipe', 'ok']]);
  });

  it('rejects an unterminated quoted field and text after a closing quote, naming the line', () => {
    expect(() => parseCsv('a,b\n"open,2\n3,4')).toThrow(CsvError);
    let caught: unknown;
    try {
      parseCsv('a,b\nx,y\n"open,2');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CsvError);
    expect((caught as CsvError).line).toBe(3);
    expect(() => parseCsv('"a"b,c')).toThrow(/after a closing quote/);
  });

  it('stops reading once the record limit is passed', () => {
    expect(parseCsv('h\n1\n2', { maxRecords: 3 })).toHaveLength(3);
    expect(() => parseCsv('h\n1\n2\n3', { maxRecords: 3 })).toThrow(/too many rows/);
  });

  it('does not treat non-ASCII text specially', () => {
    expect(parseCsv('名前,Größe\n"Zoë, Ltd",ß')).toEqual([
      ['名前', 'Größe'],
      ['Zoë, Ltd', 'ß'],
    ]);
  });
});

describe('toCsv', () => {
  it('round-trips through parseCsv, quoting only where needed', () => {
    const rows = [
      ['name', 'note'],
      ['Acme, Inc.', 'two\nlines'],
      ['say "hi"', ' padded '],
      ['plain', ''],
    ];
    const text = toCsv(rows);
    expect(text.startsWith('name,note\r\n"Acme, Inc.","two\nlines"\r\n')).toBe(true);
    expect(parseCsv(text)).toEqual(rows);
  });

  it('neutralises spreadsheet formulas when asked, but leaves negative numbers alone', () => {
    expect(parseCsv(toCsv([['=1+1', '+SUM(A1)', '@x', '-5', '-1,234.50', '-cmd', 'ok']], { guardFormulas: true }))).toEqual([
      ["'=1+1", "'+SUM(A1)", "'@x", '-5', '-1,234.50', "'-cmd", 'ok'],
    ]);
  });
});
