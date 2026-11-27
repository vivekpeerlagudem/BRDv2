/**
 * "Nothing leaves the CRM" is structural (BR-AIA-006, Copilot principle P6′): the Copilot module must not be able to
 * reach the code that shares proposals, requests signatures or sends email. This test fails the build if any file
 * under modules/copilot imports such a module or touches those ports.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = fileURLToPath(new URL('./', import.meta.url));
const files = (d: string): string[] =>
  readdirSync(d).flatMap((name) => {
    const path = join(d, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
const FORBIDDEN_IMPORT = /(sharing|esign|e-sign|email|mailer|google-sheets|sales-brief-sheets)/i;
const FORBIDDEN_USE = /\bctx\.(email|esign|sheets)\b|\bfetch\s*\(/;

describe('Copilot dependency rule', () => {
  it('no Copilot file imports sharing, e-signature or email code, or calls an outside URL', () => {
    const offences: string[] = [];
    for (const file of files(dir)) {
      const source = readFileSync(file, 'utf8');
      for (const m of source.matchAll(/(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        const spec = m[1] ?? m[2] ?? '';
        if (FORBIDDEN_IMPORT.test(spec)) offences.push(`${file}: imports ${spec}`);
      }
      const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      const use = FORBIDDEN_USE.exec(code);
      if (use) offences.push(`${file}: uses ${use[0]}`);
    }
    expect(offences).toEqual([]);
  });
});
