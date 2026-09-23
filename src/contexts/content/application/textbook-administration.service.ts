/**
 * Textbook administration: browsing the catalogue and deploying it to schools.
 *
 * Two jobs, both previously impossible without editing the seed:
 *
 * - **See the catalogue.** Listing textbooks with their publication state was
 *   a read only the export and readiness paths could approximate; an
 *   administrator had no way to answer "which books exist and what state are
 *   they in".
 *
 * - **Record an adoption.** `TextbookAdoption` decides which books a school's
 *   learners are entitled to (see the learning repository's entitlement
 *   query), and until now the seed was its only writer — the exact
 *   "seed as load-bearing infrastructure" failure the provisioning routes
 *   were built to end.
 *
 * Rules kept deliberately thin: adoption is a deployment *fact*, not a
 * pedagogical verdict. It is recorded for any textbook in any state, because a
 * school legitimately adopts a book while its ingested copy is still being
 * prepared — and learner entitlement already filters to PUBLISHED books, so an
 * early adoption grants nothing prematurely. That filter is the publication
 * gate's to enforce, not this service's to duplicate.
 */

import { Errors } from '../../../shared/kernel/errors.js';
import { Err, Ok, type Result } from '../../../shared/kernel/result.js';
import type {
  AdoptionListPage,
  AdoptionListQuery,
  AdoptionRow,
  ConceptDetail,
  ContentAuditWriter,
  LessonMaterial,
  OutlineUnit,
  TextbookAdministrationRepository,
  TextbookListPage,
  TextbookListQuery,
} from './ports.js';
import type { ContentAuthoringService } from './authoring.service.js';
import { textbookTitleForSubject } from '../domain/authoring.js';
import { parseTextbookKey } from '../../../shared/kernel/identifiers.js';

/** Who is performing the act. Authorization already happened at the edge. */
export interface AdminContext {
  readonly actorKey: string;
}

export class TextbookAdministrationService {
  constructor(
    private readonly repo: TextbookAdministrationRepository,
    private readonly auditWriter: ContentAuditWriter,
    private readonly authoring: ContentAuthoringService,
  ) {}

  /**
   * The outline browse: what a book contains, unit by unit. The read behind
   * both the content-setup tables and the teacher's materials view — the
   * same facts, because there is only one curriculum.
   */
  async outline(textbookKey: string): Promise<Result<readonly OutlineUnit[]>> {
    const units = await this.repo.textbookOutline(textbookKey);
    if (units === null) {
      return Err(
        Errors.notFound('content.textbook_not_found', 'No such textbook.', { textbookKey }),
      );
    }
    return Ok(units);
  }

  /** One lesson's materials — the educational and remedial reading list. */
  async lessonMaterials(lessonKey: string): Promise<Result<readonly LessonMaterial[]>> {
    const materials = await this.repo.lessonMaterials(lessonKey);
    if (materials === null) {
      return Err(Errors.notFound('content.lesson_not_found', 'No such lesson.', { lessonKey }));
    }
    return Ok(materials);
  }

  /**
   * A concept's misconceptions and prerequisite graph — the detail behind
   * the "manage this concept" drawer.
   */
  async conceptDetail(conceptKey: string): Promise<Result<ConceptDetail>> {
    const detail = await this.repo.conceptDetail(conceptKey);
    if (detail === null) {
      return Err(Errors.notFound('content.node_not_found', 'No such concept.', { conceptKey }));
    }
    return Ok(detail);
  }

  async listTextbooks(query: {
    search?: string | undefined;
    subjectKey?: string | undefined;
    gradeKey?: string | undefined;
    part?: 'PART_1' | 'PART_2' | undefined;
    status?: string | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
  }): Promise<Result<TextbookListPage>> {
    return Ok(
      await this.repo.listTextbooks({
        ...(query.search ? { search: query.search } : {}),
        ...(query.subjectKey ? { subjectKey: query.subjectKey } : {}),
        ...(query.gradeKey ? { gradeKey: query.gradeKey } : {}),
        ...(query.part ? { part: query.part } : {}),
        ...(query.status ? { status: query.status } : {}),
        limit: Math.min(Math.max(query.limit ?? 25, 1), 100),
        offset: Math.max(query.offset ?? 0, 0),
      }),
    );
  }

  async ensureTextbooksForGrade(
    ctx: AdminContext,
    input: {
      gradeKey: string;
      part: 'PART_1' | 'PART_2';
      edition: string;
      issuer?: string | null;
      publishYear?: number | null;
      adopt?: { schoolKey: string; academicYearKey: string } | null;
    },
  ): Promise<
    Result<{
      gradeKey: string;
      part: 'PART_1' | 'PART_2';
      edition: string;
      created: number;
      unchanged: number;
      adopted: number;
      rows: readonly { subjectKey: string; textbookKey: string; title: string; created: boolean; adopted: boolean }[];
    }>
  > {
    const subjects = await this.repo.activeGradeSubjects(input.gradeKey);
    if (subjects === null) {
      return Err(
        Errors.notFound('content.grade_not_found', 'No such grade.', { gradeKey: input.gradeKey }),
      );
    }
    if (subjects.length === 0) {
      return Err(
        Errors.validation(
          'content.grade_has_no_subjects',
          'This grade has no active subjects in the grade-subject matrix.',
          { gradeKey: input.gradeKey },
        ),
      );
    }

    const rows: Array<{ subjectKey: string; textbookKey: string; title: string; created: boolean; adopted: boolean }> = [];
    for (const subject of subjects) {
      const title = textbookTitleForSubject(subject.subjectName);
      const created = await this.authoring.createTextbook(ctx, {
        subjectKey: subject.subjectKey,
        gradeKey: subject.gradeKey,
        part: input.part,
        title,
        edition: input.edition,
        issuer: input.issuer ?? null,
        publishYear: input.publishYear ?? null,
      });

      let textbookKey: string | null = null;
      let createdFlag = false;
      if (created.ok) {
        textbookKey = created.value.key;
        createdFlag = true;
      } else if (created.error.code === 'content.textbook_exists') {
        const existing = await this.repo.findTextbookByCoordinates({
          subjectKey: subject.subjectKey,
          gradeKey: subject.gradeKey,
          part: input.part,
          edition: input.edition,
        });
        textbookKey = existing?.key ?? null;
      } else {
        return Err(created.error);
      }
      if (!textbookKey) {
        return Err(
          Errors.conflict(
            'content.textbook_lookup_failed',
            'The textbook already exists but could not be resolved from its coordinates.',
            {
              subjectKey: subject.subjectKey,
              gradeKey: subject.gradeKey,
              part: input.part,
              edition: input.edition,
            },
          ),
        );
      }

      let adopted = false;
      if (input.adopt) {
        const adoptionInput = {
          textbookKey,
          schoolKey: input.adopt.schoolKey,
          academicYearKey: input.adopt.academicYearKey,
        };
        const existingAdoption = await this.repo.findAdoption(adoptionInput);
        if (!existingAdoption) {
          const deployment = await this.adopt(ctx, adoptionInput);
          if (!deployment.ok) return deployment;
          adopted = true;
        }
      }
      rows.push({ subjectKey: subject.subjectKey, textbookKey, title, created: createdFlag, adopted });
    }

    await this.audit(ctx, 'content.grade_textbooks_ensured', input.gradeKey, {
      gradeKey: input.gradeKey,
      part: input.part,
      edition: input.edition,
    });

    return Ok({
      gradeKey: input.gradeKey,
      part: input.part,
      edition: input.edition,
      created: rows.filter((row) => row.created).length,
      unchanged: rows.filter((row) => !row.created).length,
      adopted: rows.filter((row) => row.adopted).length,
      rows,
    });
  }

  /**
   * Accredit a whole grade's textbooks for a school in one call — one book
   * (`textbookKey` given) or every book that grade has (`textbookKey`
   * omitted). Existing adoptions are left untouched rather than reported as
   * an error: naming a grade should be safe to repeat, the same idempotency
   * `ensureTextbooksForGrade` already gives the setup flow.
   */
  async adoptGrade(
    ctx: AdminContext,
    input: {
      gradeKey: string;
      part?: 'PART_1' | 'PART_2' | undefined;
      textbookKey?: string | undefined;
      schoolKey: string;
      academicYearKey: string;
    },
  ): Promise<
    Result<{
      gradeKey: string;
      schoolKey: string;
      academicYearKey: string;
      adopted: number;
      alreadyAdopted: number;
      rows: readonly { textbookKey: string; title: string; adopted: boolean }[];
    }>
  > {
    for (const [what, exists] of [
      ['schoolKey', await this.repo.schoolExists(input.schoolKey)],
      ['academicYearKey', await this.repo.academicYearExists(input.academicYearKey)],
    ] as const) {
      if (!exists) {
        return Err(
          Errors.notFound('content.adoption_coordinate_not_found', 'That does not exist.', {
            missing: [what],
          }),
        );
      }
    }

    let candidateKeys: readonly string[];
    if (input.textbookKey) {
      const textbook = await this.repo.textbookForAdoption(input.textbookKey);
      if (!textbook) {
        return Err(
          Errors.notFound('content.textbook_not_found', 'No such textbook.', {
            textbookKey: input.textbookKey,
          }),
        );
      }
      if (textbook.gradeKey !== input.gradeKey) {
        return Err(
          Errors.validation(
            'content.adoption_grade_mismatch',
            'The selected textbook does not belong to the requested grade.',
            { textbookKey: input.textbookKey, textbookGradeKey: textbook.gradeKey, gradeKey: input.gradeKey },
          ),
        );
      }
      if (input.part && textbook.part !== input.part) {
        return Err(
          Errors.validation(
            'content.adoption_part_mismatch',
            'The selected textbook does not belong to the requested physical part.',
            { textbookKey: input.textbookKey, textbookPart: textbook.part, part: input.part },
          ),
        );
      }
      candidateKeys = [textbook.key];
    } else {
      const candidates = await this.repo.textbooksForGrade({
        gradeKey: input.gradeKey,
        part: input.part,
      });
      if (candidates.length === 0) {
        return Err(
          Errors.validation(
            'content.grade_has_no_textbooks',
            'This grade has no textbooks to accredit yet.',
            { gradeKey: input.gradeKey, part: input.part ?? null },
          ),
        );
      }
      candidateKeys = candidates.map((candidate) => candidate.key);
    }

    const rows: Array<{ textbookKey: string; title: string; adopted: boolean }> = [];
    for (const textbookKey of candidateKeys) {
      const adoptionInput = {
        textbookKey,
        schoolKey: input.schoolKey,
        academicYearKey: input.academicYearKey,
      };
      const existing = await this.repo.findAdoption(adoptionInput);
      if (existing) {
        rows.push({ textbookKey, title: existing.textbookTitle, adopted: false });
        continue;
      }
      const created = await this.adopt(ctx, adoptionInput);
      if (!created.ok) return created;
      rows.push({ textbookKey, title: created.value.textbookTitle, adopted: true });
    }

    await this.audit(ctx, 'content.grade_accredited', input.gradeKey, {
      gradeKey: input.gradeKey,
      schoolKey: input.schoolKey,
      academicYearKey: input.academicYearKey,
    });

    return Ok({
      gradeKey: input.gradeKey,
      schoolKey: input.schoolKey,
      academicYearKey: input.academicYearKey,
      adopted: rows.filter((row) => row.adopted).length,
      alreadyAdopted: rows.filter((row) => !row.adopted).length,
      rows,
    });
  }

  async listAdoptions(query: {
    textbookKey?: string | undefined;
    schoolKey?: string | undefined;
    academicYearKey?: string | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
  }): Promise<Result<AdoptionListPage>> {
    return Ok(
      await this.repo.listAdoptions({
        ...(query.textbookKey ? { textbookKey: query.textbookKey } : {}),
        ...(query.schoolKey ? { schoolKey: query.schoolKey } : {}),
        ...(query.academicYearKey ? { academicYearKey: query.academicYearKey } : {}),
        limit: Math.min(Math.max(query.limit ?? 25, 1), 100),
        offset: Math.max(query.offset ?? 0, 0),
      }),
    );
  }

  /**
   * Record that a school teaches a printed edition in an academic year.
   *
   * Every coordinate is resolved by business key and refused by name when
   * missing, so the caller can be told exactly which one was wrong. A repeat
   * of an existing adoption is a conflict, not an update — there is nothing
   * else on the row to change.
   */
  async adopt(
    ctx: AdminContext,
    input: { textbookKey: string; schoolKey: string; academicYearKey: string },
  ): Promise<Result<AdoptionRow>> {
    for (const [what, exists] of [
      ['textbookKey', await this.repo.textbookExists(input.textbookKey)],
      ['schoolKey', await this.repo.schoolExists(input.schoolKey)],
      ['academicYearKey', await this.repo.academicYearExists(input.academicYearKey)],
    ] as const) {
      if (!exists) {
        return Err(
          Errors.notFound('content.adoption_coordinate_not_found', 'That does not exist.', {
            missing: [what],
          }),
        );
      }
    }

    const parsed = parseTextbookKey(input.textbookKey);
    if (!parsed.ok) return parsed;
    const termOrdinal = parsed.value.part === 'PART_1' ? 1 : 2;
    const termKey = await this.repo.termForAcademicYearOrdinal(input.academicYearKey, termOrdinal);
    if (!termKey) {
      return Err(
        Errors.notFound('content.adoption_term_not_found', 'The academic term required by this textbook part does not exist in the selected academic year.', {
          academicYearKey: input.academicYearKey,
          ordinal: termOrdinal,
          part: parsed.value.part,
        }),
      );
    }

    const existing = await this.repo.findAdoption(input);
    if (existing) {
      return Err(
        Errors.conflict(
          'content.adoption_exists',
          'That school already teaches that textbook in that academic year.',
          {
            textbookKey: input.textbookKey,
            schoolKey: input.schoolKey,
            academicYearKey: input.academicYearKey,
          },
        ),
      );
    }

    const created = await this.repo.createAdoption({ ...input, termKey });
    await this.audit(ctx, 'content.textbook_adopted', input.textbookKey, input);
    return Ok(created);
  }

  /**
   * Withdraw a deployment fact. Learners at that school lose entitlement to
   * the book at read time — the entitlement is derived, never stored, so
   * removing the adoption cannot orphan anything.
   */
  async unadopt(
    ctx: AdminContext,
    input: { textbookKey: string; schoolKey: string; academicYearKey: string },
  ): Promise<Result<{ textbookKey: string; schoolKey: string; academicYearKey: string }>> {
    const existing = await this.repo.findAdoption(input);
    if (!existing) {
      return Err(
        Errors.notFound(
          'content.adoption_not_found',
          'That school does not teach that textbook in that academic year.',
          input,
        ),
      );
    }

    await this.repo.deleteAdoption(input);
    await this.audit(ctx, 'content.textbook_unadopted', input.textbookKey, input);
    return Ok(input);
  }

  private async audit(
    ctx: AdminContext,
    action: string,
    targetKey: string,
    details: Record<string, string>,
  ): Promise<void> {
    try {
      await this.auditWriter.record({ actorKey: ctx.actorKey, action, targetKey, details });
    } catch {
      // Best-effort, like every other audit writer here: a lost audit line
      // must not fail the administrative act it describes.
    }
  }
}
