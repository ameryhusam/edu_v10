/**
 * The four catalogue collections, described as data.
 *
 * Every call into the API module is written as a closure (`() => api.x()`)
 * rather than as a bare reference (`api.x`). A bare reference is captured when
 * this module is first evaluated, which silently freezes the binding: the
 * function can no longer be substituted, and a spec built at import time keeps
 * calling the original no matter what the caller does. Deferring the lookup to
 * call time keeps that seam open and costs nothing.
 *
 * Each spec says how to list a collection, how to turn a record into form
 * values and back, which columns to show, what still points at a row, and —
 * where the domain gives the row a lifecycle — how to flip it. The screen then
 * has no per-collection branches at all.
 *
 * Schools are NOT here: they outgrew a tab and became their own surface
 * (`/admin/schools`), with a detail page and scoped directories.
 *
 * Two rules are encoded here rather than left to each caller:
 *
 * - `referencesOf` is the server's count, not a guess. A subject used by a
 *   textbook cannot be deleted, and the count is what lets the UI say so
 *   before the click instead of after it.
 * - form values are strings throughout, because that is what an input holds.
 *   Conversion happens once, at the edge, in `create`/`update` — the
 *   alternative is every field remembering its own type and one of them
 *   sending `"3"` where the API wants `3`.
 */

import type { Column } from '../../design-system/patterns/record-table';
import type { FieldSpec } from '../../design-system/patterns/record-editor';
import {
  catalogueApi as administrationApi,
  type AcademicYearRecord,
  type GradeRecord,
  type SubjectRecord,
  type TermRecord,
} from './catalogue.api';
import type { MessageKey } from '../../shared/i18n/messages';

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

export type CollectionId = 'subjects' | 'grades' | 'academicYears' | 'terms';

/** A lifecycle the domain expresses as `isActive` — retire, don't delete. */
export interface LifecycleSpec<T> {
  readonly activeOf: (record: T) => boolean;
  readonly toggle: (record: T, next: boolean) => Promise<unknown>;
}

/** A "one current row in the whole system" lifecycle, like the academic year. */
export interface CurrentSpec<T> {
  readonly isCurrentOf: (record: T) => boolean;
  readonly makeCurrent: (record: T) => Promise<unknown>;
}

export interface CollectionSpec<T> {
  list: () => Promise<readonly T[]>;
  columns: (t: Translate) => readonly Column<T>[];
  /** `yearKeys` is the academic years the page already holds, so a term's
   *  create form can offer every year that exists — not merely the years
   *  that already have a term. */
  fields: (
    t: Translate,
    records: readonly T[],
    yearKeys: readonly string[],
  ) => readonly FieldSpec[];
  keyOf: (record: T) => string;
  nameOf: (record: T) => string;
  searchTextOf: (record: T) => string;
  referencesOf: (record: T) => number;
  toForm: (record: T) => Record<string, string>;
  blank: () => Record<string, string>;
  create: (values: Record<string, string>) => Promise<unknown>;
  update: (values: Record<string, string>) => Promise<unknown>;
  remove: (key: string) => Promise<unknown>;
  lifecycle?: LifecycleSpec<T>;
  current?: CurrentSpec<T>;
}

/**
 * A spec with its record type sealed in.
 *
 * The screen holds one of these without knowing what `T` was. Rather than cast
 * — which fails honestly, because `CollectionSpec<Subject>` really is not a
 * `CollectionSpec<never>` — each entry hands over a small set of closures that
 * have already closed over their own type. Nothing unsafe crosses the
 * boundary, and a record can only ever reach the spec that produced it.
 */
export interface OpaqueCollection {
  list: () => Promise<readonly unknown[]>;
  columns: (t: Translate) => readonly Column<unknown>[];
  fields: (t: Translate, records: readonly unknown[], yearKeys: readonly string[]) => readonly FieldSpec[];
  keyOf: (record: unknown) => string;
  nameOf: (record: unknown) => string;
  searchTextOf: (record: unknown) => string;
  referencesOf: (record: unknown) => number;
  toForm: (record: unknown) => Record<string, string>;
  blank: () => Record<string, string>;
  create: (values: Record<string, string>) => Promise<unknown>;
  update: (values: Record<string, string>) => Promise<unknown>;
  remove: (key: string) => Promise<unknown>;
  lifecycle?: {
    activeOf: (record: unknown) => boolean;
    toggle: (record: unknown, next: boolean) => Promise<unknown>;
  };
  current?: {
    isCurrentOf: (record: unknown) => boolean;
    makeCurrent: (record: unknown) => Promise<unknown>;
  };
}

/**
 * Seal a typed spec.
 *
 * The one place a record is re-typed, and it is sound: the value came out of
 * `list()` on this same spec, so it is a `T` by construction.
 */
function seal<T>(spec: CollectionSpec<T>): OpaqueCollection {
  const as = (record: unknown): T => record as T;
  return {
    list: () => spec.list(),
    columns: (t) =>
      spec.columns(t).map((column) => ({
        id: column.id,
        label: column.label,
        ...(column.numeric !== undefined ? { numeric: column.numeric } : {}),
        render: (record: unknown) => column.render(as(record)),
        ...(column.sortBy ? { sortBy: (record: unknown) => column.sortBy!(as(record)) } : {}),
      })),
    fields: (t, records, yearKeys) => spec.fields(t, records.map(as), yearKeys),
    keyOf: (record) => spec.keyOf(as(record)),
    nameOf: (record) => spec.nameOf(as(record)),
    searchTextOf: (record) => spec.searchTextOf(as(record)),
    referencesOf: (record) => spec.referencesOf(as(record)),
    toForm: (record) => spec.toForm(as(record)),
    blank: () => spec.blank(),
    create: (values) => spec.create(values),
    update: (values) => spec.update(values),
    remove: (key) => spec.remove(key),
    ...(spec.lifecycle
      ? {
          lifecycle: {
            activeOf: (record) => spec.lifecycle!.activeOf(as(record)),
            toggle: (record, next) => spec.lifecycle!.toggle(as(record), next),
          },
        }
      : {}),
    ...(spec.current
      ? {
          current: {
            isCurrentOf: (record) => spec.current!.isCurrentOf(as(record)),
            makeCurrent: (record) => spec.current!.makeCurrent(as(record)),
          },
        }
      : {}),
  };
}

const keyColumn = <T extends { key: string }>(t: Translate): Column<T> => ({
  id: 'key',
  label: t('catalogue.key'),
  render: (record) => record.key,
  sortBy: (record) => record.key,
});

const stateColumn = <T extends { isActive: boolean }>(t: Translate): Column<T> => ({
  id: 'state',
  label: t('catalogue.state'),
  render: (r) => (r.isActive ? t('catalogue.active') : t('catalogue.inactive')),
  sortBy: (r) => (r.isActive ? 1 : 0),
});

const subjects: CollectionSpec<SubjectRecord> = {
  list: () => administrationApi.subjects.list(),
  columns: (t) => [
    keyColumn(t),
    { id: 'name', label: t('catalogue.name'), render: (r) => r.name, sortBy: (r) => r.name },
    { id: 'nameEn', label: t('catalogue.nameEn'), render: (r) => r.nameEn ?? '—', sortBy: (r) => r.nameEn ?? '' },
    stateColumn(t),
    {
      id: 'textbooks',
      label: t('collection.textbooks'),
      numeric: true,
      render: (r) => r.textbookCount,
      sortBy: (r) => r.textbookCount,
    },
  ],
  fields: (t) => [
    { id: 'key', label: t('catalogue.key'), kind: 'text', required: true, visible: 'create', hint: t('catalogue.fixedAtCreation') },
    { id: 'name', label: t('catalogue.name'), kind: 'text', required: true },
    { id: 'nameEn', label: t('catalogue.nameEn'), kind: 'text' },
  ],
  keyOf: (r) => r.key,
  nameOf: (r) => r.name,
  searchTextOf: (r) => [r.key, r.name, r.nameEn ?? ''].join(' '),
  referencesOf: (r) => r.textbookCount,
  toForm: (r) => ({ key: r.key, name: r.name, nameEn: r.nameEn ?? '' }),
  blank: () => ({ key: '', name: '', nameEn: '' }),
  create: (v) =>
    administrationApi.subjects.save({ key: v.key!, name: v.name!, nameEn: v.nameEn || null }),
  update: (v) => administrationApi.subjects.update(v.key!, { name: v.name!, nameEn: v.nameEn || null }),
  remove: (key) => administrationApi.subjects.remove(key),
  lifecycle: {
    activeOf: (r) => r.isActive,
    toggle: (r, next) => administrationApi.subjects.update(r.key, { isActive: next }),
  },
};

const grades: CollectionSpec<GradeRecord> = {
  list: () => administrationApi.grades.list(),
  columns: (t) => [
    keyColumn(t),
    { id: 'ordinal', label: t('catalogue.ordinal'), numeric: true, render: (r) => r.ordinal, sortBy: (r) => r.ordinal },
    { id: 'name', label: t('catalogue.name'), render: (r) => r.name, sortBy: (r) => r.name },
    { id: 'stage', label: t('catalogue.stage'), render: (r) => r.stage ?? '—', sortBy: (r) => r.stage ?? '' },
    stateColumn(t),
    {
      id: 'enrollments',
      label: t('collection.enrollments'),
      numeric: true,
      render: (r) => r.enrollmentCount,
      sortBy: (r) => r.enrollmentCount,
    },
  ],
  fields: (t) => [
    { id: 'key', label: t('catalogue.key'), kind: 'text', required: true, visible: 'create', hint: t('catalogue.fixedAtCreation') },
    // The ordinal is encoded in the key (G07 ⇒ 7); changing it later would
    // orphan every textbook and enrolment pinned to the old key.
    { id: 'ordinal', label: t('catalogue.ordinal'), kind: 'number', required: true, visible: 'create' },
    { id: 'name', label: t('catalogue.name'), kind: 'text', required: true },
    { id: 'stage', label: t('catalogue.stage'), kind: 'text' },
  ],
  keyOf: (r) => r.key,
  nameOf: (r) => r.name,
  searchTextOf: (r) => [r.key, r.name, r.stage ?? '', r.ordinal].join(' '),
  // Either reference blocks removal, so the badge shows the total.
  referencesOf: (r) => r.textbookCount + r.enrollmentCount,
  toForm: (r) => ({
    key: r.key,
    ordinal: String(r.ordinal),
    name: r.name,
    stage: r.stage ?? '',
  }),
  blank: () => ({ key: '', ordinal: '', name: '', stage: '' }),
  create: (v) =>
    administrationApi.grades.save({
      key: v.key!,
      ordinal: Number(v.ordinal),
      name: v.name!,
      stage: v.stage || null,
    }),
  update: (v) => administrationApi.grades.update(v.key!, { name: v.name!, stage: v.stage || null }),
  remove: (key) => administrationApi.grades.remove(key),
  lifecycle: {
    activeOf: (r) => r.isActive,
    // Deactivating a grade retires it from NEW enrolments; the enrolment
    // screen will refuse one with the server's own named error.
    toggle: (r, next) => administrationApi.grades.update(r.key, { isActive: next }),
  },
};

const academicYears: CollectionSpec<AcademicYearRecord> = {
  list: () => administrationApi.academicYears.list(),
  columns: (t) => [
    keyColumn(t),
    { id: 'startsOn', label: t('catalogue.startsOn'), render: (r) => r.startsOn.slice(0, 10), sortBy: (r) => r.startsOn },
    { id: 'endsOn', label: t('catalogue.endsOn'), render: (r) => r.endsOn.slice(0, 10), sortBy: (r) => r.endsOn },
    { id: 'current', label: t('catalogue.current'), render: (r) => (r.isCurrent ? '✓' : ''), sortBy: (r) => (r.isCurrent ? 1 : 0) },
    { id: 'terms', label: t('collection.terms'), numeric: true, render: (r) => r.termCount, sortBy: (r) => r.termCount },
  ],
  fields: (t) => [
    { id: 'key', label: t('catalogue.key'), kind: 'text', required: true, visible: 'create', hint: t('catalogue.fixedAtCreation') },
    { id: 'startsOn', label: t('catalogue.startsOn'), kind: 'date', required: true },
    { id: 'endsOn', label: t('catalogue.endsOn'), kind: 'date', required: true },
  ],
  keyOf: (r) => r.key,
  nameOf: (r) => r.key,
  searchTextOf: (r) => [r.key, r.startsOn, r.endsOn, r.isCurrent ? 'current' : ''].join(' '),
  referencesOf: (r) => r.termCount + r.enrollmentCount,
  toForm: (r) => ({
    key: r.key,
    startsOn: r.startsOn.slice(0, 10),
    endsOn: r.endsOn.slice(0, 10),
  }),
  blank: () => ({ key: '', startsOn: '', endsOn: '' }),
  create: (v) =>
    administrationApi.academicYears.save({
      key: v.key!,
      startsOn: v.startsOn!,
      endsOn: v.endsOn!,
    }),
  // The year endpoint is an upsert by key, so an edit is the same call.
  update: (v) =>
    administrationApi.academicYears.save({
      key: v.key!,
      startsOn: v.startsOn!,
      endsOn: v.endsOn!,
    }),
  remove: (key) => administrationApi.academicYears.remove(key),
  // No isActive: a year's lifecycle IS its currency — exactly one row is
  // current, and the dedicated endpoint clears every other flag in one
  // transaction. A generic PATCH field here could make two years current.
  current: {
    isCurrentOf: (r) => r.isCurrent,
    makeCurrent: (r) => administrationApi.academicYears.makeCurrent(r.key),
  },
};

const terms: CollectionSpec<TermRecord> = {
  list: () => administrationApi.terms.list(),
  columns: (t) => [
    keyColumn(t),
    { id: 'year', label: t('catalogue.academicYear'), render: (r) => r.academicYearKey, sortBy: (r) => r.academicYearKey },
    { id: 'ordinal', label: t('catalogue.ordinal'), numeric: true, render: (r) => r.ordinal, sortBy: (r) => r.ordinal },
    { id: 'name', label: t('catalogue.name'), render: (r) => r.name, sortBy: (r) => r.name },
    {
      id: 'textbooks',
      label: t('collection.textbooks'),
      numeric: true,
      render: (r) => r.textbookCount,
      sortBy: (r) => r.textbookCount,
    },
  ],
  fields: (t, _records: readonly TermRecord[], yearKeys: readonly string[]) => [
    { id: 'key', label: t('catalogue.key'), kind: 'text', required: true, visible: 'create', hint: t('catalogue.fixedAtCreation') },
    {
      id: 'academicYearKey',
      label: t('catalogue.academicYear'),
      kind: 'select',
      required: true,
      // Offered as a list, not typed: a term must attach to a year that
      // exists, and a free-text field here produces a foreign-key error the
      // administrator can do nothing useful with.
      // Create-only: the year is encoded in the key (2026-2027-T01), so a
      // term cannot be moved between years after creation.
      visible: 'create',
      options: (yearKeys.length > 0 ? yearKeys : uniqueYearKeys(_records)).map((key) => ({
        value: key,
        label: key,
      })),
    },
    // Create-only, like the year: the ordinal is the T01 in the key.
    { id: 'ordinal', label: t('catalogue.ordinal'), kind: 'number', required: true, visible: 'create' },
    { id: 'name', label: t('catalogue.name'), kind: 'text', required: true },
  ],
  keyOf: (r) => r.key,
  nameOf: (r) => r.name,
  searchTextOf: (r) => [r.key, r.academicYearKey, r.name, r.ordinal].join(' '),
  referencesOf: (r) => r.textbookCount + r.enrollmentCount,
  toForm: (r) => ({
    key: r.key,
    academicYearKey: r.academicYearKey,
    ordinal: String(r.ordinal),
    name: r.name,
  }),
  blank: () => ({ key: '', academicYearKey: '', ordinal: '', name: '' }),
  create: (v) =>
    administrationApi.terms.save({
      key: v.key!,
      academicYearKey: v.academicYearKey!,
      ordinal: Number(v.ordinal),
      name: v.name!,
    }),
  update: (v) => administrationApi.terms.update(v.key!, { name: v.name! }),
  remove: (key) => administrationApi.terms.remove(key),
  // No lifecycle: a term's state is derived from its year — the domain audit
  // decided this, and an isActive column here would be a second opinion.
};

/** Year keys available to a term, read off the terms already loaded. */
function uniqueYearKeys(records: readonly TermRecord[]): readonly string[] {
  return [...new Set(records.map((record) => record.academicYearKey))].sort();
}

/** The registry. Each entry is checked against its own record type above. */
export const COLLECTIONS: Record<CollectionId, OpaqueCollection> = {
  subjects: seal(subjects),
  grades: seal(grades),
  academicYears: seal(academicYears),
  terms: seal(terms),
};
