#!/usr/bin/env node
/**
 * Extract the Yemeni Ministry textbook catalogue into Edu7 JSON.
 *
 * Usage:
 *   node scripts/extract-yemen-moe-catalog.mjs \
 *     --out prisma/seed/data/external/yemen-moe-textbook-sources.json
 *
 * The Telegram channel requested by the product owner is recorded as the
 * primary source, but Telegram's public web preview does not reliably expose
 * historical PDF attachments without a client session. The Ministry class
 * pages are the deterministic fallback: each page links back to the Telegram
 * channel and lists the same downloadable PDFs.
 */

import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const TODAY = '2026-09-15';
const TELEGRAM = 'https://t.me/Books_Yemen_new';
const MOE_INDEX = 'http://e-learning-moe.edu.ye/book.php';
const EDITION = '2026';
const ISSUER = 'وزارة التربية والتعليم والبحث العلمي — اليمن';

const CLASSES = [
  ['G01', 'http://e-learning-moe.edu.ye/ClassOne.php'],
  ['G02', 'http://e-learning-moe.edu.ye/ClassTwo.php'],
  ['G03', 'http://e-learning-moe.edu.ye/ClassThree.php'],
  ['G04', 'http://e-learning-moe.edu.ye/ClassFour.php'],
  ['G05', 'http://e-learning-moe.edu.ye/ClassFive.php'],
  ['G06', 'http://e-learning-moe.edu.ye/ClassSix.php'],
  ['G07', 'http://e-learning-moe.edu.ye/ClassSeven.php'],
  ['G08', 'http://e-learning-moe.edu.ye/ClassEight.php'],
  ['G09', 'http://e-learning-moe.edu.ye/ClassNine.php'],
  ['G10', 'http://e-learning-moe.edu.ye/ClassTen.php'],
  ['G11', 'http://e-learning-moe.edu.ye/ClassEleven.php'],
  ['G12', 'http://e-learning-moe.edu.ye/ClassTwelve.php'],
];

const SUBJECTS = [
  [/قرآن|القرآن/u, 'QURAN', 'كتاب القرآن الكريم'],
  [/إسلام|اسلام|حديث|تهذيب|ايمان|إيمان|فقه|الفقة|سيرة/u, 'ISL', 'كتاب التربية الإسلامية'],
  [/لغة عربية|لغتي|قراءة|نحو|صرف|ادب|أدب|نصوص|بلاغة/u, 'ARAB', 'كتاب اللغة العربية'],
  [/انجليزي|إنجليزي|انجليزية|إنجليزية|english|Crescent/i, 'ENG', 'كتاب اللغة الإنجليزية'],
  [/رياضيات|mathematic/i, 'MATH', 'كتاب الرياضيات'],
  [/علوم|science/i, 'SCI', 'كتاب العلوم'],
  [/تربية اجتماعية|اجتماعية|تربية وطنية|وطنية|المجتمع/u, 'CIV', 'كتاب التربية الوطنية'],
  [/تاريخ/u, 'HIST', 'كتاب التاريخ'],
  [/جغراف/u, 'GEO', 'كتاب الجغرافيا'],
  [/فيزياء/u, 'PHYS', 'كتاب الفيزياء'],
  [/كيمياء/u, 'CHEM', 'كتاب الكيمياء'],
  [/احياء|أحياء/u, 'BIO', 'كتاب الأحياء'],
];

function parseArgs(argv) {
  const outIndex = argv.indexOf('--out');
  return {
    out: outIndex >= 0 ? argv[outIndex + 1] : null,
    allowEmpty: argv.includes('--allow-empty'),
  };
}

function clean(text) {
  return text.replace(/\\-/g, '-').replace(/\s+/g, ' ').trim();
}

function normaliseUrl(url) {
  if (url.startsWith('http://e-learning-moe.edu.ye/https://e-learning-moe.edu.ye/')) {
    return url.replace('http://e-learning-moe.edu.ye/https://e-learning-moe.edu.ye/', 'https://e-learning-moe.edu.ye/');
  }
  return url;
}

function subjectFor(title) {
  for (const [pattern, subjectKey, bookTitle] of SUBJECTS) {
    if (pattern.test(title)) return { subjectKey, title: bookTitle };
  }
  return null;
}

function partFor(title) {
  if (/الجزء\s+الثاني|part2|_2_|الثاني/i.test(title)) return { part: 'PART_2', coverage: 'TERM' };
  if (/الجزء\s+الأول|الجزء\s+الاول|part1|_1_|الأول|الاول/i.test(title)) return { part: 'PART_1', coverage: 'TERM' };
  return { part: 'PART_1', coverage: 'FULL_YEAR' };
}

function roleFor(title) {
  if (/تمارين|work|exercise/i.test(title)) return 'WORKBOOK';
  if (/انشطة|أنشطة|actions/i.test(title)) return 'ACTIVITY_BOOK';
  if (/handwriting/i.test(title)) return 'HANDWRITING';
  return 'TEXTBOOK';
}

function parsePage(markup, gradeKey, landingPage) {
  const rows = [];
  const seen = new Set();

  function add(resourceTitle, url) {
    resourceTitle = clean(resourceTitle);
    const mapped = subjectFor(resourceTitle);
    if (!mapped) return;
    const downloadUrl = normaliseUrl(url);
    const unique = `${resourceTitle}::${downloadUrl}`;
    if (seen.has(unique)) return;
    seen.add(unique);
    const { part, coverage } = partFor(resourceTitle);
    const role = roleFor(resourceTitle);
    rows.push({
      gradeKey,
      subjectKey: mapped.subjectKey,
      part,
      coverage,
      role,
      title: mapped.title,
      resourceTitle: resourceTitle.replace(/\s+كتاب$/u, ' — كتاب'),
      landingPage,
      downloadUrl,
      sourceRef: `MOE-YE-${gradeKey}-${mapped.subjectKey}-${part === 'PART_1' ? 'P01' : 'P02'}-${role}-${rows.length + 1}`,
    });
  }

  // Markdown produced by page readers, including Arena's fetch_page.
  const markdown = /###\s+([^\n]+)[\s\S]*?\[تحميل\]\(([^)]+\.pdf[^)]*)\)/gimu;
  for (const match of markup.matchAll(markdown)) add(match[1] ?? '', match[2] ?? '');

  // Raw Ministry HTML when the page is directly reachable. Keep this parser
  // deliberately conservative: it only records anchors that end in PDF, and
  // uses the closest preceding heading/title text as the human label.
  const htmlAnchor = /(?:<h[1-6][^>]*>|<div[^>]*(?:title|book|name)[^>]*>)([\s\S]{0,300}?)(?:<\/h[1-6]>|<\/div>)[\s\S]{0,800}?<a[^>]+href=["']([^"']+\.pdf[^"']*)["'][^>]*>/gimu;
  for (const match of markup.matchAll(htmlAnchor)) {
    const title = clean((match[1] ?? '').replace(/<[^>]+>/g, ' '));
    add(title, match[2] ?? '');
  }

  return rows;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'Edu7 source catalog extractor (+https://github.com/ameryhusam/edu7)' },
  });
  if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
  return response.text();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sources = [];
  const warnings = [];

  for (const [gradeKey, url] of CLASSES) {
    try {
      const page = await fetchText(url);
      const extracted = parsePage(page, gradeKey, url);
      sources.push(...extracted);
      if (extracted.length === 0) warnings.push(`${gradeKey}: no PDF links extracted`);
    } catch (error) {
      warnings.push(`${gradeKey}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const payload = {
    $schema: 'edu7.yemen-source-catalog.v1',
    $comment: [
      'Generated by scripts/extract-yemen-moe-catalog.mjs.',
      'Review source titles and subject mappings before using this in production.',
    ],
    retrievedAt: TODAY,
    edition: EDITION,
    issuer: ISSUER,
    sourceChannels: [
      { kind: 'telegram', url: TELEGRAM, label: 'الكتب الدراسية اليمنية' },
      { kind: 'moe-fallback', url: MOE_INDEX, label: 'الإدارة العامة للتعليم الإلكتروني — المناهج اليمنية' },
    ],
    TextbookSource: sources.sort((a, b) =>
      `${a.gradeKey}:${a.subjectKey}:${a.part}:${a.resourceTitle}`.localeCompare(
        `${b.gradeKey}:${b.subjectKey}:${b.part}:${b.resourceTitle}`,
        'en',
      ),
    ),
    warnings,
  };

  if (sources.length === 0 && !args.allowEmpty) {
    throw new Error(
      'No sources were extracted. The Ministry host may be blocking this network; the checked-in catalogue is intentionally kept as the reviewed fallback. Pass --allow-empty only for diagnostics.',
    );
  }

  const json = `${JSON.stringify(payload, null, 2)}\n`;
  if (args.out) await writeFile(args.out, json, 'utf8');
  else process.stdout.write(json);
  if (warnings.length) {
    for (const warning of warnings) console.error(`[catalog] ${warning}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

export { parsePage, subjectFor, partFor, roleFor };
