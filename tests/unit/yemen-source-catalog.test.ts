/** Source catalogue for Yemeni textbooks. */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface SourceRow {
  readonly gradeKey: string;
  readonly subjectKey: string;
  readonly part: 'PART_1' | 'PART_2';
  readonly coverage: 'TERM' | 'FULL_YEAR';
  readonly role: string;
  readonly title: string;
  readonly resourceTitle: string;
  readonly landingPage: string;
  readonly downloadUrl: string;
  readonly sourceRef: string;
}

const catalog = JSON.parse(
  readFileSync(resolve('prisma/seed/data/external/yemen-moe-textbook-sources.json'), 'utf8'),
) as {
  readonly sourceChannels: readonly { readonly url: string }[];
  readonly TextbookSource: readonly SourceRow[];
};

describe('Yemeni Ministry source catalogue', () => {
  it('keeps the requested Telegram channel and the reproducible Ministry fallback', () => {
    expect(catalog.sourceChannels.map((source) => source.url)).toContain('https://t.me/Books_Yemen_new');
    expect(catalog.sourceChannels.map((source) => source.url)).toContain('http://e-learning-moe.edu.ye/book.php');
  });

  it('is grouped by grade, subject and term with stable source references', () => {
    const refs = new Set<string>();
    for (const row of catalog.TextbookSource) {
      expect(row.gradeKey).toMatch(/^G\d{2}$/);
      expect(row.subjectKey).toMatch(/^[A-Z0-9]+$/);
      expect(['PART_1', 'PART_2']).toContain(row.part);
      expect(row.title.length).toBeGreaterThan(4);
      expect(row.resourceTitle.length).toBeGreaterThan(4);
      expect(row.landingPage).toMatch(/^http:\/\/e-learning-moe\.edu\.ye\/Class/);
      expect(row.downloadUrl).toMatch(/^https?:\/\//);
      expect(refs.has(row.sourceRef), row.sourceRef).toBe(false);
      refs.add(row.sourceRef);
    }
  });

  it('contains the reviewed seventh-grade science source for both terms', () => {
    expect(catalog.TextbookSource).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ gradeKey: 'G07', subjectKey: 'SCI', part: 'PART_1' }),
        expect.objectContaining({ gradeKey: 'G07', subjectKey: 'SCI', part: 'PART_2' }),
      ]),
    );
  });
});
