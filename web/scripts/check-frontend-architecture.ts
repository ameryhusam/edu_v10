/**
 * Frontend architecture rules — the FE1–FE12 set.
 *
 * The backend's boundaries held because a script failed the build when they
 * were crossed, not because a document asked nicely. The frontend gets the
 * same mechanism.
 *
 * Every rule here was written by planting a violation and confirming the rule
 * catches it. A rule that has never failed proves nothing.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = existsSync(join(HERE, '..', 'web', 'src'))
  ? join(HERE, '..', 'web')
  : join(HERE, '..');
const SRC = join(ROOT, 'src');

interface Rule {
  readonly id: string;
  readonly description: string;
  readonly applies: (path: string) => boolean;
  readonly check: (path: string, content: string) => readonly string[];
}

/* ── helpers ──────────────────────────────────────────────────────────── */

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      out.push(...walk(full));
    } else if (/\.(ts|tsx|css)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Strip comments but KEEP strings — rules that match literals need them. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Strip comments AND strings — for rules that must not match prose. */
function stripCommentsAndStrings(source: string): string {
  return stripComments(source)
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

function imports(content: string): string[] {
  const found: string[] = [];
  const pattern = /(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) found.push(match[1]!);

  const dynamic = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = dynamic.exec(content)) !== null) found.push(match[1]!);
  return found;
}

const inDir = (path: string, ...segments: string[]): boolean =>
  path.startsWith(segments.join(sep) + sep);

/**
 * Legacy unmigrated education domains pending subsequent modularization phases.
 * education/admin has been fully migrated and dismantled.
 * The remaining domains are tracked as intentionally excluded in this phase (§7).
 */
const UNMIGRATED_LEGACY_EDUCATION_DOMAINS = new Set([
  'analytics',
  'assessment',
  'authoring',
  'engagement',
  'guardian',
  'instruction',
  'junior',
  'learning',
  'mastery',
  'progress',
  'remediation',
  'roster',
  'tutoring',
]);

const isUnmigratedLegacyEducation = (path: string): boolean => {
  const parts = path.split(sep);
  return (
    parts[0] === 'education' &&
    parts.length > 1 &&
    UNMIGRATED_LEGACY_EDUCATION_DOMAINS.has(parts[1]!)
  );
};

/* ── rules ────────────────────────────────────────────────────────────── */

const RULES: readonly Rule[] = [
  {
    id: 'FE1',
    description: 'HTTP may only be performed by shared/api/client.ts.',
    // Every request must pass through the layer that attaches the token,
    // refreshes it once, unwraps the envelope and maps the error. A direct
    // fetch silently skips all four.
    applies: (p) => p.endsWith('.ts') || p.endsWith('.tsx'),
    check: (p, content) => {
      if (p === join('shared', 'api', 'client.ts')) return [];
      const code = stripCommentsAndStrings(content);
      const problems: string[] = [];
      if (/\bfetch\s*\(/.test(code)) problems.push('calls fetch() — use the shared api client');
      if (/\bXMLHttpRequest\b/.test(code)) problems.push('uses XMLHttpRequest');
      if (/\baxios\b/.test(code)) problems.push('uses axios');
      return problems;
    },
  },

  {
    id: 'FE2',
    description: 'Raw colours and font sizes may only appear in the token files.',
    applies: (p) => !inDir(p, 'design-system', 'tokens'),
    check: (_p, content) => {
      const code = stripComments(content);
      const problems: string[] = [];
      // Hex colours, rgb()/hsl() literals, and px font sizes. Tailwind utility
      // classes are fine — they resolve to tokens.
      const hex = code.match(/#[0-9a-fA-F]{3,8}\b/g);
      if (hex) problems.push(`hardcodes colour ${[...new Set(hex)].slice(0, 3).join(', ')}`);
      if (/\b(?:rgb|rgba|hsl|hsla)\s*\(/.test(code)) problems.push('hardcodes an rgb/hsl colour');
      if (/font-size\s*:\s*\d/.test(code)) problems.push('hardcodes a font-size');
      return problems;
    },
  },

  {
    id: 'FE3',
    description: 'Layout must use logical properties, never physical left/right.',
    // Arabic is the default locale. A physical margin puts the sidebar on the
    // wrong side for the primary audience, and the bug is invisible to anyone
    // testing in English.
    applies: (p) => p.endsWith('.tsx') || p.endsWith('.css'),
    check: (_p, content) => {
      const code = stripComments(content);
      const problems: string[] = [];

      // Tailwind physical utilities that have logical equivalents.
      const banned = [
        ['\\bml-(?!auto\\b)[\\w./[\\]-]+', 'ml-* → ms-*'],
        ['\\bmr-(?!auto\\b)[\\w./[\\]-]+', 'mr-* → me-*'],
        ['\\bpl-[\\w./[\\]-]+', 'pl-* → ps-*'],
        ['\\bpr-[\\w./[\\]-]+', 'pr-* → pe-*'],
        ['\\bborder-l\\b', 'border-l → border-s'],
        ['\\bborder-r\\b', 'border-r → border-e'],
        // `rounded-lg` is a SIZE, not a side. Only the true side forms are
        // directional: `rounded-l`, `rounded-r`, and the corner pairs
        // `rounded-tl` / `rounded-br` etc.
        ['\\brounded-[lr](?![a-z])', 'rounded-l|r → rounded-s|e'],
        ['\\brounded-[tb][lr](?![a-z])', 'rounded-tl|tr|bl|br → logical corner'],
        ['\\btext-left\\b', 'text-left → text-start'],
        ['\\btext-right\\b', 'text-right → text-end'],
      ] as const;

      for (const [pattern, advice] of banned) {
        if (new RegExp(pattern).test(code)) problems.push(`uses ${advice}`);
      }

      // Raw CSS physical properties.
      if (/(?:^|[;{\s])(?:margin|padding)-(?:left|right)\s*:/.test(code)) {
        problems.push('uses margin/padding-left|right — use the inline equivalents');
      }
      return problems;
    },
  },

  {
    id: 'FE4',
    description: 'Browser globals may only be touched by shared/platform and providers.',
    // Keeps a future Android target possible, and keeps storage access from
    // throwing inside a render in private browsing mode.
    applies: (p) =>
      (p.endsWith('.ts') || p.endsWith('.tsx')) &&
      !inDir(p, 'shared', 'platform') &&
      // These legitimately own document-level concerns: direction, theme
      // attribute, root mount, and the scroll/media queries the shell needs.
      p !== join('shared', 'i18n', 'i18n.tsx') &&
      p !== join('shared', 'theme', 'theme.tsx') &&
      p !== join('shared', 'hooks', 'use-breakpoint.ts') &&
      p !== 'main.tsx' &&
      // Tests asserting on document.dir are how the i18n layer is verified.
      // Exempting only tests keeps the rule's force over shipped code.
      !/\.test\.tsx?$/.test(p),
    check: (_p, content) => {
      const code = stripCommentsAndStrings(content);
      const problems: string[] = [];
      if (/\blocalStorage\b/.test(code)) problems.push('uses localStorage — use shared/platform');
      if (/\bsessionStorage\b/.test(code)) problems.push('uses sessionStorage — use shared/platform');
      if (/\bdocument\s*\./.test(code)) problems.push('touches document directly');
      if (/\bwindow\s*\.\s*matchMedia\b/.test(code)) problems.push('calls matchMedia directly');
      return problems;
    },
  },

  {
    id: 'FE5',
    description: 'User-facing text must come from i18n keys, not literals.',
    // Checked structurally: a JSX text node of two or more letter-words, or a
    // string passed to a label-ish prop. Deliberately narrow — a noisy rule
    // gets disabled, which is worse than a narrow one.
    applies: (p) => p.endsWith('.tsx') && !inDir(p, 'shared', 'i18n'),
    check: (_p, content) => {
      const code = stripComments(content);
      const problems: string[] = [];

      // aria-label="Some words" / title="Some words" with literal prose.
      const labelled = code.matchAll(/\b(?:aria-label|title|placeholder)=["']([^"'{}]{4,})["']/g);
      for (const match of labelled) {
        if (/[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(match[1]!)) {
          problems.push(`hardcodes user-facing text "${match[1]!.slice(0, 40)}"`);
        }
      }
      return problems;
    },
  },

  {
    id: 'FE6',
    description: 'design-system must not import education, features or pages.',
    // The dependency direction that keeps primitives reusable. A Button that
    // imports a mastery type is no longer a Button.
    applies: (p) => inDir(p, 'design-system'),
    check: (_p, content) =>
      imports(content)
        .filter((i) => /(?:^|\/)(education|features|pages)\//.test(i))
        .map((i) => `imports "${i}" — the design system may not depend on product layers`),
  },

  {
    id: 'FE7',
    description: 'The frontend must not import backend source.',
    // The backend is Node-only and Prisma-bound. Importing it would drag
    // server code into a browser bundle and couple the UI to a schema.
    applies: () => true,
    check: (_p, content) =>
      imports(content)
        .filter((i) => /(^|\/)\.\.\/(\.\.\/)*src\//.test(i) || i.includes('@prisma/client'))
        .map((i) => `imports "${i}" — the frontend may not reach into backend source`),
  },

  {
    id: 'FE8',
    description: 'No educational arithmetic in the UI.',
    // The rule that matters most. Mastery, scores and progress have exactly
    // one owner, and a plausible-looking average in a component is how a
    // product ends up showing two different numbers for the same concept.
    applies: (p) =>
      (p.endsWith('.ts') || p.endsWith('.tsx')) &&
      !inDir(p, 'shared', 'format') &&
      !p.startsWith('test' + sep),
    check: (_p, content) => {
      const code = stripCommentsAndStrings(content);
      const problems: string[] = [];

      // Arithmetic on an educational quantity, in either operand order.
      const quantity =
        '(?:mastery|score|xp|points|progress|completion|difficulty|weight|correct|attempts)';
      const arithmetic = new RegExp(
        `\\b\\w*${quantity}\\w*\\s*[*/+-]\\s*\\w|\\b\\w\\s*[*/+-]\\s*\\w*${quantity}\\w*\\b`,
        'i',
      );
      if (arithmetic.test(code)) {
        problems.push('performs arithmetic on an educational quantity — read the server value');
      }

      // Aggregation over a collection of educational values.
      if (/\.reduce\s*\([^)]*\b(?:mastery|score|xp|points|progress)\b/i.test(code)) {
        problems.push('aggregates educational values — the backend computes these');
      }
      return problems;
    },
  },

  {
    id: 'FE9',
    description: 'No educational decision logic in the UI.',
    // Deciding *which* activity comes next, or whether something is overdue,
    // is a domain verdict. The UI renders the verdict it was given.
    applies: (p) => p.endsWith('.ts') || p.endsWith('.tsx'),
    check: (_p, content) => {
      const code = stripCommentsAndStrings(content);
      const problems: string[] = [];

      if (/\bnow\s*[<>]=?\s*\w*(?:due|deadline)\w*|\w*(?:due|deadline)\w*\s*[<>]=?\s*\w*now\b/i.test(code)) {
        problems.push('derives overdue from a date — read the status the backend returned');
      }
      if (/\bisOverdue\s*=|\bconst\s+overdue\s*=/i.test(code)) {
        problems.push('computes an overdue flag — Instruction owns this');
      }
      if (/\b\w*mastery\w*\s*[<>]=?\s*(?:0?\.\d+|\w*threshold\w*)/i.test(code)) {
        problems.push('compares mastery against a threshold — Mastery owns this verdict');
      }
      return problems;
    },
  },

  {
    id: 'FE10',
    description: 'Role checks must not be presented as security.',
    // Hiding a button is a convenience. Naming it `canDelete` invites a reader
    // to believe the client enforced something, which it never can.
    applies: (p) => p.endsWith('.tsx') || p.endsWith('.ts'),
    check: (_p, content) => {
      const code = stripCommentsAndStrings(content);
      return /\b(?:isAuthorized|isAllowed|hasPermission|canAccess)\b/.test(code)
        ? [
            'names a client-side check as authorization — the backend is the only boundary; ' +
              'use presentation wording such as showsX',
          ]
        : [];
    },
  },

  {
    id: 'FE11',
    description: 'Each capability has one API module — no duplicate client paths.',
    // The backend's single-writer discipline, applied to reads: two modules
    // calling the same capability drift in how they shape and cache it.
    applies: (p) => inDir(p, 'shared', 'api'),
    check: (p, content) => {
      if (p === join('shared', 'api', 'client.ts')) return [];
      const code = stripCommentsAndStrings(content);
      return /\bBASE\s*=|['"]\/api\/v1/.test(code)
        ? ['re-declares the API base — import the shared client']
        : [];
    },
  },

  {
    id: 'FE12',
    description: 'No giant components: a file over 400 lines or 12 useState calls.',
    // The legacy failure being avoided is the modal holding dozens of
    // unrelated states and several workflows. Thresholds are generous on
    // purpose — this should catch a genuine monolith, not ordinary work.
    applies: (p) => p.endsWith('.tsx'),
    check: (_p, content) => {
      const problems: string[] = [];
      const lines = content.split('\n').length;
      if (lines > 400) problems.push(`is ${lines} lines — split it by responsibility`);

      const states = (stripCommentsAndStrings(content).match(/\buseState\s*[<(]/g) ?? []).length;
      if (states > 12) problems.push(`declares ${states} useState calls — extract a feature flow`);
      return problems;
    },
  },
  {
    id: 'FE14',
    description: 'No raw *Id field may be rendered as visible text without a name lookup.',
    // A field ending in "Id" is a database identifier, not a fact a user
    // reads — see §2.1/§2.2 of the production plan, which named three
    // teacher screens that leaked a raw schoolId into the DOM. A business
    // *Key* (MATH, G07 — a stable human-legible code) is fine; an internal
    // *Id* is not, because nothing about it was ever meant to be seen.
    //
    // Only a JSX *text child* is checked — a `{expr}` sitting directly
    // between two tags (`>{expr}<`), which is the one position that puts an
    // expression's value on the page as visible text. `id={x}`, `key={x}`,
    // `value={x}`, an import specifier, a hook's destructured state — none
    // of those are JSX children, so they never match this shape.
    applies: (p) => p.endsWith('.tsx') && !p.endsWith('.test.tsx'),
    check: (_p, content) => {
      const code = stripComments(content);
      const problems: string[] = [];
      const pattern = />\s*\{([^{}]*)\}\s*</g;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(code)) !== null) {
        const expr = match[1]!.trim();
        if (!expr) continue;
        // The expression's final identifier segment — the thing actually
        // rendered — after stripping a `?? fallback` and a wrapping call
        // such as `String(...)`.
        const last = expr.split('??')[0]!.trim();
        const tail = /([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\)*\s*$/.exec(last)?.[1];
        if (!tail) continue;
        if (/Key$/.test(tail)) continue; // a business key is meant to be shown
        if (!/(?:^id|[a-z0-9])Id$/.test(tail)) continue;
        if (tail === 'id' || tail === 'Id') continue; // a loop/local counter, not a field
        problems.push(`renders \`${tail}\` as text — resolve it to a name before display, or read it via a *Key`);
      }
      return problems;
    },
  },

  {
    id: 'FE13',
    description: 'Every semantic tone is legible both as text on its -subtle pair and under white.',
    // Contrast is arithmetic, so it is checkable, so it is checked. Picking a
    // tone by eye silently fails one of its two real usages: before this rule
    // existed, `warning` was 3.18:1 under white text and `success`, `info`,
    // `accent` and `advisory` all failed as text on their own subtle
    // background. Both usages ship in this product.
    applies: (p) => p === join('design-system', 'tokens', 'tokens.css'),
    check: (_p, content) => {
      const problems: string[] = [];

      for (const [themeName, block] of themeBlocks(content)) {
        const decls = oklchDeclarations(block);
        for (const [name, value] of decls) {
          if (!name.endsWith('-subtle')) continue;
          // `--color-text-subtle` is a third text weight, not a background for
          // `--color-text`. Name collision only.
          if (name === '--color-text-subtle') continue;
          // `--color-surface-subtle` is a step of the surface ladder (between
          // `surface` and `surface-sunken`), not a tinted background meant to
          // hold `surface`-coloured text. Same collision as text-subtle above.
          if (name === '--color-surface-subtle') continue;
          const base = decls.get(name.slice(0, -'-subtle'.length));
          if (!base) continue;

          const onSubtle = contrast(base, value);
          if (onSubtle < 4.5) {
            problems.push(
              `${themeName}: ${name.slice(0, -'-subtle'.length)} on ${name} is ` +
                `${onSubtle.toFixed(2)}:1 — unreadable as text (need 4.5)`,
            );
          }
        }

        // The three-layer ladder must be a real ladder. This regressed once
        // already: `surface` and `surface-raised` were both `oklch(1 0 0)`,
        // so every dialog and popover sat flat on the page. Names are not
        // depth.
        for (const [lower, upper] of [
          ['--color-canvas', '--color-surface'],
          ['--color-surface', '--color-surface-raised'],
        ] as const) {
          const a = decls.get(lower);
          const b = decls.get(upper);
          if (!a || !b) continue;
          if (contrast(a, b) < 1.02) {
            problems.push(
              `${themeName}: ${lower} and ${upper} are visually identical ` +
                `(${contrast(a, b).toFixed(3)}:1) — the surface ladder is not real`,
            );
          }
        }

        // White-on-solid only applies to the light theme, where solid fills
        // carry white text. The dark theme puts dark text on its brighter
        // fills, which `--color-text-on-accent` already encodes.
        if (themeName !== 'light') continue;
        for (const [name, value] of decls) {
          if (!SOLID_FILL_TONES.has(name)) continue;
          const onWhite = contrast([1, 0, 0], value);
          if (onWhite < 4.5) {
            problems.push(
              `${themeName}: white text on ${name} is ${onWhite.toFixed(2)}:1 (need 4.5)`,
            );
          }
        }
      }
      return problems;
    },
  },

  {
    id: 'FE15',
    description: 'Dependency direction must follow layers: pages → features → education → design-system, shared cross-cutting.',
    applies: (p) => p.endsWith('.ts') || p.endsWith('.tsx'),
    check: (p, content) => {
      const problems: string[] = [];
      const fileImports = imports(content);

      if (inDir(p, 'education', 'admin')) {
        problems.push('education/admin has been dismantled; all files must reside in features/ or design-system/');
      }

      if (inDir(p, 'education')) {
        for (const i of fileImports) {
          if (/(?:^|\/)pages\//.test(i)) {
            problems.push(`imports "${i}" — education/ may not depend on pages`);
          }
          if (/(?:^|\/)features\//.test(i) && !isUnmigratedLegacyEducation(p)) {
            problems.push(`imports "${i}" — education/ may not depend on features`);
          }
        }
      }

      if (inDir(p, 'features')) {
        for (const i of fileImports) {
          if (/(?:^|\/)pages\//.test(i)) {
            problems.push(`imports "${i}" — features/ may not depend on pages`);
          }
        }
      }

      if (inDir(p, 'shared')) {
        for (const i of fileImports) {
          if (/(?:^|\/)(pages|features|education)\//.test(i)) {
            problems.push(`imports "${i}" — shared/ may not reach up into product layers`);
          }
        }
      }

      return problems;
    },
  },

  {
    id: 'FE16',
    description: 'education/ is presentation only: no React Query, server state, or fetching hooks.',
    applies: (p) => inDir(p, 'education') && (p.endsWith('.ts') || p.endsWith('.tsx')),
    check: (p, content) => {
      const problems: string[] = [];
      if (inDir(p, 'education', 'admin')) {
        problems.push('education/admin must contain no files');
      }
      if (!isUnmigratedLegacyEducation(p)) {
        const fileImports = imports(content);
        for (const i of fileImports) {
          if (i.includes('@tanstack/react-query') || i.includes('swr')) {
            problems.push(`imports "${i}" — server state must reside in features/ or shared/api/`);
          }
        }
        const code = stripCommentsAndStrings(content);
        if (/\b(?:useQuery|useMutation|useQueryClient|useInfiniteQuery)\b/.test(code)) {
          problems.push('uses React Query hooks — education/ components must receive resolved data as props');
        }
      }
      return problems;
    },
  },

  {
    id: 'FE17',
    description: 'Feature API modules (*.api.ts) must live in features/ and must not be imported by education/.',
    applies: (p) => p.endsWith('.ts') || p.endsWith('.tsx'),
    check: (p, content) => {
      const problems: string[] = [];
      if (
        p.endsWith('.api.ts') &&
        !inDir(p, 'features') &&
        !inDir(p, 'shared', 'api') &&
        !isUnmigratedLegacyEducation(p)
      ) {
        problems.push('API module declared outside features/ or shared/api/');
      }
      if (inDir(p, 'education') && !isUnmigratedLegacyEducation(p)) {
        const fileImports = imports(content);
        for (const i of fileImports) {
          if (/\.api(\.ts)?$/.test(i) || i.includes('shared/api/client')) {
            problems.push(`imports API module "${i}" — education/ must not call APIs directly`);
          }
        }
      }
      return problems;
    },
  },

  {
    id: 'FE18',
    description: 'No role or session composition in education/ — presentation only.',
    applies: (p) => inDir(p, 'education') && (p.endsWith('.ts') || p.endsWith('.tsx')),
    check: (_p, content) => {
      const problems: string[] = [];
      const fileImports = imports(content);
      for (const i of fileImports) {
        if (i.includes('shared/auth/session')) {
          problems.push(`imports session from "${i}" — session/role composition belongs in pages/ or features/`);
        }
      }
      const code = stripCommentsAndStrings(content);
      if (/\b(?:useSession|hasRole|sessionRole)\b/.test(code)) {
        problems.push('reads session or evaluates roles — role composition belongs in pages/ or features/');
      }
      return problems;
    },
  },

  {
    id: 'FE19',
    description: 'Every navigation destination must have a concrete route in router.tsx.',
    applies: (p) => p === join('design-system', 'layout', 'navigation.ts'),
    check: (_p, content) => {
      const problems: string[] = [];
      const destMatches = [...content.matchAll(/to:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!);
      const uniqueDestinations = [...new Set(destMatches)];

      const routerPath = join(SRC, 'app', 'router.tsx');
      let routerContent = '';
      try {
        routerContent = readFileSync(routerPath, 'utf8');
      } catch {
        problems.push('cannot read src/app/router.tsx');
        return problems;
      }

      const routeMatches = [...routerContent.matchAll(/<Route\s+[^>]*\bpath=['"]([^'"]+)['"]/g)].map(
        (m) => m[1]!,
      );
      const concreteRoutes = new Set(routeMatches.filter((r) => !r.endsWith('*')));

      for (const dest of uniqueDestinations) {
        if (!concreteRoutes.has(dest)) {
          problems.push(`navigation destination "${dest}" has no concrete route entry in router.tsx`);
        }
      }

      return problems;
    },
  },
];

/* ── colour maths, for FE13 ───────────────────────────────────────────── */

/** Tones that get used as a solid fill under white text. */
const SOLID_FILL_TONES = new Set([
  '--color-accent',
  '--color-success',
  '--color-warning',
  '--color-danger',
  '--color-info',
  '--color-advisory',
  '--color-activity-remediate',
  '--color-activity-unblock',
  '--color-activity-learn',
  '--color-activity-practise',
  '--color-activity-advance',
]);

type Oklch = readonly [number, number, number];

/** oklch → linear sRGB → relative luminance → WCAG 2.1 contrast ratio. */
function oklchToLinearSrgb([L, C, H]: Oklch): [number, number, number] {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function luminance(colour: Oklch): number {
  const [r, g, b] = oklchToLinearSrgb(colour).map((v) => Math.min(1, Math.max(0, v)));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrast(a: Oklch, b: Oklch): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The theme declaration blocks, named by what each block DECLARES — its
 * `color-scheme` — not by where it sits.
 *
 * The base theme (`:root`) is dark in this product and light is the remap;
 * it was the other way round until the «Nebula» dark-first palette was
 * cloned in. Keying the checks off the selector silently inverted every
 * theme-specific assertion that day: the dark values were checked as if they
 * were light. A block that declares no `color-scheme` is not a theme block
 * and is skipped.
 */
function themeBlocks(css: string): ReadonlyArray<readonly [string, string]> {
  const out: Array<readonly [string, string]> = [];
  for (const opener of [':root {', "[data-theme='light'] {", "[data-theme='dark'] {"]) {
    const start = css.indexOf(opener);
    if (start === -1) continue;
    const end = css.indexOf('\n}', start);
    const block = css.slice(start, end === -1 ? undefined : end);
    const scheme = /color-scheme:\s*(light|dark)\s*;/.exec(block)?.[1];
    if (scheme !== 'light' && scheme !== 'dark') continue;
    out.push([scheme, block]);
  }
  return out;
}

/** Opaque `--name: oklch(L C H);` declarations. Alpha values are skipped. */
function oklchDeclarations(block: string): Map<string, Oklch> {
  const found = new Map<string, Oklch>();
  const pattern = /(--color-[a-z0-9-]+):\s*oklch\(\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s*\)/g;
  for (const match of block.matchAll(pattern)) {
    found.set(match[1]!, [Number(match[2]), Number(match[3]), Number(match[4])]);
  }
  return found;
}

/* ── runner ───────────────────────────────────────────────────────────── */

const files = walk(SRC).map((f) => relative(SRC, f));
let violations = 0;

for (const rule of RULES) {
  const failures: string[] = [];

  for (const file of files) {
    if (!rule.applies(file)) continue;
    const content = readFileSync(join(SRC, file), 'utf8');
    for (const problem of rule.check(file, content)) {
      failures.push(`      ${file}: ${problem}`);
    }
  }

  if (failures.length === 0) {
    console.log(`  ✓ ${rule.id.padEnd(4)} ${rule.description}`);
  } else {
    violations += failures.length;
    console.log(`  ✗ ${rule.id.padEnd(4)} ${rule.description}`);
    for (const failure of failures) console.log(failure);
  }
}

console.log('');
if (violations > 0) {
  console.log(`❌ ${violations} violation${violations === 1 ? '' : 's'}.`);
  process.exit(1);
}
console.log(`✅ No violations. ${RULES.length}/${RULES.length} rules pass.`);
