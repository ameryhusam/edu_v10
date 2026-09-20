/**
 * TextbookLabel — the shared "title · subject · grade · term" renderer.
 *
 * The adversarial case is the whole point: a title an author already wrote to
 * include the grade or term must not have that text repeated when the label
 * appends the structural parts. See §2.2 of the production plan.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TextbookLabel, textbookLabelParts } from './textbook-label';

describe('textbookLabelParts', () => {
  it('keeps every part when none of them overlap', () => {
    expect(
      textbookLabelParts({
        title: 'Mathematics — Grade 7',
        subjectName: 'الرياضيات',
        gradeName: 'الصف السابع',
        termName: 'الفصل الأول',
      }),
    ).toEqual(['Mathematics — Grade 7', 'الرياضيات', 'الصف السابع', 'الفصل الأول']);
  });

  it('drops a part already contained in the title, even in the middle of a sentence', () => {
    expect(
      textbookLabelParts({
        title: 'كتاب الرياضيات الصف السابع',
        subjectName: 'الرياضيات',
        gradeName: 'الصف السابع',
        termName: 'الفصل الأول',
      }),
    ).toEqual(['كتاب الرياضيات الصف السابع', 'الفصل الأول']);
  });

  it('drops every structural part when the title already names all of them', () => {
    expect(
      textbookLabelParts({
        title: 'كتاب الرياضيات الصف السابع الفصل الأول',
        subjectName: 'الرياضيات',
        gradeName: 'الصف السابع',
        termName: 'الفصل الأول',
      }),
    ).toEqual(['كتاب الرياضيات الصف السابع الفصل الأول']);
  });

  it('drops a later part already covered by an earlier kept part, not just by the title', () => {
    // gradeName happens to contain termName's text — a pathological but real
    // possibility once titles are free text; the second occurrence must not
    // be printed twice either.
    expect(
      textbookLabelParts({
        title: 'Book',
        gradeName: 'Term One Edition',
        termName: 'Term One',
      }),
    ).toEqual(['Book', 'Term One Edition']);
  });

  it('ignores blank or missing parts without leaving gaps', () => {
    expect(
      textbookLabelParts({ title: 'Book', subjectName: null, gradeName: '   ', termName: undefined }),
    ).toEqual(['Book']);
  });

  it('keeps extras that are not already present', () => {
    expect(
      textbookLabelParts({
        title: 'Book',
        gradeName: 'Grade 7',
        extra: ['2026-2027', null, 'Grade 7'],
      }),
    ).toEqual(['Book', 'Grade 7', '2026-2027']);
  });
});

describe('TextbookLabel', () => {
  it('renders the deduplicated parts joined by the separator', () => {
    render(
      <TextbookLabel
        title="كتاب الرياضيات الصف السابع"
        subjectName="الرياضيات"
        gradeName="الصف السابع"
        termName="الفصل الأول"
      />,
    );

    expect(screen.getByText('كتاب الرياضيات الصف السابع · الفصل الأول')).toBeInTheDocument();
  });

  it('renders only the title when every structural part repeats it', () => {
    render(
      <TextbookLabel
        title="كتاب الرياضيات الصف السابع الفصل الأول"
        subjectName="الرياضيات"
        gradeName="الصف السابع"
        termName="الفصل الأول"
      />,
    );

    expect(screen.getByText('كتاب الرياضيات الصف السابع الفصل الأول')).toBeInTheDocument();
  });
});
