import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// shared/ must stay pure logic: testable without graphics, a browser, or Node.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sharedDir = join(root, 'shared');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function importSpecifiers(source: string): string[] {
  const patterns = [/\bfrom\s+['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]+)['"]/g, /\bimport\s+['"]([^'"]+)['"]/g];
  return patterns.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[1] as string));
}

const files = sourceFiles(sharedDir);
const label = (file: string) => relative(root, file).split(sep).join('/');

describe('shared/ purity', () => {
  it('finds the shared source files', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((file) => [label(file), file]))('%s only imports from inside shared/', (_name, file) => {
    const source = stripComments(readFileSync(file, 'utf8'));
    const isTest = file.endsWith('.test.ts');
    for (const specifier of importSpecifiers(source)) {
      if (isTest && specifier === 'vitest') continue;
      expect(specifier.startsWith('.'), `package import "${specifier}"`).toBe(true);
      const target = resolve(dirname(file), specifier);
      expect(target.startsWith(sharedDir + sep), `"${specifier}" leaves shared/`).toBe(true);
    }
  });

  it.each(files.map((file) => [label(file), file]))('%s uses no browser, Node, or nondeterministic globals', (_name, file) => {
    const source = stripComments(readFileSync(file, 'utf8'));
    const forbidden =
      /\b(window|document|navigator|localStorage|indexedDB|crypto|process|require|setTimeout|setInterval|Math\.random|Date\.now)\b/;
    expect(source).not.toMatch(forbidden);
  });
});
