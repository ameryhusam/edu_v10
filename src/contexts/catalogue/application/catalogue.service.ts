/**
 * Catalogue administration.
 *
 * Every method follows the same shape: validate through the domain, check the
 * invariants that need a lookup, then write. The service never validates by
 * hand — if a rule can be expressed without I/O it lives in `domain/catalogue`
 * and is tested there.
 *
 * Creation is an upsert-by-key on purpose. These are reference rows identified
 * by a business key, and an administrator who re-submits the same subject is
 * describing the same subject. The alternative — a hard duplicate error — makes
 * the endpoint unusable for the idempotent provisioning scripts that should be
 * replacing hand-run seeds.
 */

import { Errors } from '../../../shared/kernel/errors.js';
import { Err, Ok, type Result } from '../../../shared/kernel/result.js';
import {
  ensureRemovable,
  validateAcademicYear,
  validateGrade,
  validateSchool,
  validateSubject,
  validateTerm,
  type AcademicYearInput,
  type GradeInput,
  type SchoolInput,
  type SubjectInput,
  type TermInput,
} from '../domain/catalogue.js';
import type {
  AcademicYearRecord,
  CatalogueRepository,
  GradeRecord,
  GradeSubjectMatrix,
  MatrixRow,
  SchoolRecord,
  SubjectRecord,
  SubjectRow,
  TermRecord,
} from './ports.js';
// Cross-context domain import (permitted by check-architecture's C1: a
// context may depend on another context's domain or application ports).
// `textbookTitleForSubject` is a pure naming rule that belongs to content,
// which owns Textbook; catalogue only needs its output to advertise a
// suggested title alongside each subject, once, instead of every
// textbook-creation screen recomputing it — see §2.2 of the production plan.
import { textbookTitleForSubject } from '../../content/domain/authoring.js';

function withDefaultTitle(subject: SubjectRow): SubjectRecord {
  return { ...subject, defaultTextbookTitle: textbookTitleForSubject(subject.name) };
}

export class CatalogueService {
  constructor(private readonly repo: CatalogueRepository) {}

  // ── Subjects ──────────────────────────────────────────────────────────────

  async listSubjects(): Promise<Result<readonly SubjectRecord[]>> {
    const subjects = await this.repo.listSubjects();
    return Ok(subjects.map(withDefaultTitle));
  }

  // ── The curriculum matrix (توزيع المواد على الصفوف) ───────────────────────

  /** The matrix as stored: grades, subjects (with their policy), cells. */
  async gradeSubjectMatrix(): Promise<Result<GradeSubjectMatrix>> {
    return Ok(await this.repo.gradeSubjectMatrix());
  }

  /**
   * Save the administrator's cells, wholesale.
   *
   * The batch, not the single toggle, is the write unit — the legacy studio's
   * rule that nothing is persisted until «حفظ التوزيع» is pressed. An unknown
   * grade or subject key refuses the whole batch rather than silently
   * skipping a cell: a half-applied matrix looks exactly like a corrupted one.
   */
  async applyGradeSubjectCells(
    changes: readonly { gradeKey: string; subjectKey: string; isActive: boolean }[],
  ): Promise<Result<readonly MatrixRow[]>> {
    if (changes.length === 0) {
      return Err(
        Errors.validation('catalogue.matrix_empty_batch', 'A matrix save needs at least one cell.'),
      );
    }

    const [grades, subjects] = await Promise.all([
      this.repo.listGrades(),
      this.repo.listSubjects(),
    ]);
    const gradeKeys = new Set(grades.map((g) => g.key));
    const subjectKeys = new Set(subjects.map((s) => s.key));
    for (const change of changes) {
      if (!gradeKeys.has(change.gradeKey) || !subjectKeys.has(change.subjectKey)) {
        return Err(
          Errors.validation(
            'catalogue.matrix_unknown_cell',
            'A cell addresses a grade or subject that does not exist.',
            { gradeKey: change.gradeKey, subjectKey: change.subjectKey },
          ),
        );
      }
    }

    return Ok(await this.repo.applyGradeSubjectCells(changes));
  }

  /**
   * Fill the matrix from the subjects' own standard policy — the legacy
   * algorithm, kept honest by its two rules:
   *
   *   · PREVIEW IS MANDATORY: `apply: false` computes and returns exactly what
   *     would change and writes nothing; the caller confirms before the write.
   *   · THE POLICY WINS: fill is "apply the national offer", not "merge" — a
   *     stored cell that contradicts the policy is exactly what the
   *     administrator asked to fix. A subject with no claimed policy ([] or
   *     inactive) is left entirely alone.
   *
   * Absent-vs-disabled is preserved: policy-off needs no row (absence already
   * says it), so fills never materialise negative cells.
   */
  async fillGradeSubjectsFromPolicy(input: {
    apply: boolean;
    /** Scope the fill to one grade — the grades table's row action. */
    gradeKey?: string;
  }): Promise<
    Result<{
      applied: boolean;
      toEnable: number;
      toDisable: number;
      unchanged: number;
      cells: readonly MatrixRow[];
    }>
  > {
    return this.applyPolicy(input.apply, { mode: 'fill', gradeKey: input.gradeKey });
  }

  /**
   * Restore the distribution the system was installed with.
   *
   * The difference from a fill is exactly the word "default": fill corrects
   * the cells the policy governs and leaves no-policy subjects to the
   * administrator; restore puts the WHOLE matrix back to the seeded state,
   * which means a no-policy subject goes off too — its default is "not
   * offered". A manual experiment on Art is exactly what an administrator
   * pressing "restore defaults" is asking to undo.
   *
   * The preview rule holds: `apply: false` reports and writes nothing.
   */
  async restoreDefaultDistribution(input: {
    apply: boolean;
  }): Promise<
    Result<{
      applied: boolean;
      toEnable: number;
      toDisable: number;
      unchanged: number;
      cells: readonly MatrixRow[];
    }>
  > {
    return this.applyPolicy(input.apply, { mode: 'restore' });
  }

  /**
   * The one policy engine behind fill, per-grade fill and restore. `mode`
   * decides what a subject without a claimed policy means:
   *
   *   · 'fill'    — not governed, skipped entirely;
   *   · 'restore' — governed by the default, which is "off".
   */
  private async applyPolicy(
    apply: boolean,
    scope: { mode: 'fill' | 'restore'; gradeKey?: string },
  ): Promise<
    Result<{
      applied: boolean;
      toEnable: number;
      toDisable: number;
      unchanged: number;
      cells: readonly MatrixRow[];
    }>
  > {
    const matrix = await this.repo.gradeSubjectMatrix();

    const stored = new Map(matrix.rows.map((r) => [`${r.gradeKey}:${r.subjectKey}`, r.isActive]));
    const changes: { gradeKey: string; subjectKey: string; isActive: boolean }[] = [];
    let toEnable = 0;
    let toDisable = 0;
    let unchanged = 0;

    for (const subject of matrix.subjects) {
      if (!subject.isActive) continue;
      const governed = subject.standardGradeLevels.length > 0;
      if (scope.mode === 'fill' && !governed) continue;
      for (const grade of matrix.grades) {
        if (!grade.isActive) continue;
        if (scope.gradeKey !== undefined && grade.key !== scope.gradeKey) continue;
        const target = governed && subject.standardGradeLevels.includes(grade.ordinal);
        const current = stored.get(`${grade.key}:${subject.key}`) ?? false;
        if (target === current) {
          unchanged += 1;
          continue;
        }
        if (target) toEnable += 1;
        else toDisable += 1;
        changes.push({ gradeKey: grade.key, subjectKey: subject.key, isActive: target });
      }
    }

    if (!apply) {
      return Ok({ applied: false, toEnable, toDisable, unchanged, cells: [] });
    }

    const cells = await this.repo.applyGradeSubjectCells(changes);
    return Ok({ applied: true, toEnable, toDisable, unchanged, cells });
  }

  async saveSubject(input: SubjectInput): Promise<Result<SubjectRecord>> {
    const valid = validateSubject(input);
    if (!valid.ok) return valid;
    return Ok(
      withDefaultTitle(
        await this.repo.upsertSubject({
          key: valid.value.key,
          name: valid.value.name,
          nameEn: valid.value.nameEn,
        }),
      ),
    );
  }

  async updateSubject(
    key: string,
    patch: { name?: string; nameEn?: string | null; isActive?: boolean },
  ): Promise<Result<SubjectRecord>> {
    const existing = await this.repo.findSubject(key);
    if (!existing) return this.missing('subject', key);
    // Re-validate the merged result rather than the patch: a patch that is
    // individually plausible can still produce an invalid row.
    const valid = validateSubject({
      key: existing.key,
      name: patch.name ?? existing.name,
      nameEn: patch.nameEn !== undefined ? patch.nameEn : existing.nameEn,
    });
    if (!valid.ok) return valid;

    return Ok(
      withDefaultTitle(
        await this.repo.updateSubject(existing.key, {
          name: valid.value.name,
          nameEn: valid.value.nameEn,
          ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
        }),
      ),
    );
  }

  async deleteSubject(key: string): Promise<Result<{ key: string }>> {
    const existing = await this.repo.findSubject(key);
    if (!existing) return this.missing('subject', key);

    const removable = ensureRemovable('subject', existing.key, [
      { what: 'textbooks', count: existing.textbookCount },
    ]);
    if (!removable.ok) return removable;

    await this.repo.deleteSubject(existing.key);
    return Ok({ key: existing.key });
  }

  // ── Grades ────────────────────────────────────────────────────────────────

  async listGrades(): Promise<Result<readonly GradeRecord[]>> {
    return Ok(await this.repo.listGrades());
  }

  async saveGrade(input: GradeInput): Promise<Result<GradeRecord>> {
    const valid = validateGrade(input);
    if (!valid.ok) return valid;

    // Grade.ordinal is unique. This is defence in depth and is currently
    // unreachable through the normal path, because the key encodes the ordinal
    // and `validateGrade` already rejects a mismatch — so two keys cannot claim
    // the same ordinal. It stays because the alternative, if that invariant is
    // ever relaxed, is a raw Prisma constraint error naming a database index
    // rather than a grade.
    const clash = await this.repo.findGradeByOrdinal(valid.value.ordinal);
    if (clash && clash.key !== valid.value.key) {
      return Err(
        Errors.conflict(
          'catalogue.grade_ordinal_taken',
          `Grade ${clash.key} already holds ordinal ${valid.value.ordinal}.`,
          { ordinal: valid.value.ordinal, heldBy: clash.key },
        ),
      );
    }

    return Ok(
      await this.repo.upsertGrade({
        key: valid.value.key,
        ordinal: valid.value.ordinal,
        name: valid.value.name,
        stage: valid.value.stage,
      }),
    );
  }

  async updateGrade(
    key: string,
    patch: { name?: string; stage?: string | null; isActive?: boolean },
  ): Promise<Result<GradeRecord>> {
    const existing = await this.repo.findGrade(key);
    if (!existing) return this.missing('grade', key);

    const valid = validateGrade({
      key: existing.key,
      ordinal: existing.ordinal,
      name: patch.name ?? existing.name,
      stage: patch.stage !== undefined ? patch.stage : existing.stage,
    });
    if (!valid.ok) return valid;

    // The ordinal is deliberately not patchable: it is encoded in the key, so
    // changing it would require renaming the grade, which would orphan every
    // textbook and enrolment already pinned to the old key.
    return Ok(
      await this.repo.updateGrade(existing.key, {
        name: valid.value.name,
        stage: valid.value.stage,
        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      }),
    );
  }

  async deleteGrade(key: string): Promise<Result<{ key: string }>> {
    const existing = await this.repo.findGrade(key);
    if (!existing) return this.missing('grade', key);

    const removable = ensureRemovable('grade', existing.key, [
      { what: 'textbooks', count: existing.textbookCount },
      { what: 'enrolments', count: existing.enrollmentCount },
    ]);
    if (!removable.ok) return removable;

    await this.repo.deleteGrade(existing.key);
    return Ok({ key: existing.key });
  }

  // ── Academic years ────────────────────────────────────────────────────────

  async listAcademicYears(): Promise<Result<readonly AcademicYearRecord[]>> {
    return Ok(await this.repo.listAcademicYears());
  }

  async saveAcademicYear(input: AcademicYearInput): Promise<Result<AcademicYearRecord>> {
    const valid = validateAcademicYear(input);
    if (!valid.ok) return valid;
    return Ok(await this.repo.upsertAcademicYear(valid.value));
  }

  /**
   * Make one year current.
   *
   * Routed through a dedicated method rather than a generic patch because the
   * write is "clear every flag, then set one" — expressing that as a field
   * update invites two current years, which makes every unscoped read
   * non-deterministic.
   */
  async setCurrentAcademicYear(key: string): Promise<Result<AcademicYearRecord>> {
    const existing = await this.repo.findAcademicYear(key);
    if (!existing) return this.missing('academic year', key);
    return Ok(await this.repo.setCurrentAcademicYear(existing.key));
  }

  async deleteAcademicYear(key: string): Promise<Result<{ key: string }>> {
    const existing = await this.repo.findAcademicYear(key);
    if (!existing) return this.missing('academic year', key);

    if (existing.isCurrent) {
      return Err(
        Errors.conflict(
          'catalogue.current_year_protected',
          'The current academic year cannot be removed. Make another year current first.',
          { key: existing.key },
        ),
      );
    }

    const removable = ensureRemovable('academic year', existing.key, [
      { what: 'terms', count: existing.termCount },
      { what: 'enrolments', count: existing.enrollmentCount },
    ]);
    if (!removable.ok) return removable;

    await this.repo.deleteAcademicYear(existing.key);
    return Ok({ key: existing.key });
  }

  // ── Terms ─────────────────────────────────────────────────────────────────

  async listTerms(academicYearKey?: string): Promise<Result<readonly TermRecord[]>> {
    if (academicYearKey) {
      const year = await this.repo.findAcademicYear(academicYearKey);
      if (!year) return this.missing('academic year', academicYearKey);
    }
    return Ok(await this.repo.listTerms(academicYearKey));
  }

  async saveTerm(input: TermInput): Promise<Result<TermRecord>> {
    const valid = validateTerm(input);
    if (!valid.ok) return valid;

    // A term without its year is unreachable: every enrolment and textbook
    // resolves the pair together.
    const year = await this.repo.findAcademicYear(valid.value.academicYearKey);
    if (!year) return this.missing('academic year', valid.value.academicYearKey);

    return Ok(await this.repo.upsertTerm(valid.value));
  }

  async updateTerm(key: string, patch: { name?: string }): Promise<Result<TermRecord>> {
    const existing = await this.repo.findTerm(key);
    if (!existing) return this.missing('term', key);

    const valid = validateTerm({
      key: existing.key,
      academicYearKey: existing.academicYearKey,
      ordinal: existing.ordinal,
      name: patch.name ?? existing.name,
    });
    if (!valid.ok) return valid;

    return Ok(await this.repo.updateTerm(existing.key, { name: valid.value.name }));
  }

  async deleteTerm(key: string): Promise<Result<{ key: string }>> {
    const existing = await this.repo.findTerm(key);
    if (!existing) return this.missing('term', key);

    const removable = ensureRemovable('term', existing.key, [
      { what: 'textbooks', count: existing.textbookCount },
      { what: 'enrolments', count: existing.enrollmentCount },
    ]);
    if (!removable.ok) return removable;

    await this.repo.deleteTerm(existing.key);
    return Ok({ key: existing.key });
  }

  // ── Schools ───────────────────────────────────────────────────────────────

  async listSchools(): Promise<Result<readonly SchoolRecord[]>> {
    return Ok(await this.repo.listSchools());
  }

  async saveSchool(input: SchoolInput): Promise<Result<SchoolRecord>> {
    const valid = validateSchool(input);
    if (!valid.ok) return valid;
    return Ok(
      await this.repo.upsertSchool({
        key: valid.value.key,
        name: valid.value.name,
        city: valid.value.city,
      }),
    );
  }

  async updateSchool(
    key: string,
    patch: { name?: string; city?: string | null; isActive?: boolean },
  ): Promise<Result<SchoolRecord>> {
    const existing = await this.repo.findSchool(key);
    if (!existing) return this.missing('school', key);

    const valid = validateSchool({
      key: existing.key,
      name: patch.name ?? existing.name,
      city: patch.city !== undefined ? patch.city : existing.city,
    });
    if (!valid.ok) return valid;

    return Ok(
      await this.repo.updateSchool(existing.key, {
        name: valid.value.name,
        city: valid.value.city,
        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      }),
    );
  }

  async deleteSchool(key: string): Promise<Result<{ key: string }>> {
    const existing = await this.repo.findSchool(key);
    if (!existing) return this.missing('school', key);

    const removable = ensureRemovable('school', existing.key, [
      { what: 'enrolments', count: existing.enrollmentCount },
      { what: 'role grants', count: existing.roleGrantCount },
    ]);
    if (!removable.ok) return removable;

    await this.repo.deleteSchool(existing.key);
    return Ok({ key: existing.key });
  }

  private missing(entity: string, key: string): Result<never> {
    return Err(
      Errors.notFound('catalogue.not_found', `No ${entity} exists with key ${key}.`, {
        entity,
        key,
      }),
    );
  }
}
