/**
 * Prisma adapter for textbook administration: the catalogue browser and the
 * adoption ledger.
 *
 * Reads assemble names alongside keys — an administrator triages "which book,
 * which school", not "EDU-MATH-G07-P1-ED2026 at sch_demo". Names are
 * presentation fields on a read model, the same shape GuardianChild uses.
 *
 * Sequential, like every other adapter: PGlite serves one connection in
 * development and concurrent Prisma calls deadlock on it.
 */

import type {
  AdoptionListPage,
  AdoptionListQuery,
  AdoptionRow,
  ConceptDetail,
  LessonMaterial,
  OutlineUnit,
  TextbookAdministrationRepository,
  TextbookCoordinateMatch,
  TextbookListPage,
  TextbookListQuery,
  TextbookSummary,
} from '../../contexts/content/application/ports.js';
import type { PublicationState } from '../../contexts/content/domain/publication.js';
import type { Db } from './prisma.client.js';

export class PrismaTextbookAdministrationRepository implements TextbookAdministrationRepository {
  constructor(private readonly db: Db) {}

  async listTextbooks(query: TextbookListQuery): Promise<TextbookListPage> {
    const search = query.search?.trim();
    const where = {
      ...(search ? { title: { contains: search, mode: 'insensitive' as const } } : {}),
      ...(query.subjectKey ? { subject: { key: query.subjectKey } } : {}),
      ...(query.gradeKey ? { grade: { key: query.gradeKey } } : {}),
      ...(query.part ? { part: query.part } : {}),
      ...(query.status ? { status: query.status as never } : {}),
    };

    const total = await this.db.textbook.count({ where });
    const rows = await this.db.textbook.findMany({
      where,
      orderBy: [{ subject: { key: 'asc' } }, { grade: { ordinal: 'asc' } }, { key: 'asc' }],
      take: query.limit,
      skip: query.offset,
      select: {
        key: true,
        title: true,
        edition: true,
        status: true,
        updatedAt: true,
        subject: { select: { key: true, name: true } },
        grade: { select: { key: true, name: true } },
        part: true,
        assets: {
          where: { scope: 'TEXTBOOK', isActive: true, relativePath: { startsWith: 'cover/' } },
          select: { key: true },
          take: 1,
        },
        _count: { select: { adoptions: true, units: true } },
      },
    });

    // Questions hang off lessons, not the book, so their count cannot come
    // from `_count` on the textbook row. One bounded second query per page —
    // the page's books only — keeps the number honest without fetching the
    // questions themselves.
    const pageKeys = rows.map((row) => row.key);
    const lessonRows =
      pageKeys.length > 0
        ? await this.db.lesson.findMany({
            where: { unit: { textbook: { key: { in: pageKeys } } } },
            select: {
              _count: { select: { questions: true } },
              unit: { select: { textbook: { select: { key: true } } } },
            },
          })
        : [];
    const questionCountByKey = new Map<string, number>();
    for (const lesson of lessonRows) {
      const key = lesson.unit.textbook.key;
      questionCountByKey.set(key, (questionCountByKey.get(key) ?? 0) + lesson._count.questions);
    }

    return {
      total,
      rows: rows.map((row) => ({
        key: row.key,
        title: row.title,
        subjectKey: row.subject.key,
        subjectName: row.subject.name,
        gradeKey: row.grade.key,
        gradeName: row.grade.name,
        part: row.part,
        edition: row.edition,
        status: String(row.status),
        adoptionCount: row._count.adoptions,
        unitCount: row._count.units,
        questionCount: questionCountByKey.get(row.key) ?? 0,
        updatedAt: row.updatedAt,
        coverUrl: row.assets[0] ? `/api/v1/content/assets/${encodeURIComponent(row.assets[0].key)}/stream` : null,
      })),
    };
  }

  async findTextbookByCoordinates(input: {
    subjectKey: string;
    gradeKey: string;
    part: 'PART_1' | 'PART_2';
    edition: string;
  }) {
    const row = await this.db.textbook.findFirst({
      where: {
        subject: { key: input.subjectKey },
        grade: { key: input.gradeKey },
        part: input.part,
        edition: input.edition,
      },
      select: { key: true, title: true, edition: true },
    });
    return row;
  }

  async textbooksForGrade(input: {
    gradeKey: string;
    part?: 'PART_1' | 'PART_2' | undefined;
  }): Promise<TextbookCoordinateMatch[]> {
    const rows = await this.db.textbook.findMany({
      where: {
        grade: { key: input.gradeKey },
        ...(input.part ? { part: input.part } : {}),
      },
      select: { key: true, title: true, edition: true },
      orderBy: { key: 'asc' },
    });
    return rows;
  }

  async activeGradeSubjects(gradeKey: string) {
    const grade = await this.db.grade.findUnique({
      where: { key: gradeKey },
      select: { key: true, name: true },
    });
    if (!grade) return null;
    const rows = await this.db.gradeSubject.findMany({
      where: { grade: { key: gradeKey, isActive: true }, subject: { isActive: true }, isActive: true },
      select: { subject: { select: { key: true, name: true } } },
      orderBy: { subject: { key: 'asc' } },
    });
    return rows.map((row) => ({
      gradeKey: grade.key,
      gradeName: grade.name,
      subjectKey: row.subject.key,
      subjectName: row.subject.name,
    }));
  }

  /**
   * The outline: top-level units with their lessons and honest counts.
   * Nested units (branches) are folded into their parent's lesson list —
   * the browse is a table of contents, not a tree widget.
   */
  async textbookOutline(textbookKey: string): Promise<OutlineUnit[] | null> {
    const book = await this.db.textbook.findUnique({
      where: { key: textbookKey },
      select: { id: true },
    });
    if (!book) return null;

    const units = await this.db.unit.findMany({
      where: { textbookId: book.id, parentId: null, isActive: true },
      select: {
        key: true,
        name: true,
        orderIndex: true,
        lessons: {
          select: {
            key: true,
            name: true,
            orderIndex: true,
            estimatedMins: true,
            isActive: true,
            concepts: {
              where: { isActive: true },
              select: { key: true, name: true, orderIndex: true, _count: { select: { resources: true } } },
              orderBy: { orderIndex: 'asc' },
            },
            _count: { select: { concepts: true, resources: true } },
          },
          orderBy: { orderIndex: 'asc' },
        },
      },
      orderBy: { orderIndex: 'asc' },
    });

    return units.map((unit) => ({
      key: unit.key,
      name: unit.name,
      orderIndex: unit.orderIndex,
      lessons: unit.lessons
        .filter((lesson) => lesson.isActive)
        .map((lesson) => ({
          key: lesson.key,
          name: lesson.name,
          orderIndex: lesson.orderIndex,
          conceptCount: lesson._count.concepts,
          concepts: lesson.concepts.map((concept) => ({
            key: concept.key,
            name: concept.name,
            orderIndex: concept.orderIndex,
          })),
          resourceCount:
            lesson._count.resources + lesson.concepts.reduce((sum, concept) => sum + concept._count.resources, 0),
          estimatedMins: lesson.estimatedMins,
        })),
    }));
  }

  /** One lesson's materials, in the author's chosen order. */
  async lessonMaterials(lessonKey: string): Promise<LessonMaterial[] | null> {
    const lesson = await this.db.lesson.findUnique({
      where: { key: lessonKey },
      select: {
        id: true,
        resources: {
          where: { isActive: true },
          select: {
            key: true,
            kind: true,
            title: true,
            url: true,
            body: true,
            estimatedMins: true,
            orderIndex: true,
          },
          orderBy: { orderIndex: 'asc' },
        },
        concepts: {
          select: {
            key: true,
            name: true,
            resources: {
              where: { isActive: true },
              select: {
                key: true,
                kind: true,
                title: true,
                url: true,
                body: true,
                estimatedMins: true,
                orderIndex: true,
              },
              orderBy: { orderIndex: 'asc' },
            },
          },
          orderBy: { orderIndex: 'asc' },
        },
      },
    });
    if (!lesson) return null;
    const lessonResources = lesson.resources.map((resource) => ({
      ...resource,
      scope: 'LESSON' as const,
      conceptKey: null,
      conceptName: null,
    }));
    const conceptResources = lesson.concepts.flatMap((concept) =>
      concept.resources.map((resource) => ({
        ...resource,
        scope: 'CONCEPT' as const,
        conceptKey: concept.key,
        conceptName: concept.name,
      })),
    );
    return [...lessonResources, ...conceptResources].sort(
      (a, b) => a.orderIndex - b.orderIndex || a.title.localeCompare(b.title),
    );
  }

  /**
   * A concept's authoring detail for the content-tree drawer: its named
   * misconceptions, what it still requires, and what already requires it.
   *
   * `requires`/`requiredBy` are two separate queries rather than one
   * bidirectional `OR` — a prerequisite is directional, and an author
   * choosing a new prerequisite needs to see both ends of the graph without
   * having to work out which `strength`/`requiredMastery` belongs to which
   * direction from a merged row.
   */
  async conceptDetail(conceptKey: string): Promise<ConceptDetail | null> {
    const concept = await this.db.concept.findUnique({
      where: { key: conceptKey },
      select: {
        key: true,
        name: true,
        lesson: {
          select: {
            key: true,
            name: true,
            unit: { select: { textbook: { select: { key: true, status: true } } } },
          },
        },
        misconceptions: {
          select: { key: true, name: true, description: true, remediation: true },
          orderBy: { name: 'asc' },
        },
        requires: {
          select: {
            strength: true,
            requiredMastery: true,
            prerequisite: {
              select: {
                key: true,
                name: true,
                lesson: { select: { unit: { select: { textbook: { select: { key: true, title: true } } } } } },
              },
            },
          },
        },
        requiredBy: {
          select: {
            strength: true,
            requiredMastery: true,
            concept: { select: { key: true, name: true } },
          },
        },
      },
    });
    if (!concept) return null;

    return {
      key: concept.key,
      name: concept.name,
      lessonKey: concept.lesson.key,
      lessonName: concept.lesson.name,
      textbookKey: concept.lesson.unit.textbook.key,
      textbookStatus: concept.lesson.unit.textbook.status as PublicationState,
      misconceptions: concept.misconceptions,
      requires: concept.requires.map((edge) => ({
        conceptKey: edge.prerequisite.key,
        conceptName: edge.prerequisite.name,
        textbookKey: edge.prerequisite.lesson.unit.textbook.key,
        textbookTitle: edge.prerequisite.lesson.unit.textbook.title,
        strength: edge.strength,
        requiredMastery: edge.requiredMastery,
      })),
      requiredBy: concept.requiredBy.map((edge) => ({
        conceptKey: edge.concept.key,
        conceptName: edge.concept.name,
        strength: edge.strength,
        requiredMastery: edge.requiredMastery,
      })),
    };
  }

  async listAdoptions(query: AdoptionListQuery): Promise<AdoptionListPage> {
    const where = {
      ...(query.textbookKey ? { textbook: { key: query.textbookKey } } : {}),
      ...(query.schoolKey ? { school: { key: query.schoolKey } } : {}),
      ...(query.academicYearKey ? { academicYear: { key: query.academicYearKey } } : {}),
    };

    const total = await this.db.textbookAdoption.count({ where });
    const rows = await this.db.textbookAdoption.findMany({
      where,
      orderBy: { adoptedAt: 'desc' },
      take: query.limit,
      skip: query.offset,
      select: {
        adoptedAt: true,
        textbook: { select: { key: true, title: true, status: true } },
        school: { select: { key: true, name: true } },
        academicYear: { select: { key: true } },
        term: { select: { key: true } },
      },
    });

    return {
      total,
      rows: rows.map((row) => ({
        textbookKey: row.textbook.key,
        textbookTitle: row.textbook.title,
        textbookStatus: String(row.textbook.status),
        schoolKey: row.school.key,
        schoolName: row.school.name,
        academicYearKey: row.academicYear.key,
        termKey: row.term.key,
        adoptedAt: row.adoptedAt,
      })),
    };
  }

  async findAdoption(input: {
    textbookKey: string;
    schoolKey: string;
    academicYearKey: string;
  }): Promise<AdoptionRow | null> {
    const row = await this.db.textbookAdoption.findFirst({
      where: {
        textbook: { key: input.textbookKey },
        school: { key: input.schoolKey },
        academicYear: { key: input.academicYearKey },
      },
      select: {
        adoptedAt: true,
        textbook: { select: { key: true, title: true, status: true } },
        school: { select: { key: true, name: true } },
        academicYear: { select: { key: true } },
        term: { select: { key: true } },
      },
    });
    if (!row) return null;
    return {
      textbookKey: row.textbook.key,
      textbookTitle: row.textbook.title,
      textbookStatus: String(row.textbook.status),
      schoolKey: row.school.key,
      schoolName: row.school.name,
      academicYearKey: row.academicYear.key,
      termKey: row.term.key,
      adoptedAt: row.adoptedAt,
    };
  }

  async createAdoption(input: {
    textbookKey: string;
    schoolKey: string;
    academicYearKey: string;
    termKey: string;
  }): Promise<AdoptionRow> {
    const created = await this.db.textbookAdoption.create({
      data: {
        textbook: { connect: { key: input.textbookKey } },
        school: { connect: { key: input.schoolKey } },
        academicYear: { connect: { key: input.academicYearKey } },
        term: { connect: { key: input.termKey } },
      },
      select: {
        adoptedAt: true,
        textbook: { select: { key: true, title: true, status: true } },
        school: { select: { key: true, name: true } },
        academicYear: { select: { key: true } },
        term: { select: { key: true } },
      },
    });
    return {
      textbookKey: created.textbook.key,
      textbookTitle: created.textbook.title,
      textbookStatus: String(created.textbook.status),
      schoolKey: created.school.key,
      schoolName: created.school.name,
      academicYearKey: created.academicYear.key,
      termKey: created.term.key,
      adoptedAt: created.adoptedAt,
    };
  }

  async deleteAdoption(input: {
    textbookKey: string;
    schoolKey: string;
    academicYearKey: string;
  }): Promise<void> {
    await this.db.textbookAdoption.deleteMany({
      where: {
        textbook: { key: input.textbookKey },
        school: { key: input.schoolKey },
        academicYear: { key: input.academicYearKey },
      },
    });
  }

  async textbookExists(textbookKey: string): Promise<boolean> {
    const row = await this.db.textbook.findUnique({ where: { key: textbookKey }, select: { key: true } });
    return row !== null;
  }

  async schoolExists(schoolKey: string): Promise<boolean> {
    const row = await this.db.school.findUnique({ where: { key: schoolKey }, select: { key: true } });
    return row !== null;
  }

  async academicYearExists(academicYearKey: string): Promise<boolean> {
    const row = await this.db.academicYear.findUnique({
      where: { key: academicYearKey },
      select: { key: true },
    });
    return row !== null;
  }

  async termExists(termKey: string): Promise<boolean> {
    const row = await this.db.term.findUnique({ where: { key: termKey }, select: { key: true } });
    return row !== null;
  }
}
