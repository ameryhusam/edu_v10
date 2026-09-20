#!/usr/bin/env node
/**
 * Convert the legacy `eduinsight/curriculum-template@2.0` files into canonical
 * `ContentPackage` JSON.
 *
 * What this script is NOT: it never opens a database, never imports Prisma and
 * never writes content. It reads JSON and writes JSON. Everything that reaches
 * the database goes through `POST /content/textbooks/import`, which routes to
 * `ContentAuthoringService` — the same path the HTTP API uses. An importer is
 * a bulk adapter, never a second write path; legacy made 19 direct Prisma
 * calls from its importer and ended up with two definitions of valid content.
 *
 * Determinism is a hard requirement: running this twice on unchanged input
 * must produce byte-identical output, or a diff is useless as a review tool
 * and re-importing is not provably idempotent.
 *
 * It also refuses to guess. Where the legacy data does not say something, this
 * script fails loudly or leaves the field null; it never invents pedagogy.
 *
 *   node scripts/convert-legacy-curriculum.mjs --subject math --edition 2026
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
// The old system now lives under legacy/ rather than at the repository root.
// It is kept, not deleted, precisely so conversions like this one can still
// read the source data and so behaviour can be diffed against it during
// development.
const LEGACY = resolve(REPO, 'legacy/data/demo');
const OUT = resolve(HERE, '../content-packages');

const MAX_SLUG_LENGTH = 32;

/**
 * The subjects that exist, mapped to the canonical subject code used in a
 * textbook key. Only `math` and `science` carry real content; the rest are
 * one-unit stubs and are converted only so the gap is visible rather than
 * hidden.
 */
const SUBJECTS = {
  math: { code: 'MATH', title: 'الرياضيات' },
  science: { code: 'SCI', title: 'العلوم' },
  arabic: { code: 'ARAB', title: 'اللغة العربية' },
  english: { code: 'ENG', title: 'اللغة الإنجليزية' },
  islamic: { code: 'ISL', title: 'التربية الإسلامية' },
  geography: { code: 'GEO', title: 'الجغرافيا' },
  civics: { code: 'CIV', title: 'التربية الوطنية' },
};

/**
 * Legacy `remedials[].contentType` → canonical `ResourceKind`.
 *
 * Declared explicitly rather than coerced. An unmapped value is a hard error:
 * silently defaulting it would file a worked example as a reading and quietly
 * change what remediation shows a struggling learner.
 */
const RESOURCE_KIND = {
  ANALOGY: 'WORKED_EXAMPLE',
  WORKED_EXAMPLE: 'WORKED_EXAMPLE',
  EXAMPLE: 'WORKED_EXAMPLE',
  EXPLANATION: 'READING',
  READING: 'READING',
  TEXT: 'READING',
  VIDEO: 'VIDEO',
  REMEDIAL: 'REMEDIAL',
};

/** Mirrors `normalizeSlug` in the kernel. Letters of any script survive. */
function normalizeSlug(raw) {
  return String(raw ?? '')
    .normalize('NFKC')
    .trim()
    .toUpperCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * A slug that fits.
 *
 * Ten legacy names exceed 32 characters. Truncating mid-word would produce an
 * unreadable identifier, so the cut falls back to the last separator — but
 * only if that leaves at least 16 characters, otherwise a long first word
 * would collapse the slug to almost nothing. Verified collision-free across
 * all 7 subjects; a collision is still checked for at the end and is fatal.
 */
function toSlug(name, what) {
  const full = normalizeSlug(name);
  if (!full) die(`cannot derive a slug from ${what}: ${JSON.stringify(name)}`);
  if (full.length <= MAX_SLUG_LENGTH) return full;
  let cut = full.slice(0, MAX_SLUG_LENGTH);
  const lastDash = cut.lastIndexOf('-');
  if (lastDash >= 16) cut = cut.slice(0, lastDash);
  return cut.replace(/-+$/, '');
}

/**
 * The same FNV-1a fingerprint `src/shared/kernel/identifiers.ts` uses.
 *
 * Duplicated rather than imported because this script is plain ESM with no
 * build step and the kernel is TypeScript. Kept byte-identical on purpose: the
 * advisory `key` this produces should match what the importer derives, so a
 * package and its re-export line up on inspection.
 */
function fingerprint(value, length = 8) {
  const normalized = String(value ?? '').trim().normalize('NFKC').toLowerCase();
  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0').slice(0, length);
}

function die(message) {
  console.error(`\n  convert: ${message}\n`);
  process.exit(1);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** `--subject math --edition 2026` */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) out[a.slice(2)] = argv[i + 1];
  }
  return out;
}

function convert(subject, edition) {
  const meta = SUBJECTS[subject];
  if (!meta) die(`unknown subject "${subject}". Known: ${Object.keys(SUBJECTS).join(', ')}`);

  const hierarchy = readJson(`${LEGACY}/yemeni-${subject}-7th-canonical-hierarchy.json`);
  const questionsFile = readJson(`${LEGACY}/yemeni-${subject}-7th-canonical-questions.json`);
  const prereqFile = readJson(`${LEGACY}/yemeni-${subject}-7th-canonical-prerequisites.json`);

  const ctx = hierarchy.context ?? {};
  const grade = String(ctx.gradeLevel ?? 7).padStart(2, '0');
  const term = String(ctx.termNumber ?? 1);
  const textbookKey = `EDU-${meta.code}-G${grade}-T${term}-ED${edition}`;

  /**
   * Keys are DERIVED by the importer, not supplied by it — `key` is in
   * NON_IMPORTABLE_FIELDS. They are still reported, exactly as a real export
   * reports them, because `checkPackageIntegrity` resolves prerequisite edges
   * against `concept.key`. Leaving them blank made every edge look like a
   * dangling reference.
   */
  const units = [];
  const lessons = [];
  const concepts = [];
  const misconceptions = [];
  const learningResources = [];

  /** legacy key -> canonical slug path, so questions and edges can resolve. */
  const conceptPathByLegacyKey = new Map();
  const lessonPathByLegacyKey = new Map();

  for (const unit of hierarchy.hierarchy.units) {
    const unitSlug = toSlug(unit.name, 'unit name');
    units.push({
      key: `${textbookKey}-U-${unitSlug}`,
      slug: unitSlug,
      parentUnitSlug: null,
      name: unit.name,
      orderIndex: unit.orderIndex,
      startPage: unit.startPage ?? null,
      endPage: unit.endPage ?? null,
      isActive: true,
      // The legacy key is kept as provenance, never as identity. Identity is
      // derived from the name; this is what lets a reviewer trace a migrated
      // unit back to the printed curriculum.
      sourceRef: unit.unitKey ?? null,
    });

    for (const lesson of unit.lessons ?? []) {
      const lessonSlug = toSlug(lesson.name, 'lesson name');
      lessonPathByLegacyKey.set(lesson.lessonKey, { unitSlug, lessonSlug });
      lessons.push({
        key: `${textbookKey}-U-${unitSlug}-L-${lessonSlug}`,
        slug: lessonSlug,
        unitSlug,
        name: lesson.name,
        description: null,
        orderIndex: lesson.orderIndex,
        estimatedMins: lesson.estimatedTime ?? null,
        startPage: lesson.startPage ?? null,
        endPage: lesson.endPage ?? null,
        isActive: true,
        sourceRef: lesson.lessonKey ?? null,
      });

      for (const concept of lesson.concepts ?? []) {
        const conceptSlug = toSlug(concept.name, 'concept name');
        conceptPathByLegacyKey.set(concept.conceptKey, { unitSlug, lessonSlug, conceptSlug });
        concepts.push({
          key: `${textbookKey}-U-${unitSlug}-L-${lessonSlug}-C-${conceptSlug}`,
          slug: conceptSlug,
          lessonSlug,
          unitSlug,
          name: concept.name,
          description: concept.description ?? null,
          orderIndex: concept.orderIndex,
          difficulty: concept.difficulty ?? 0.5,
          importance: concept.importance ?? 0.5,
          masteryThreshold: concept.masteryThreshold ?? 0.85,
          isCore: concept.isCore ?? false,
          isActive: true,
          pageNumber: concept.pageNumber ?? null,
          sourceRef: concept.conceptKey ?? null,
          // Editorial content the previous converter dropped on the floor:
          // present for all 55 maths concepts, and not re-derivable later.
          nameEn: concept.nameEn ?? null,
          bloomsLevel: concept.bloomsLevel ?? null,
        });

        // G7: the 66 misconceptions and 122 remedials that had no home before.
        for (const mis of concept.misconceptions ?? []) {
          misconceptions.push({
            slug: toSlug(mis.title, 'misconception title'),
            unitSlug,
            lessonSlug,
            conceptSlug,
            name: mis.title,
            description: mis.description ?? mis.title,
            correction: mis.correctionText ?? null,
          });
        }

        for (const rem of concept.remedials ?? []) {
          const kind = RESOURCE_KIND[String(rem.contentType ?? '').toUpperCase()];
          if (!kind) {
            die(
              `unmapped remedial contentType "${rem.contentType}" on concept ` +
                `"${concept.conceptKey}". Add it to RESOURCE_KIND deliberately ` +
                `rather than letting it default.`,
            );
          }
          learningResources.push({
            slug: toSlug(rem.title, 'remedial title'),
            unitSlug,
            lessonSlug,
            conceptSlug,
            kind,
            title: rem.title,
            body: rem.content ?? null,
            url: null,
            orderIndex: rem.orderIndex ?? 1,
            pageStart: null,
            pageEnd: null,
            estimatedMins: null,
          });
        }
      }
    }
  }

  // ── Questions ─────────────────────────────────────────────────────────────
  const questions = [];
  for (const q of questionsFile.questions ?? []) {
    const lessonPath = lessonPathByLegacyKey.get(q.lessonKey);
    if (!lessonPath) die(`question ${q.questionKey} references unknown lesson ${q.lessonKey}`);

    // Local choice ids from orderIndex: c1..cN. Deterministic, and what
    // `answerKey.correctChoiceIds` references. The id stays 1-based because it
    // is a name, not a position — renumbering it would silently repoint the
    // answer key.
    //
    // `orderIndex` is emitted 0-based, which the legacy files are not. The
    // system counts positions from zero everywhere (see the item bank's
    // `choices.map((c, index) => ({ orderIndex: index }))`), so a 1-based
    // package is rewritten on ingest and the export then disagrees with the
    // file it came from. Normalising here makes the package say what will
    // actually be stored, which is what lets a round-trip compare equal.
    const choices = (q.choices ?? []).map((c, i) => ({
      id: `c${c.orderIndex ?? i + 1}`,
      text: c.text,
      orderIndex: i,
      // Never inferred. Legacy choices carry feedback but no misconception
      // reference (verified: 440 choices, 0 links). Guessing that a given
      // feedback string means a given named error would be inventing
      // pedagogy; linking distractors is an authoring task.
      misconceptionKey: null,
      feedback: c.feedback ?? null,
    }));

    // Correctness is one fact per question, held in the answer key. The
    // legacy per-choice `isCorrect` is collapsed here, and a question that
    // does not name exactly one correct option is rejected rather than
    // imported unanswerable.
    const correct = (q.choices ?? [])
      .map((c, i) => ({ id: `c${c.orderIndex ?? i + 1}`, isCorrect: c.isCorrect === true }))
      .filter((c) => c.isCorrect)
      .map((c) => c.id);

    if (correct.length !== 1) {
      die(
        `question ${q.questionKey} marks ${correct.length} correct choices; ` +
          `MCQ_SINGLE requires exactly one. Fix the source data.`,
      );
    }

    const conceptLinks = (q.conceptKeys ?? []).map((link) => {
      const path = conceptPathByLegacyKey.get(link.conceptKey);
      if (!path) die(`question ${q.questionKey} references unknown concept ${link.conceptKey}`);
      return {
        unitSlug: path.unitSlug,
        lessonSlug: path.lessonSlug,
        conceptSlug: path.conceptSlug,
        weight: link.weight ?? 1,
        isPrimary: link.isPrimary === true,
      };
    });

    if (conceptLinks.filter((c) => c.isPrimary).length !== 1) {
      die(`question ${q.questionKey} must have exactly one primary concept`);
    }

    questions.push({
      // Advisory only; the importer re-derives identity from lesson + text.
      //
      // Built from a fingerprint of the text rather than from the legacy
      // questionKey, because that key is NOT unique in the source: the maths
      // export reuses a single key across up to three distinct questions in
      // one lesson (110 questions under 54 keys). Embedding it here produced a
      // package whose own `key` column collided 38 times, which looked like
      // data loss on every round-trip comparison. The legacy key is preserved
      // as `sourceRef` instead, where being non-unique is expected.
      key: `${textbookKey}-U-${lessonPath.unitSlug}-L-${lessonPath.lessonSlug}-Q${fingerprint(q.text)}`,
      unitSlug: lessonPath.unitSlug,
      lessonSlug: lessonPath.lessonSlug,
      sourceRef: q.questionKey ?? null,
      // All 244 legacy questions are "mcq" with exactly one correct choice,
      // which is MCQ_SINGLE. Derived from the answer key above, not assumed.
      type: 'MCQ_SINGLE',
      text: q.text,
      hint: q.hint ?? null,
      explanation: q.explanation ?? null,
      points: q.defaultPoints ?? 1,
      difficulty01: q.difficulty ?? 0.5,
      // Textbook content, but NOT the end-of-lesson exercise set.
      //
      // `origin: TEXTBOOK` is correct -- these items come from the national
      // textbook and are tied to its lessons. `textbookRole` is what was
      // wrong: EXERCISE names the numbered practice printed at the end of a
      // lesson, and these are not that. They are book material of another
      // kind, so OTHER is the honest label. The distinction is not cosmetic:
      // a teacher filtering the bank for "the exercises in the book" would
      // otherwise be handed 244 items that are not those exercises.
      origin: 'TEXTBOOK',
      textbookRole: 'OTHER',
      choices,
      answerKey: {
        correctChoiceIds: correct,
        acceptedTexts: [],
        numericMin: null,
        numericMax: null,
        caseSensitive: false,
        allowPartialCredit: true,
      },
      concepts: conceptLinks,
      // Reported, never importable: publication is a two-actor review.
      status: 'DRAFT',
    });
  }

  // ── Prerequisites ─────────────────────────────────────────────────────────
  // Edges reference concepts by canonical KEY, which only exists after import
  // derives it. The keys are fully determined by the slug path, so they are
  // computed here the same way the kernel would.
  const conceptKeyFor = (legacyKey) => {
    const p = conceptPathByLegacyKey.get(legacyKey);
    if (!p) return null;
    return `${textbookKey}-U-${p.unitSlug}-L-${p.lessonSlug}-C-${p.conceptSlug}`;
  };

  const prerequisites = [];
  for (const edge of prereqFile.prerequisites ?? []) {
    const conceptKey = conceptKeyFor(edge.conceptKey);
    const prerequisiteKey = conceptKeyFor(edge.prerequisiteConceptKey);
    if (!conceptKey || !prerequisiteKey) {
      die(
        `prerequisite edge ${edge.conceptKey} <- ${edge.prerequisiteConceptKey} ` +
          `references a concept that is not in this package`,
      );
    }
    prerequisites.push({
      conceptKey,
      prerequisiteKey,
      strength: edge.strength ?? 1,
      requiredMastery: edge.requiredMastery ?? 0.7,
    });
  }

  // ── Collision check ───────────────────────────────────────────────────────
  // Truncation could in principle collapse two sibling names onto one slug.
  // Verified clean on current data; still checked, because silently merging
  // two concepts would merge two learners' mastery.
  assertUniqueSiblings(units, (u) => `unit:${u.slug}`, 'unit');
  assertUniqueSiblings(lessons, (l) => `lesson:${l.unitSlug}/${l.slug}`, 'lesson');
  assertUniqueSiblings(
    concepts,
    (c) => `concept:${c.unitSlug}/${c.lessonSlug}/${c.slug}`,
    'concept',
  );

  return {
    meta: {
      profile: 'edu7.textbook-content',
      profileVersion: '1.0',
      scope: 'FULL',
      // Fixed, not `new Date()`: a timestamp would make every run differ and
      // destroy the byte-identical guarantee this script promises.
      exportedAt: '1970-01-01T00:00:00.000Z',
      filter: { source: `yemeni-${subject}-7th`, legacyProfile: hierarchy.$schema },
    },
    textbook: {
      key: textbookKey,
      subjectKey: meta.code,
      gradeKey: `G${grade}`,
      // The catalogue term key, which is year-scoped (`2026-2027-T01`) — not
      // the `T1` fragment that appears inside a textbook key. They are
      // different identifiers and conflating them fails coordinate lookup.
      termKey: `${String(ctx.academicYearKey ?? 'ay_2026_2027').replace(/^ay_/, '').replace('_', '-')}-T0${term}`,
      title: `${meta.title} — الصف السابع (الفصل ${term === '1' ? 'الأول' : 'الثاني'})`,
      edition: String(edition),
      description: ctx.curriculumTitle ?? null,
      issuer: null,
      isbn: null,
      publishYear: null,
      totalPages: null,
      status: 'DRAFT',
    },
    units,
    lessons,
    concepts,
    prerequisites,
    misconceptions,
    learningResources,
    questions,
  };
}

function assertUniqueSiblings(rows, identity, what) {
  const seen = new Set();
  for (const row of rows) {
    const id = identity(row);
    if (seen.has(id)) die(`two ${what}s collapse onto one slug: ${id}`);
    seen.add(id);
  }
}

// ── Entry point ─────────────────────────────────────────────────────────────
const args = parseArgs(process.argv.slice(2));
/**
 * Edition, which is part of textbook identity.
 *
 * The legacy files declare `academicYearKey: "ay_2026_2027"` but **no printed
 * edition**, and the demo seed already occupies `ED2026` for MATH/G07/T1.
 * Importing under the same key would merge 55 converted concepts into the
 * 3-concept demo book, and since mastery is keyed by concept identity that
 * would corrupt the existing demo rather than extend it.
 *
 * So the converted curriculum gets its own edition. `NAT2026` says what it is
 * — the 2026 national curriculum — rather than inventing a printing year the
 * source never claimed. Override with --edition when a real edition is known.
 */
const edition = args.edition ?? 'NAT2026';
const subjects = args.subject ? [args.subject] : Object.keys(SUBJECTS);

mkdirSync(OUT, { recursive: true });

let totals = { units: 0, lessons: 0, concepts: 0, questions: 0, prereqs: 0, mis: 0, res: 0 };
for (const subject of subjects) {
  const pkg = convert(subject, edition);
  const path = `${OUT}/${subject}-g07-t1.package.json`;
  // Trailing newline and 2-space indent, so the file is diffable and stable.
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

  totals.units += pkg.units.length;
  totals.lessons += pkg.lessons.length;
  totals.concepts += pkg.concepts.length;
  totals.questions += pkg.questions.length;
  totals.prereqs += pkg.prerequisites.length;
  totals.mis += pkg.misconceptions.length;
  totals.res += pkg.learningResources.length;

  console.log(
    `  ${subject.padEnd(10)} ${pkg.textbook.key.padEnd(26)} ` +
      `units=${String(pkg.units.length).padStart(2)} ` +
      `lessons=${String(pkg.lessons.length).padStart(3)} ` +
      `concepts=${String(pkg.concepts.length).padStart(3)} ` +
      `questions=${String(pkg.questions.length).padStart(4)} ` +
      `prereqs=${String(pkg.prerequisites.length).padStart(3)} ` +
      `misconceptions=${String(pkg.misconceptions.length).padStart(3)} ` +
      `resources=${String(pkg.learningResources.length).padStart(3)}`,
  );
}

console.log(
  `\n  total: ${totals.units} units, ${totals.lessons} lessons, ${totals.concepts} concepts, ` +
    `${totals.questions} questions, ${totals.prereqs} prerequisites, ` +
    `${totals.mis} misconceptions, ${totals.res} learning resources`,
);
console.log(`  written to content-packages/\n`);
