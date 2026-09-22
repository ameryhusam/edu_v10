/**
 * Seed source-backed textbook attachments from the Yemeni Ministry catalogue.
 *
 * This deliberately imports source PDFs as textbook-level resources only. A PDF
 * link is useful learning content, but it is not automatically a vetted concept
 * map or item bank: lesson trees, concepts and exam questions still go through
 * the reviewed content-package path before becoming adaptive evidence.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ResourceKind, type PrismaClient } from '@prisma/client';
import { stableKeyFingerprint, textbookKey } from '../../src/shared/kernel/identifiers.js';
import { unwrap } from '../../src/shared/kernel/result.js';

const DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'data', 'external');

interface YemenTextbookSource {
  readonly gradeKey: string;
  readonly subjectKey: string;
  readonly part: 'PART_1' | 'PART_2' | 'BOTH';
  readonly coverage: 'TERM' | 'FULL_YEAR';
  readonly role: 'TEXTBOOK' | 'WORKBOOK' | 'ACTIVITY_BOOK' | 'HANDWRITING' | 'REFERENCE';
  readonly title: string;
  readonly resourceTitle: string;
  readonly landingPage: string;
  readonly downloadUrl: string;
  readonly sourceRef: string;
}

interface YemenSourceCatalog {
  readonly edition: string;
  readonly issuer: string;
  readonly sourceChannels: readonly { readonly url: string; readonly label: string }[];
  readonly TextbookSource: readonly YemenTextbookSource[];
}

export interface YemenSourceSeedReport {
  readonly sources: number;
  readonly textbooksTouched: number;
  readonly resourcesTouched: number;
  readonly skipped: number;
}

export function readYemenSourceCatalog(file = 'yemen-moe-textbook-sources.json'): YemenSourceCatalog {
  return JSON.parse(readFileSync(resolve(DATA_DIR, file), 'utf8')) as YemenSourceCatalog;
}

export async function seedYemenSourceCatalog(
  prisma: PrismaClient,
  catalog: YemenSourceCatalog,
  ctx: { readonly academicYearKey: string },
): Promise<YemenSourceSeedReport> {
  const grades = await prisma.grade.findMany({ select: { id: true, key: true, ordinal: true } });
  const subjects = await prisma.subject.findMany({ select: { id: true, key: true } });
  const gradeByKey = new Map(grades.map((grade) => [grade.key, grade]));
  const subjectByKey = new Map(subjects.map((subject) => [subject.key, subject]));
  const touchedTextbooks = new Set<string>();
  let resourcesTouched = 0;
  let skipped = 0;

  for (const source of catalog.TextbookSource) {
    const grade = gradeByKey.get(source.gradeKey);
    const subject = subjectByKey.get(source.subjectKey);
    if (!grade || !subject) {
      skipped += 1;
      continue;
    }

    const part = source.part;

    const key = unwrap(
      textbookKey({
        subject: source.subjectKey,
        grade: grade.ordinal,
        part,
        edition: catalog.edition,
      }),
    );

    const textbook = await prisma.textbook.upsert({
      where: { key },
      create: {
        key,
        part,
        gradeId: grade.id,
        subjectId: subject.id,
        title: source.title,
        description: textbookDescription(source, catalog),
        issuer: catalog.issuer,
        edition: catalog.edition,
        publishYear: Number(catalog.edition.match(/^\d{4}/)?.[0] ?? 2026),
        totalPages: 120,
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
      update: {
        title: source.title,
        issuer: catalog.issuer,
        description: textbookDescription(source, catalog),
        publishYear: Number(catalog.edition.match(/^\d{4}/)?.[0] ?? 2026),
        status: 'PUBLISHED',
      },
      select: { id: true, key: true },
    });
    touchedTextbooks.add(textbook.key);

    const resourceKey = `${textbook.key}-SRC${stableKeyFingerprint(source.sourceRef)}`;
    await prisma.learningResource.upsert({
      where: { key: resourceKey },
      create: {
        key: resourceKey,
        slug: source.sourceRef,
        textbookId: textbook.id,
        kind: ResourceKind.TEXTBOOK_PAGE,
        title: source.resourceTitle,
        url: source.downloadUrl,
        body: resourceDescription(source, catalog),
        orderIndex: orderFor(source),
      },
      update: {
        title: source.resourceTitle,
        url: source.downloadUrl,
        body: resourceDescription(source, catalog),
        isActive: true,
      },
    });
    resourcesTouched += 1;
  }

  return {
    sources: catalog.TextbookSource.length,
    textbooksTouched: touchedTextbooks.size,
    resourcesTouched,
    skipped,
  };
}

function orderFor(source: YemenTextbookSource): number {
  const base = source.role === 'TEXTBOOK' ? 10 : source.role === 'WORKBOOK' ? 20 : source.role === 'ACTIVITY_BOOK' ? 30 : 40;
  return source.part === 'PART_1' ? 100 + base : source.part === 'PART_2' ? 200 + base : 300 + base;
}

function textbookDescription(source: YemenTextbookSource, catalog: YemenSourceCatalog): string {
  const channel = catalog.sourceChannels[0]?.url ?? 'https://t.me/Books_Yemen_new';
  const coverage = source.coverage === 'FULL_YEAR' ? 'مقرر يغطي العام الدراسي كاملاً' : `الجزء الفيزيائي ${source.part}`;
  return [
    `${coverage} مستخرج من فهرس المناهج اليمنية الرسمي ومربوط بقناة الكتب الدراسية اليمنية.`,
    `نوع المقرر: ${source.role}`,
    `عنوان النسخة المرفقة: ${source.resourceTitle}`,
    `رابط التحميل: ${source.downloadUrl}`,
    `صفحة الفهرس: ${source.landingPage}`,
    `قناة تيليجرام: ${channel}`,
    `رمز المرجع: ${source.sourceRef}`,
  ].join('\n');
}

function resourceDescription(source: YemenTextbookSource, catalog: YemenSourceCatalog): string {
  const channel = catalog.sourceChannels[0]?.url ?? 'https://t.me/Books_Yemen_new';
  const coverage = source.coverage === 'FULL_YEAR' ? 'كتاب يغطي العام الدراسي' : `مصدر الجزء الفيزيائي ${source.part}`;
  return [
    `${coverage} مستخرج من فهرس المناهج اليمنية الرسمي ومربوط بقناة الكتب الدراسية اليمنية على تيليجرام.`,
    `صفحة الفهرس: ${source.landingPage}`,
    `قناة تيليجرام: ${channel}`,
    `مرجع المصدر: ${source.sourceRef}`,
  ].join('\n');
}
