/**
 * Architecture fitness function.
 *
 * Layer rules that are only written in a document decay within weeks. These
 * rules are executable, run in CI, and fail the build. That is the difference
 * between an architecture and a wish.
 *
 *   npm run arch:check
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, 'src');

interface Rule {
  readonly id: string;
  readonly description: string;
  /** Files this rule applies to. */
  readonly applies: (path: string) => boolean;
  /** Return a violation message, or null when the file is fine. */
  readonly check: (path: string, content: string) => string[];
}

const isDomain = (p: string): boolean => p.includes(`${sep}domain${sep}`);
const isApplication = (p: string): boolean => p.includes(`${sep}application${sep}`);
const isInfrastructure = (p: string): boolean => p.startsWith(`infrastructure${sep}`);
const isInterface = (p: string): boolean => p.startsWith(`interface${sep}`);
const isContext = (p: string): boolean => p.startsWith(`contexts${sep}`);

/**
 * Strip comments and string literals before pattern checks.
 *
 * Without this the checker flags its own documentation — a rule that fires on
 * the sentence "no Date.now() here" is a rule nobody will keep.
 */
function stripCommentsAndStrings(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""');
}

/**
 * Strip comments but KEEP string literals.
 *
 * Rules that look for a literal value (rather than an identifier) need the
 * strings intact; stripCommentsAndStrings would blank the very thing they
 * match and pass unconditionally.
 */
function stripComments(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/** Extract every module specifier the file imports from. */
function imports(content: string): string[] {
  const out: string[] = [];
  const re = /(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) out.push((m[1] ?? m[2])!);
  return out;
}

const RULES: Rule[] = [
  {
    id: 'D1',
    description: 'Domain layer must be pure: no infrastructure, no I/O, no framework imports.',
    applies: isDomain,
    check: (_p, content) => {
      const banned = ['@prisma/client', 'express', 'zod', '@google/genai', 'node:fs', 'node:http', 'jsonwebtoken'];
      return imports(content)
        .filter((i) => banned.some((b) => i === b || i.startsWith(`${b}/`)))
        .map((i) => `imports "${i}" — domain must stay free of infrastructure`);
    },
  },
  {
    id: 'D2',
    description: 'Domain must not reach into infrastructure or interface folders.',
    applies: isDomain,
    check: (_p, content) =>
      imports(content)
        .filter((i) => i.includes('/infrastructure/') || i.includes('/interface/'))
        .map((i) => `imports "${i}" — inward dependency violation`),
  },
  {
    id: 'D3',
    description: 'Domain must be deterministic: no Date.now(), new Date() or Math.random().',
    applies: isDomain,
    check: (_p, content) => {
      const code = stripCommentsAndStrings(content);
      const problems: string[] = [];
      // `new Date(x)` with an argument is fine; a bare clock read is not.
      if (/\bDate\.now\(\)/.test(code)) problems.push('uses Date.now() — inject a Clock instead');
      if (/\bnew Date\(\s*\)/.test(code)) problems.push('uses new Date() — inject a Clock instead');
      if (/\bMath\.random\(\)/.test(code)) {
        problems.push('uses Math.random() — inject a random source instead');
      }
      return problems;
    },
  },
  {
    id: 'A1',
    description: 'Application layer must not import Prisma or any concrete adapter.',
    applies: isApplication,
    check: (_p, content) =>
      imports(content)
        .filter((i) => i === '@prisma/client' || i.includes('/infrastructure/'))
        .map((i) => `imports "${i}" — depend on a port, not an adapter`),
  },
  {
    id: 'A2',
    description: 'Application layer must not import Express.',
    applies: isApplication,
    check: (_p, content) =>
      imports(content)
        .filter((i) => i === 'express' || i.startsWith('express/'))
        .map((i) => `imports "${i}" — transport belongs to the interface layer`),
  },
  {
    id: 'C1',
    description: 'A context may only import another context\'s domain or application ports.',
    applies: (p) => isContext(p),
    check: (p, content) => {
      const ownContext = p.split(sep)[1];
      return imports(content)
        .filter((i) => i.includes('contexts/'))
        .filter((i) => {
          const m = /contexts\/([^/]+)\//.exec(i);
          return m && m[1] !== ownContext;
        })
        .filter((i) => !/(domain|application)\//.test(i))
        .map((i) => `imports "${i}" — cross-context access must go through domain types or ports`);
    },
  },
  {
    id: 'P1',
    description: 'Only infrastructure/database/prisma.client.ts may construct a PrismaClient.',
    applies: (p) => p.endsWith('.ts'),
    check: (p, content) => {
      if (p === join('infrastructure', 'database', 'prisma.client.ts')) return [];
      return /new PrismaClient\s*\(/.test(stripCommentsAndStrings(content))
        ? ['constructs PrismaClient — inject the shared client instead']
        : [];
    },
  },
  {
    id: 'P2',
    description: 'Prisma may only be used inside infrastructure.',
    applies: (p) => !isInfrastructure(p) && p !== join('composition', 'container.ts'),
    check: (_p, content) =>
      imports(content)
        .filter((i) => i === '@prisma/client')
        .map(() => 'imports @prisma/client outside infrastructure'),
  },
  {
    id: 'M1',
    description: 'ConceptMastery may only be written by the mastery repository.',
    applies: (p) => p !== join('infrastructure', 'database', 'mastery.repository.ts'),
    check: (_p, content) => {
      const re = /conceptMastery\s*\.\s*(create|createMany|update|updateMany|upsert|delete)/g;
      const hits = [...stripCommentsAndStrings(content).matchAll(re)].map((m) => m[1]!);
      return hits.map((op) => `calls conceptMastery.${op}() — mastery has exactly one write path`);
    },
  },
  {
    id: 'QP1',
    description:
      'Question provenance is descriptive metadata; it must not become a learning rule.',
    // The critical boundary from the provenance audit. `origin` exists so a
    // teacher can filter the bank and see where an item came from. The moment a
    // selection path reads it — "exclude textbook exercises from practice" — it
    // stops being metadata and becomes pedagogy, decided silently inside a
    // repository query instead of in a policy anyone can find. That is exactly
    // how legacy ended up with learning rules buried in adapters.
    //
    // A future product rule of that shape is legitimate; it belongs to
    // Learning/Assessment as an explicit, tested policy, and this rule is what
    // forces that conversation to happen.
    applies: (p) =>
      p.startsWith(join('contexts', 'assessment')) ||
      p.startsWith(join('contexts', 'mastery')) ||
      p.startsWith(join('contexts', 'learning')) ||
      p === join('infrastructure', 'database', 'assessment.repository.ts') ||
      p === join('infrastructure', 'database', 'learning.repository.ts') ||
      p === join('infrastructure', 'database', 'mastery.repository.ts'),
    check: (_p, content) => {
      // stripComments, NOT stripCommentsAndStrings: this rule matches literal
      // values like origin: 'TEXTBOOK', and blanking string literals would make
      // it pass unconditionally.
      const code = stripComments(content);
      const problems: string[] = [];

      if (/\btextbookRole\b/.test(code)) {
        problems.push(
          'reads textbookRole — question provenance must not drive a learning decision',
        );
      }
      // Narrow on purpose: `origin` alone is too common a word (AssignmentOrigin
      // is a legitimate Instruction concept), so this targets the question
      // field specifically.
      if (/QuestionOrigin|question\s*:\s*\{[^}]*origin|origin\s*:\s*'(TEXTBOOK|AI)'/.test(code)) {
        problems.push(
          'references question origin — provenance is descriptive, not a selection rule',
        );
      }

      return problems;
    },
  },
  {
    id: 'MW1',
    description:
      'Misconception state may only be written by the mastery repository, and never asserted.',
    // Same single-writer reasoning as M1, and the same failure it prevents.
    // `learner_misconceptions` is derived from the evidence stream; a second
    // writer means two disagreeing answers about whether a learner holds a
    // wrong model. The legacy writer incremented `confidence + 0.1` in place
    // from an analytics repository, which made the value depend on how many
    // times it had run rather than on the evidence.
    //
    // This also bans asserting resolution from a route or service: a teacher
    // declaring a misconception fixed is `PATCH {masteryAchieved}` in a new
    // costume. Resolution follows evidence, exactly as remediation does.
    applies: (p) => p !== join('infrastructure', 'database', 'mastery.repository.ts'),
    check: (_p, content) => {
      const code = stripCommentsAndStrings(content);
      const problems: string[] = [];

      const writes =
        /learnerMisconception\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)/g;
      for (const m of code.matchAll(writes)) {
        problems.push(
          `calls learnerMisconception.${m[1]}() — misconception state has exactly one write path`,
        );
      }

      // Catches the assertion even when it reaches the table indirectly.
      if (/isResolved\s*:\s*true/.test(code)) {
        problems.push(
          'asserts isResolved: true — a misconception is cleared by evidence, never declared',
        );
      }

      return problems;
    },
  },
  {
    id: 'CW1',
    description: 'The content tree has exactly one write path: content.repository.ts.',
    // Same reasoning as M1. Legacy wrote content from a dozen services, so the
    // publish lock had to be re-implemented at each of them — and was not.
    // A single writer means the lifecycle guard cannot be bypassed by
    // reaching for a different repository.
    applies: (p) =>
      p !== join('infrastructure', 'database', 'content.repository.ts') &&
      !p.startsWith(join('prisma')),
    check: (_p, content) => {
      const re =
        /\b(?:textbook|unit|lesson|concept|conceptPrerequisite)\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/g;
      return [...stripCommentsAndStrings(content).matchAll(re)].map(
        (m) => `writes content via .${m[1]}() — content has exactly one write path`,
      );
    },
  },
  {
    id: 'IW1',
    description:
      'The Instruction adapter may write only plans and obligations — never evidence.',
    // M1 already protects ConceptMastery, but Instruction sits next to the
    // evidence stream and the tempting shortcut is to "just mark the attempt
    // done" while materialising. Legacy did exactly that and produced
    // obligations whose completion no assessment had ever justified. This
    // enumerates what the adapter may touch instead of blacklisting what it
    // may not, so a new evidence table is refused by default.
    applies: (p) => p === join('infrastructure', 'database', 'instruction.repository.ts'),
    check: (_p, content) => {
      const allowed = new Set(['instructionalPlan', 'learnerObligation']);
      const re =
        /\b(\w+)\s*\.\s*(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/g;
      return [...stripCommentsAndStrings(content).matchAll(re)]
        .map((m) => m[1]!)
        .filter((model) => !allowed.has(model))
        .map(
          (model) =>
            `writes ${model} — Instruction records what was asked; ` +
            'evidence of what was done belongs to Assessment and Mastery',
        );
    },
  },
  {
    id: 'RW1',
    description:
      'Remediation episodes may be written only by the remediation adapter, and never closed by fiat.',
    // Two failures at once, both of them legacy's:
    //   1. `remediationEpisode` written from a second adapter would repeat the
    //      ConceptMastery story — five writers, no agreed truth.
    //   2. A direct `status: 'RESOLVED'` anywhere means someone can declare a
    //      gap closed without evidence, which is exactly the PATCHable
    //      `masteryAchieved` this capability exists to correct.
    // The adapter itself is allowed to set the status, because it does so only
    // inside applyDetection/supersedeForConcepts.
    applies: (p) =>
      p.startsWith(join('infrastructure', 'database')) &&
      p !== join('infrastructure', 'database', 'remediation.repository.ts'),
    check: (_p, content) => {
      const re =
        /\bremediationEpisode\s*\.\s*(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/g;
      return [...stripCommentsAndStrings(content).matchAll(re)].map(
        () =>
          'writes remediationEpisode — episodes are opened and closed by evidence ' +
          'through remediation.repository.ts, not from other adapters',
      );
    },
  },
  {
    id: 'RW2',
    description: 'No route or service may resolve a remediation episode directly.',
    // Reaches beyond the adapter: an application service that sets RESOLVED on
    // its own has re-invented the manual close, whatever it calls the method.
    applies: (p) =>
      (p.startsWith(join('interface')) || p.includes(join('application'))) &&
      p.endsWith('.ts'),
    check: (_p, content) => {
      const body = stripComments(content);
      const out: string[] = [];
      if (/\bstatus\s*:\s*['"`]RESOLVED['"`]/.test(body)) {
        out.push(
          "sets status: 'RESOLVED' — an episode closes when the evidence says so, " +
            'via RemediationService.refresh',
        );
      }
      return out;
    },
  },
  {
    id: 'FW1',
    description: 'Flashcards may be written only by the flashcard adapter.',
    // Same single-writer discipline as content (CW1), mastery (M1),
    // instruction (IW1) and remediation (RW1). Cards carry no per-learner
    // state, and the way that stays true is that no learner-facing adapter can
    // write them at all.
    applies: (p) =>
      p.startsWith(join('infrastructure', 'database')) &&
      p !== join('infrastructure', 'database', 'item-bank.repository.ts'),
    check: (_p, content) => {
      const re =
        /\bflashcard\s*\.\s*(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/g;
      return [...stripCommentsAndStrings(content).matchAll(re)].map(
        () =>
          'writes flashcard — cards are authored through item-bank.repository.ts; ' +
          'Learning only reads them',
      );
    },
  },
  {
    id: 'XW1',
    description: 'The XP ledger may be written only by the engagement adapter, and only appended.',
    // Two rules in one, both legacy failures. A second writer repeats the
    // ConceptMastery story; an update or delete means points already earned can
    // be quietly revised, which is worse than never awarding them.
    applies: (p) =>
      p.startsWith(join('infrastructure', 'database')) &&
      p !== join('infrastructure', 'database', 'engagement.repository.ts'),
    check: (_p, content) => {
      const re =
        /\bxpLedgerEntry\s*\.\s*(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/g;
      return [...stripCommentsAndStrings(content).matchAll(re)].map(
        () => 'writes xpLedgerEntry — XP is appended through engagement.repository.ts only',
      );
    },
  },
  {
    id: 'XW2',
    description: 'The XP ledger is append-only: no update, no delete, anywhere.',
    applies: (p) => p.endsWith('.ts'),
    check: (_p, content) => {
      const re =
        /\bxpLedgerEntry\s*\.\s*(?:update|updateMany|upsert|delete|deleteMany)\s*\(/g;
      return [...stripCommentsAndStrings(content).matchAll(re)].map(
        () =>
          'mutates xpLedgerEntry — the ledger is append-only; ' +
          'a correction is a new compensating entry, not an edit',
      );
    },
  },
  {
    id: 'NS1',
    description:
      'Learning next-step is purely pedagogical: it may not read assignments or obligations.',
    // The owner's ruling, made structural: outstanding or overdue work must not
    // influence the adaptive recommendation, "not even as a hidden branch".
    // Due Work is a separate capability (instruction/application/due-work.service.ts)
    // precisely so that lateness never becomes a pedagogical input. The
    // temptation this rule resists is real and cheap to give in to — one
    // `if (hasOverdueWork)` inside decideNextActivity would silently turn an
    // administrative fact into a learning conclusion.
    applies: (p) => p.startsWith(join('contexts', 'learning') + sep),
    check: (p, content) => {
      const code = stripCommentsAndStrings(content);
      const banned = /\b(obligation|Obligation|assignment|Assignment|instructionalPlan|InstructionalPlan|dueAt|overdue|Overdue)\b/g;
      const hits = [...new Set([...code.matchAll(banned)].map((m) => m[0]))];
      return hits.length === 0
        ? []
        : [
            `${p} references ${hits.join(', ')}. Learning's recommendation must depend on ` +
              'mastery and prerequisites only; outstanding work belongs to Due Work.',
          ];
    },
  },
  {
    id: 'AW1',
    description:
      'Analytics is a projection: its adapter may only write cached question statistics.',
    // The legacy "dashboard service" computed its own mastery on the way to
    // rendering it, which is how one concept showed two different masteries on
    // two screens. A report that writes is no longer a report. The three
    // counters below are the documented exception — a cache of the responses,
    // recomputable from them at any time.
    applies: (p) => p === join('infrastructure', 'database', 'analytics.repository.ts'),
    check: (_p, content) => {
      const allowedFields = new Set(['timesAdministered', 'correctRate', 'avgSecondsToAnswer']);
      const code = stripCommentsAndStrings(content);

      const writes = [
        ...code.matchAll(
          /\b(\w+)\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/g,
        ),
      ];

      const problems = writes
        .filter((m) => !(m[1] === 'question' && m[2] === 'update'))
        .map(
          (m) =>
            `writes ${m[1]}.${m[2]}() — Analytics reports on evidence, it never produces it`,
        );

      // The one permitted write must stay confined to the cached counters.
      const dataBlock = /data:\s*\{([\s\S]*?)\}/.exec(code);
      if (dataBlock) {
        for (const field of dataBlock[1]!.matchAll(/(\w+)\s*:/g)) {
          if (!allowedFields.has(field[1]!)) {
            problems.push(
              `question.update() sets "${field[1]}" — only cached statistics may be projected`,
            );
          }
        }
      }

      return problems;
    },
  },
  {
    id: 'G1',
    description:
      'Engagement is a terminal sink: no pedagogical context may import from it.',
    applies: (p) =>
      ['mastery', 'assessment', 'learning', 'content'].some((c) =>
        p.startsWith(join('contexts', c) + sep),
      ),
    check: (_p, content) =>
      imports(content)
        .filter((i) => i.includes('/engagement/') || i.includes('contexts/engagement'))
        .map(
          (i) =>
            `imports "${i}" — XP, streaks and badges must never influence mastery, ` +
            'grading, eligibility or adaptive decisions',
        ),
  },
  {
    id: 'M2',
    description:
      'Instruction must not store mastery: an obligation records status, never achievement.',
    applies: (p) => p.startsWith(join('contexts', 'instruction') + sep),
    check: (_p, content) => {
      // Legacy StudentAssignment carried `masteryAchieved`, written by
      // markProgress() — a fifth mastery write path, and the reason one
      // concept could show two different masteries on two screens.
      const re = /\b(masteryAchieved|masteryValue|storedMastery)\b/g;
      const hits = [...stripCommentsAndStrings(content).matchAll(re)].map((m) => m[1]!);
      return hits.map(
        (f) => `declares "${f}" — Instruction reads mastery, it never stores it`,
      );
    },
  },
  {
    id: 'I1',
    description: 'Interface layer must not import Prisma or use-case internals directly.',
    applies: isInterface,
    check: (_p, content) =>
      imports(content)
        .filter((i) => i === '@prisma/client' || i.includes('/infrastructure/'))
        .map((i) => `imports "${i}" — routes receive use cases from the container`),
  },
  {
    id: 'V1',
    description: 'Vocabulary: the curriculum root is a Textbook — "curriculum" is legacy language.',
    // The legacy system used "curriculum" and "textbook" for the same thing,
    // with two key generators and three status constants to match. One word.
    applies: (p) => p.endsWith('.ts'),
    check: (_p, content) =>
      /curriculum/i.test(stripCommentsAndStrings(content))
        ? ['uses "curriculum" — the canonical term for the content root is Textbook']
        : [],
  },
  {
    id: 'PUB1',
    description:
      'Learner-facing content reads must filter through published-content.ts, not a literal status.',
    // Legacy checked `status: 'PUBLISHED'` on questions and nowhere else, so a
    // DRAFT textbook was fully teachable while appearing guarded. One shared
    // filter, derived from the domain predicate, or the guard drifts again.
    applies: (p) =>
      p.startsWith(join('infrastructure', 'database')) &&
      !p.endsWith(join('database', 'published-content.ts')),
    check: (_p, content) => {
      // Strings must survive here — the rule matches a literal status value.
      const src = stripComments(content);
      // A textbook/unit/lesson/concept read that hardcodes a publication state
      // instead of composing the shared fragment.
      return /status:\s*['"](?:PUBLISHED|DRAFT|IN_REVIEW|ARCHIVED)['"]/.test(src) &&
        !/published(?:Textbook|Unit|Lesson|Concept)/.test(src)
        ? [
            'hardcodes a publication status — compose publishedConcept/Lesson/Unit/Textbook instead',
          ]
        : [];
    },
  },
  {
    id: 'K1',
    description: 'Key derivation must never take an orderIndex — identity is not a position.',
    // Reordering content is routine. If a key moved with orderIndex, every
    // stored conceptKey, decision log, grounding chunk and export would
    // silently rebind to a different concept. See docs/KEY-IDENTITY-AUDIT.md.
    applies: (p) => p === join('shared', 'kernel', 'identifiers.ts'),
    check: (_p, content) => {
      const src = stripCommentsAndStrings(content);
      const offenders: string[] = [];
      // Any exported *Key function taking an `order`/`index`/`orderIndex` arg.
      const fn = /export function (\w*[Kk]ey)\s*\(([^)]*)\)/g;
      let m: RegExpExecArray | null;
      while ((m = fn.exec(src)) !== null) {
        if (/\b(order|orderIndex|index|position|sequence|seq)\b/i.test(m[2] ?? '')) {
          offenders.push(`${m[1]}() takes a position — keys must derive from a frozen slug`);
        }
      }
      return offenders;
    },
  },
  {
    id: 'L1',
    description:
      'Routes must resolve the learner through learner-access.ts, never read actor.learnerKey.',
    // Authorization logic that is copied per route diverges per route. One
    // resolver means one place to audit when the rule changes.
    applies: (p) =>
      p.startsWith(join('interface', 'http')) && !p.endsWith(join('http', 'learner-access.ts')),
    check: (_p, content) =>
      /actor\??\.learnerKey/.test(stripCommentsAndStrings(content))
        ? ['reads actor.learnerKey directly — use resolveLearnerKey() or requireSelfLearner()']
        : [],
  },
  {
    id: 'E1',
    description: 'process.env may only be read in shared/config and prisma.config.ts.',
    applies: (p) => !p.startsWith(join('shared', 'config')) && p !== 'main.ts',
    check: (_p, content) =>
      /process\.env\./.test(stripCommentsAndStrings(content))
        ? ['reads process.env — use the validated Env object']
        : [],
  },
];

/**
 * The development sign-in box must offer exactly the seeded accounts.
 *
 * This is a cross-file consistency rule, not a per-file one, so it runs
 * outside the `src/` walk above: the two files live in different projects
 * (`prisma/seed/data` and `web/src`) and neither can import the other.
 *
 * It is checked because the failure is quiet and misleading. A button whose
 * username no longer exists in the seed returns a 401 that looks like a broken
 * login rather than a stale list, and an account that exists but has no button
 * is one nobody remembers to test — which is how `superadmin` and `reviewer`,
 * the two accounts that exist specifically to prove an authorization boundary
 * and a two-person review, went unused.
 */
function checkDemoAccounts(): string[] {
  const seedPath = join(ROOT, 'prisma', 'seed', 'data', 'demo-users.json');
  const devPath = join(ROOT, 'web', 'src', 'features', 'auth', 'demo-credentials.dev.ts');

  const seeded = (
    JSON.parse(readFileSync(seedPath, 'utf8')) as { User: { username: string }[] }
  ).User.map((user) => user.username);

  const source = readFileSync(devPath, 'utf8');
  const offered = [...source.matchAll(/login:\s*'([^']+)'/g)].map((match) => match[1]!);

  const problems: string[] = [];
  for (const username of seeded) {
    if (!offered.includes(username)) {
      problems.push(`seeded account "${username}" has no button in demo-credentials.dev.ts`);
    }
  }
  for (const username of offered) {
    if (!seeded.includes(username)) {
      problems.push(`demo-credentials.dev.ts offers "${username}", which the seed does not create`);
    }
  }
  return problems;
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) acc.push(full);
  }
  return acc;
}

function main(): void {
  const files = walk(SRC);
  const violations: { rule: Rule; file: string; message: string }[] = [];

  for (const file of files) {
    const rel = relative(SRC, file);
    const content = readFileSync(file, 'utf8');
    for (const rule of RULES) {
      if (!rule.applies(rel)) continue;
      for (const message of rule.check(rel, content)) {
        violations.push({ rule, file: rel, message });
      }
    }
  }

  for (const message of checkDemoAccounts()) {
    violations.push({
      rule: {
        id: 'DEV1',
        description: 'The dev sign-in box must offer exactly the seeded demo accounts.',
        applies: () => false,
        check: () => [],
      },
      file: 'web/src/features/auth/demo-credentials.dev.ts',
      message,
    });
  }

  console.log(`\nArchitecture check — ${files.length} files, ${RULES.length} rules\n`);

  if (violations.length === 0) {
    for (const rule of RULES) console.log(`  ✓ ${rule.id}  ${rule.description}`);
    console.log(`\n✅ No violations.\n`);
    return;
  }

  const byRule = new Map<string, typeof violations>();
  for (const v of violations) {
    const list = byRule.get(v.rule.id) ?? [];
    list.push(v);
    byRule.set(v.rule.id, list);
  }

  for (const rule of RULES) {
    const hits = byRule.get(rule.id);
    if (!hits) {
      console.log(`  ✓ ${rule.id}  ${rule.description}`);
      continue;
    }
    console.log(`  ✗ ${rule.id}  ${rule.description}`);
    for (const h of hits) console.log(`      ${h.file}: ${h.message}`);
  }

  console.error(`\n❌ ${violations.length} architecture violation(s).\n`);
  process.exit(1);
}

main();
