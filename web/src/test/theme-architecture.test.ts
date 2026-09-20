/**
 * The theme architecture — dark is the default, light is the remap.
 *
 * These are source-reading assertions because the properties they guard are
 * invisible at runtime until they break: a `:root` that quietly stops being
 * dark, or a leftover `[data-theme='dark']` block that silently stops working
 * once `:root` holds the dark values, both render fine and both undo the
 * product's identity without a single error anywhere.
 *
 * The identity being guarded is EduInsight «Nebula» — the previous system,
 * whose dark-first look with an emerald accent this product inherited.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const tokens = readFileSync(resolve(ROOT, 'src/design-system/tokens/tokens.css'), 'utf8');
const theme = readFileSync(resolve(ROOT, 'src/shared/theme/theme.tsx'), 'utf8');
const styles = readFileSync(resolve(ROOT, 'src/styles.css'), 'utf8');
const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');

/** The body of a CSS block, from its opening brace to its closing one. */
function block(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  if (start === -1) return '';
  const end = source.indexOf('}', start);
  return source.slice(start, end);
}

describe('the base theme', () => {
  it('is dark — :root declares the dark colour scheme and Nebula canvas', () => {
    const root = block(tokens, ':root');
    expect(root).toContain('color-scheme: dark');
    // Nebula's canvas: slate-950, darker than any surface can be.
    expect(root).toMatch(/--color-canvas: oklch\(0\.129/);
  });

  it('has no dark override block — the default IS dark', () => {
    // When :root holds the dark values, a [data-theme='dark'] block is dead
    // code that looks load-bearing. It must not come back.
    expect(tokens).not.toContain("[data-theme='dark']");
  });

  it('keeps light as the remap, declared for the same token set', () => {
    const light = block(tokens, "[data-theme='light']");
    expect(light).toContain('color-scheme: light');
    // The remap reassigns, it does not add: a token only in the light block
    // has no dark value and vanishes with the theme.
    const root = block(tokens, ':root');
    for (const name of light.match(/--[a-z-]+(?=:)/g) ?? []) {
      expect(root).toContain(`${name}:`);
    }
  });

  it('carries the emerald accent in both themes', () => {
    // The hue is the identity: ~163 is emerald. A hue back at 215 means the
    // old blue-teal accent crept back in.
    const root = block(tokens, ':root');
    const light = block(tokens, "[data-theme='light']");
    expect(root).toMatch(/--color-accent: oklch\([0-9.]+ 0\.15[0-9]* 16[0-9.]+\)/);
    expect(light).toMatch(/--color-accent: oklch\([0-9.]+ 0\.1[0-9]* 16[0-9.]+\)/);
  });

  it('declares the aurora fields in both themes', () => {
    const root = block(tokens, ':root');
    const light = block(tokens, "[data-theme='light']");
    for (const name of ['--color-aurora-emerald', '--color-aurora-indigo', '--color-aurora-teal']) {
      expect(root).toContain(`${name}:`);
      expect(light).toContain(`${name}:`);
    }
    // And the backdrop consumes the tokens, never a literal colour.
    expect(styles).toMatch(/\.aurora \{/);
    expect(styles).toContain('var(--color-aurora-emerald)');
    expect(styles).not.toMatch(/\.aurora[^}]*#/);
  });
});

describe('who decides the theme', () => {
  it('defaults to dark and does not follow the OS', () => {
    // The product's identity is dark; a light OS is not a light product. A
    // matchMedia call here would mean the OS started overruling the identity.
    expect(theme).toMatch(/return 'dark';/);
    expect(theme).not.toContain('matchMedia');
  });

  it('tells the browser dark comes first', () => {
    expect(html).toContain('content="dark light"');
  });

  it('loads the Nebula faces', () => {
    expect(html).toContain('family=Cairo');
    expect(html).toContain('family=Plus+Jakarta+Sans');
    expect(tokens).toContain("'Cairo'");
  });
});
