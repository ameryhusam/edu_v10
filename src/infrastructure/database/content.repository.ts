/**
 * Prisma adapter for the Content write ports.
 *
 * This is the ONLY place in the codebase that writes the content tree. Every
 * other repository over content is read-only by construction.
 *
 * Two details are load-bearing:
 *
 *  - Lifecycle is always read from the owning TEXTBOOK, however deep the node
 *    sits. A per-node status would be a second axis, and two axes always
 *    eventually disagree — which is exactly the legacy bug this design exists
 *    to avoid.
 *  - Reorders run in a transaction with a two-phase renumber, because
 *    `@@unique([parentId, orderIndex])` rejects the intermediate states of a
 *    naive in-place swap.
 */

import { Errors, DomainErrorException } from '../../shared/kernel/errors.js';
import type {
  ContentAuditWriter,
  ContentRepository,
  CreatedNode,
  ExportableTextbook,
  NodeContext,
} from '../../contexts/content/application/ports.js';
import type { ContentNodeKind } from '../../contexts/content/domain/authoring.js';
import type { PublicationState } from '../../contexts/content/domain/publication.js';
import type { TextbookStructure } from '../../contexts/content/domain/structural-validation.js';
import type { Db } from './prisma.client.js';
import type { ResourceKind } from '@prisma/client';

export class PrismaContentRepository implements ContentRepository {
  constructor(private readonly db: Db) {}

  async findNode(kind: ContentNodeKind, key: string): Promise<NodeContext | null> {
    switch (kind) {
      case 'textbook': {
        const row = await this.db.textbook.findUnique({
          where: { key },
          select: { key: true, status: true },
        });
        return row
          ? {
              kind,
              key: row.key,
              slug: '',
              textbookKey: row.key,
              textbookStatus: row.status as PublicationState,
            }
          : null;
      }
      case 'unit': {
        const row = await this.db.unit.findUnique({
          where: { key },
          select: { key: true, slug: true, textbook: { select: { key: true, status: true } } },
        });
        return row
          ? {
              kind,
              key: row.key,
              slug: row.slug,
              textbookKey: row.textbook.key,
              textbookStatus: row.textbook.status as PublicationState,
            }
          : null;
      }
      case 'lesson': {
        const row = await this.db.lesson.findUnique({
          where: { key },
          select: {
            key: true,
            slug: true,
            unit: { select: { textbook: { select: { key: true, status: true } } } },
          },
        });
        return row
          ? {
              kind,
              key: row.key,
              slug: row.slug,
              textbookKey: row.unit.textbook.key,
              textbookStatus: row.unit.textbook.status as PublicationState,
            }
          : null;
      }
      case 'concept': {
        const row = await this.db.concept.findUnique({
          where: { key },
          select: {
            key: true,
            slug: true,
            lesson: {
              select: { unit: { select: { textbook: { select: { key: true, status: true } } } } },
            },
          },
        });
        return row
          ? {
              kind,
              key: row.key,
              slug: row.slug,
              textbookKey: row.lesson.unit.textbook.key,
              textbookStatus: row.lesson.unit.textbook.status as PublicationState,
            }
          : null;
      }
    }
  }

  async slugTaken(kind: ContentNodeKind, parentKey: string, slug: string): Promise<boolean> {
    switch (kind) {
      case 'unit': {
        // A unit's parent is either the textbook (top level) or another unit.
        const count = await this.db.unit.count({
          where: {
            slug,
            OR: [{ textbook: { key: parentKey } }, { parent: { key: parentKey } }],
          },
        });
        return count > 0;
      }
      case 'lesson':
        return (await this.db.lesson.count({ where: { slug, unit: { key: parentKey } } })) > 0;
      case 'concept':
        return (await this.db.concept.count({ where: { slug, lesson: { key: parentKey } } })) > 0;
      case 'textbook':
        return false;
    }
  }

  async nextOrderIndex(kind: ContentNodeKind, parentKey: string): Promise<number> {
    const keys = await this.siblingKeys(kind, parentKey);
    return keys.length + 1;
  }

  async resolveTextbookCoordinates(input: {
    subjectKey: string;
    gradeKey: string;
    termKey: string;
  }): Promise<{
    subject: { id: string; key: string; name: string } | null;
    grade: { id: string; key: string; ordinal: number; name: string } | null;
    term: { id: string; key: string; ordinal: number; name: string } | null;
  }> {
    // Sequential, not Promise.all: the dev database serves one connection and
    // parallel queries kill it mid-flight.
    const subject = await this.db.subject.findUnique({
      where: { key: input.subjectKey },
      select: { id: true, key: true, name: true },
    });
    const grade = await this.db.grade.findUnique({
      where: { key: input.gradeKey },
      select: { id: true, key: true, ordinal: true, name: true },
    });
    const term = await this.db.term.findUnique({
      where: { key: input.termKey },
      select: { id: true, key: true, ordinal: true, name: true },
    });
    return { subject, grade, term };
  }

  async textbookExists(key: string): Promise<boolean> {
    const found = await this.db.textbook.findUnique({ where: { key }, select: { id: true } });
    return found !== null;
  }

  async createTextbook(input: {
    key: string;
    subjectId: string;
    gradeId: string;
    termId: string;
    title: string;
    edition: string;
    description?: string | null;
    issuer?: string | null;
    isbn?: string | null;
    publishYear?: number | null;
    totalPages?: number | null;
  }): Promise<{ key: string; title: string; edition: string; status: string }> {
    const created = await this.db.textbook.create({
      data: {
        key: input.key,
        subjectId: input.subjectId,
        gradeId: input.gradeId,
        termId: input.termId,
        title: input.title,
        edition: input.edition,
        description: input.description ?? null,
        issuer: input.issuer ?? null,
        isbn: input.isbn ?? null,
        publishYear: input.publishYear ?? null,
        totalPages: input.totalPages ?? null,
        // Always DRAFT. A book that arrived already published would skip the
        // two-actor review the publication lifecycle exists to enforce.
      },
      select: { key: true, title: true, edition: true, status: true },
    });
    return created;
  }

  async createUnit(input: {
    textbookKey: string;
    parentUnitKey?: string | null;
    key: string;
    slug: string;
    name: string;
    orderIndex: number;
    startPage?: number | null;
    endPage?: number | null;
    sourceRef?: string | null;
  }): Promise<CreatedNode> {
    const textbook = await this.db.textbook.findUniqueOrThrow({
      where: { key: input.textbookKey },
      select: { id: true },
    });
    const parent = input.parentUnitKey
      ? await this.db.unit.findUniqueOrThrow({
          where: { key: input.parentUnitKey },
          select: { id: true },
        })
      : null;

    const row = await this.db.unit.create({
      data: {
        key: input.key,
        slug: input.slug,
        name: input.name,
        orderIndex: input.orderIndex,
        startPage: input.startPage ?? null,
        endPage: input.endPage ?? null,
        sourceRef: input.sourceRef ?? null,
        textbookId: textbook.id,
        parentId: parent?.id ?? null,
      },
      select: { key: true, slug: true, name: true, orderIndex: true },
    });
    return { kind: 'unit', ...row };
  }

  async createLesson(input: {
    unitKey: string;
    key: string;
    slug: string;
    name: string;
    description?: string | null;
    orderIndex: number;
    estimatedMins?: number | null;
    startPage?: number | null;
    endPage?: number | null;
    sourceRef?: string | null;
  }): Promise<CreatedNode> {
    const unit = await this.db.unit.findUniqueOrThrow({
      where: { key: input.unitKey },
      select: { id: true },
    });
    const row = await this.db.lesson.create({
      data: {
        key: input.key,
        slug: input.slug,
        name: input.name,
        description: input.description ?? null,
        orderIndex: input.orderIndex,
        estimatedMins: input.estimatedMins ?? null,
        startPage: input.startPage ?? null,
        endPage: input.endPage ?? null,
        sourceRef: input.sourceRef ?? null,
        unitId: unit.id,
      },
      select: { key: true, slug: true, name: true, orderIndex: true },
    });
    return { kind: 'lesson', ...row };
  }

  /**
   * Attach a misconception, tolerating one that is already there.
   *
   * `findFirst` before `create` rather than an upsert: an upsert would
   * overwrite an author's later edit with whatever the package happens to say,
   * turning a re-import into silent data loss. Existing content wins.
   */
  async createMisconception(input: {
    conceptKey: string;
    key: string;
    slug: string;
    name: string;
    description: string;
    remediation?: string | null;
  }): Promise<{ key: string } | null> {
    const existing = await this.db.misconception.findUnique({
      where: { key: input.key },
      select: { key: true },
    });
    if (existing) return null;

    const concept = await this.db.concept.findUniqueOrThrow({
      where: { key: input.conceptKey },
      select: { id: true },
    });
    const row = await this.db.misconception.create({
      data: {
        key: input.key,
        slug: input.slug,
        conceptId: concept.id,
        name: input.name,
        description: input.description,
        remediation: input.remediation ?? null,
      },
      select: { key: true },
    });
    return row;
  }

  /** Same read-then-create rule as `createMisconception`. */
  async createLearningResource(input: {
    textbookKey?: string | null;
    lessonKey?: string | null;
    conceptKey?: string | null;
    key: string;
    slug: string;
    kind: string;
    title: string;
    body?: string | null;
    url?: string | null;
    orderIndex?: number;
    pageStart?: number | null;
    pageEnd?: number | null;
    estimatedMins?: number | null;
  }): Promise<{ key: string } | null> {
    const existing = await this.db.learningResource.findUnique({
      where: { key: input.key },
      select: { key: true },
    });
    if (existing) return null;

    let textbookId: string | null = null;
    let lessonId: string | null = null;
    let conceptId: string | null = null;

    if (input.conceptKey) {
      const concept = await this.db.concept.findUniqueOrThrow({
        where: { key: input.conceptKey },
        select: { id: true, lesson: { select: { unit: { select: { textbookId: true } } } } },
      });
      conceptId = concept.id;
      textbookId = concept.lesson.unit.textbookId;
    } else if (input.lessonKey) {
      const lesson = await this.db.lesson.findUniqueOrThrow({
        where: { key: input.lessonKey },
        select: { id: true, unit: { select: { textbookId: true } } },
      });
      lessonId = lesson.id;
      textbookId = lesson.unit.textbookId;
    } else if (input.textbookKey) {
      const textbook = await this.db.textbook.findUniqueOrThrow({
        where: { key: input.textbookKey },
        select: { id: true },
      });
      textbookId = textbook.id;
    }

    const row = await this.db.learningResource.create({
      data: {
        key: input.key,
        slug: input.slug,
        textbookId,
        lessonId,
        conceptId,
        kind: input.kind as ResourceKind,
        title: input.title,
        body: input.body ?? null,
        url: input.url ?? null,
        orderIndex: input.orderIndex ?? 0,
        pageStart: input.pageStart ?? null,
        pageEnd: input.pageEnd ?? null,
        estimatedMins: input.estimatedMins ?? null,
      },
      select: { key: true },
    });
    return row;
  }

  async createConcept(input: {
    lessonKey: string;
    key: string;
    slug: string;
    name: string;
    description?: string | null;
    orderIndex: number;
    difficulty?: number;
    importance?: number;
    masteryThreshold?: number;
    isCore?: boolean;
    pageNumber?: number | null;
    sourceRef?: string | null;
    nameEn?: string | null;
    bloomsLevel?: string | null;
  }): Promise<CreatedNode> {
    const lesson = await this.db.lesson.findUniqueOrThrow({
      where: { key: input.lessonKey },
      select: { id: true },
    });
    const row = await this.db.concept.create({
      data: {
        key: input.key,
        slug: input.slug,
        name: input.name,
        description: input.description ?? null,
        orderIndex: input.orderIndex,
        pageNumber: input.pageNumber ?? null,
        sourceRef: input.sourceRef ?? null,
        nameEn: input.nameEn ?? null,
        bloomsLevel: input.bloomsLevel ?? null,
        lessonId: lesson.id,
        ...(input.difficulty != null ? { difficulty: input.difficulty } : {}),
        ...(input.importance != null ? { importance: input.importance } : {}),
        ...(input.masteryThreshold != null ? { masteryThreshold: input.masteryThreshold } : {}),
        ...(input.isCore != null ? { isCore: input.isCore } : {}),
      },
      select: { key: true, slug: true, name: true, orderIndex: true },
    });
    return { kind: 'concept', ...row };
  }

  /**
   * Patch pre-validated fields.
   *
   * The application layer has already checked these against a per-kind
   * allow-list, so this does not re-derive policy — but it does refuse `slug`
   * and `key` outright as a last line of defence, because a bug upstream must
   * not be able to re-identify content.
   */
  async updateNode(
    kind: ContentNodeKind,
    key: string,
    fields: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    if ('slug' in fields || 'key' in fields) {
      throw new DomainErrorException(
        Errors.conflict('content.slug_immutable', 'Identity fields cannot be updated.', { key }),
      );
    }
    const data = fields as Record<string, never>;

    switch (kind) {
      case 'textbook':
        await this.db.textbook.update({ where: { key }, data });
        return;
      case 'unit':
        await this.db.unit.update({ where: { key }, data });
        return;
      case 'lesson':
        await this.db.lesson.update({ where: { key }, data });
        return;
      case 'concept':
        await this.db.concept.update({ where: { key }, data });
        return;
    }
  }

  async siblingKeys(kind: ContentNodeKind, parentKey: string): Promise<string[]> {
    const order = { orderIndex: 'asc' } as const;
    switch (kind) {
      case 'unit': {
        const rows = await this.db.unit.findMany({
          where: { OR: [{ textbook: { key: parentKey } }, { parent: { key: parentKey } }] },
          select: { key: true },
          orderBy: order,
        });
        return rows.map((r) => r.key);
      }
      case 'lesson': {
        const rows = await this.db.lesson.findMany({
          where: { unit: { key: parentKey } },
          select: { key: true },
          orderBy: order,
        });
        return rows.map((r) => r.key);
      }
      case 'concept': {
        const rows = await this.db.concept.findMany({
          where: { lesson: { key: parentKey } },
          select: { key: true },
          orderBy: order,
        });
        return rows.map((r) => r.key);
      }
      case 'textbook':
        return [];
    }
  }

  /**
   * Apply a complete ordering atomically.
   *
   * Two phases: park every sibling at a negative index, then write the final
   * ones. A direct assignment would transiently collide with a row that still
   * holds the target index and trip `@@unique([parentId, orderIndex])`.
   */
  async reorderSiblings(
    kind: ContentNodeKind,
    _parentKey: string,
    orderedKeys: readonly string[],
  ): Promise<void> {
    if (orderedKeys.length === 0) return;

    await this.db.$transaction(async (tx) => {
      const model =
        kind === 'unit' ? tx.unit : kind === 'lesson' ? tx.lesson : tx.concept;

      for (const [i, key] of orderedKeys.entries()) {
        await (model as { update: (a: unknown) => Promise<unknown> }).update({
          where: { key },
          data: { orderIndex: -(i + 1) },
        });
      }
      for (const [i, key] of orderedKeys.entries()) {
        await (model as { update: (a: unknown) => Promise<unknown> }).update({
          where: { key },
          data: { orderIndex: i + 1 },
        });
      }
    });
  }

  async loadStructure(textbookKey: string): Promise<TextbookStructure | null> {
    const textbook = await this.db.textbook.findUnique({
      where: { key: textbookKey },
      select: {
        key: true,
        units: {
          select: {
            key: true,
            orderIndex: true,
            isActive: true,
            parent: { select: { key: true } },
            lessons: {
              select: {
                key: true,
                orderIndex: true,
                isActive: true,
                unit: { select: { key: true } },
                resources: { select: { kind: true, isActive: true } },
                questions: {
                  select: {
                    key: true,
                    concepts: { select: { concept: { select: { key: true } } } },
                  },
                },
                concepts: {
                  select: {
                    key: true,
                    orderIndex: true,
                    isActive: true,
                    masteryThreshold: true,
                    lesson: { select: { key: true } },
                    resources: { select: { kind: true, isActive: true } },
                    flashcards: { select: { isActive: true } },
                    questionLinks: {
                      select: {
                        question: { select: { status: true, type: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!textbook) return null;

    const lessons = textbook.units.flatMap((u) => u.lessons);
    const concepts = lessons.flatMap((l) => l.concepts);
    const conceptKeys = concepts.map((c) => c.key);
    const lessonSupport = lessons.map((lesson) => ({
      lessonKey: lesson.key,
      activeResourceCount: lesson.resources.filter((resource) => resource.isActive).length,
      readingResourceCount: lesson.resources.filter(
        (resource) => resource.isActive && resource.kind === 'READING',
      ).length,
    }));
    const conceptSupport = concepts.map((concept) => ({
      conceptKey: concept.key,
      publishedQuestionCount: concept.questionLinks.filter(
        (link) => link.question.status === 'PUBLISHED',
      ).length,
      autoGradableQuestionCount: concept.questionLinks.filter(
        (link) => link.question.status === 'PUBLISHED' && link.question.type !== 'ESSAY',
      ).length,
      flashcardCount: concept.flashcards.filter((card) => card.isActive).length,
      remedialResourceCount: concept.resources.filter(
        (resource) => resource.isActive && resource.kind === 'REMEDIAL',
      ).length,
    }));
    const unlinkedQuestions = lessons.flatMap((lesson) =>
      lesson.questions
        .filter((question) => question.concepts.length === 0)
        .map((question) => ({ questionKey: question.key, lessonKey: lesson.key })),
    );

    const edges = conceptKeys.length
      ? await this.db.conceptPrerequisite.findMany({
          where: { concept: { key: { in: conceptKeys } } },
          select: {
            strength: true,
            requiredMastery: true,
            concept: { select: { key: true } },
            prerequisite: { select: { key: true } },
          },
        })
      : [];

    return {
      textbookKey: textbook.key,
      units: textbook.units.map((u) => ({
        key: u.key,
        parentKey: u.parent?.key ?? null,
        orderIndex: u.orderIndex,
        isActive: u.isActive,
      })),
      lessons: lessons.map((l) => ({
        key: l.key,
        parentKey: l.unit.key,
        orderIndex: l.orderIndex,
        isActive: l.isActive,
      })),
      concepts: concepts.map((c) => ({
        key: c.key,
        parentKey: c.lesson.key,
        orderIndex: c.orderIndex,
        isActive: c.isActive,
        masteryThreshold: c.masteryThreshold,
      })),
      prerequisites: edges.map((e) => ({
        conceptKey: e.concept.key,
        prerequisiteKey: e.prerequisite.key,
        strength: e.strength,
        requiredMastery: e.requiredMastery,
      })),
      lessonSupport,
      conceptSupport,
      unlinkedQuestions,
    };
  }

  /**
   * One read for the whole exportable book.
   *
   * Sequential awaits, not Promise.all: the dev database serves a single
   * connection and parallel Prisma queries terminate it mid-flight.
   */
  async readExportable(textbookKey: string): Promise<ExportableTextbook | null> {
    const book = await this.db.textbook.findUnique({
      where: { key: textbookKey },
      select: {
        id: true,
        key: true,
        title: true,
        edition: true,
        description: true,
        issuer: true,
        isbn: true,
        publishYear: true,
        totalPages: true,
        status: true,
        subject: { select: { key: true } },
        grade: { select: { key: true } },
        term: { select: { key: true } },
        units: {
          select: {
            key: true,
            slug: true,
            name: true,
            orderIndex: true,
            startPage: true,
            endPage: true,
            isActive: true,
            sourceRef: true,
            parent: { select: { slug: true } },
            lessons: {
              select: {
                key: true,
                slug: true,
                name: true,
                description: true,
                orderIndex: true,
                estimatedMins: true,
                startPage: true,
                endPage: true,
                isActive: true,
                sourceRef: true,
                concepts: {
                  select: {
                    key: true,
                    slug: true,
                    name: true,
                    description: true,
                    orderIndex: true,
                    difficulty: true,
                    importance: true,
                    masteryThreshold: true,
                    isCore: true,
                    isActive: true,
                    pageNumber: true,
                    sourceRef: true,
                    nameEn: true,
                    bloomsLevel: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!book) return null;

    const units = book.units.map((u) => ({
      key: u.key,
      slug: u.slug,
      parentUnitSlug: u.parent?.slug ?? null,
      name: u.name,
      orderIndex: u.orderIndex,
      startPage: u.startPage,
      endPage: u.endPage,
      isActive: u.isActive,
      sourceRef: u.sourceRef,
    }));

    const lessons = book.units.flatMap((u) =>
      u.lessons.map((l) => ({
        key: l.key,
        slug: l.slug,
        unitSlug: u.slug,
        name: l.name,
        description: l.description,
        orderIndex: l.orderIndex,
        estimatedMins: l.estimatedMins,
        startPage: l.startPage,
        endPage: l.endPage,
        isActive: l.isActive,
        sourceRef: l.sourceRef,
      })),
    );

    const concepts = book.units.flatMap((u) =>
      u.lessons.flatMap((l) =>
        l.concepts.map((c) => ({
          key: c.key,
          slug: c.slug,
          lessonSlug: l.slug,
          unitSlug: u.slug,
          name: c.name,
          description: c.description,
          orderIndex: c.orderIndex,
          difficulty: c.difficulty,
          importance: c.importance,
          masteryThreshold: c.masteryThreshold,
          isCore: c.isCore,
          isActive: c.isActive,
          pageNumber: c.pageNumber,
          sourceRef: c.sourceRef,
          nameEn: c.nameEn,
          bloomsLevel: c.bloomsLevel,
        })),
      ),
    );

    const conceptKeys = concepts.map((c) => c.key);
    const edges = conceptKeys.length
      ? await this.db.conceptPrerequisite.findMany({
          where: { concept: { key: { in: conceptKeys } } },
          select: {
            strength: true,
            requiredMastery: true,
            concept: { select: { key: true } },
            prerequisite: { select: { key: true } },
          },
        })
      : [];

    // Concept attachments. Exported for the same reason prerequisites are:
    // without them `import(export(X))` silently produces a smaller book than
    // X, and the loss is invisible because both collections are optional in
    // the package format. Ordered by the stable business identifier so two
    // exports of unchanged content stay byte-identical.
    const misconceptionRows = conceptKeys.length
      ? await this.db.misconception.findMany({
          where: { concept: { key: { in: conceptKeys } } },
          orderBy: { slug: 'asc' },
          select: {
            slug: true,
            name: true,
            description: true,
            remediation: true,
            concept: { select: { key: true } },
          },
        })
      : [];

    // Export every resource target the schema supports. Concept-scoped rows
    // keep their fully-qualified concept path; lesson rows carry the lesson
    // path; book-wide rows carry only the textbook scope. Import then routes
    // all three back through ContentAuthoringService, so this is still a
    // package contract rather than a persistence dump.
    const resourceRows = await this.db.learningResource.findMany({
      where: {
        slug: { not: null },
        OR: [
          { textbookId: book.id },
          { lesson: { unit: { textbookId: book.id } } },
          { concept: { lesson: { unit: { textbookId: book.id } } } },
        ],
      },
      orderBy: [{ orderIndex: 'asc' }, { slug: 'asc' }],
      select: {
        slug: true,
        kind: true,
        title: true,
        body: true,
        url: true,
        orderIndex: true,
        pageStart: true,
        pageEnd: true,
        estimatedMins: true,
        concept: { select: { key: true } },
        lesson: { select: { slug: true, unit: { select: { slug: true } } } },
      },
    });

    // Questions hang off concepts, and a question may measure several. Fetched
    // by the question's own concept links rather than walking the hierarchy
    // again, so an item linked to two concepts in this book appears once.
    const questionRows = conceptKeys.length
      ? await this.db.question.findMany({
          where: { concepts: { some: { concept: { key: { in: conceptKeys } } } } },
          select: {
            key: true,
            type: true,
            text: true,
            hint: true,
            explanation: true,
            points: true,
            difficulty01: true,
            origin: true,
            textbookRole: true,
            sourceRef: true,
            status: true,
            choices: {
              orderBy: { orderIndex: 'asc' },
              select: {
                id: true,
                text: true,
                orderIndex: true,
                feedback: true,
                misconception: { select: { key: true } },
              },
            },
            answerKey: {
              select: {
                correctChoiceIds: true,
                acceptedTexts: true,
                numericMin: true,
                numericMax: true,
                caseSensitive: true,
                allowPartialCredit: true,
              },
            },
            concepts: {
              select: {
                weight: true,
                isPrimary: true,
                concept: {
                  select: {
                    slug: true,
                    key: true,
                    lesson: { select: { slug: true, unit: { select: { slug: true } } } },
                  },
                },
              },
            },
          },
        })
      : [];

    const conceptBySlugPath = new Map(concepts.map((c) => [c.key, c]));

    const questions = questionRows.map((q) => {
      // The stored choice id is a uuid derived from the question key and the
      // author's local handle -- a one-way hash, so the handle cannot be read
      // back out of it. Position is the recoverable identity: choices are
      // stored with an explicit orderIndex, so "c1", "c2" names them stably,
      // and the answer key is remapped onto the same names. An importer then
      // re-derives its own uuids, which is what makes a package portable
      // between books instead of carrying one book's identifiers.
      const localId = new Map(q.choices.map((c, index) => [c.id, `c${index + 1}`]));

      const primary = q.concepts.find((link) => link.isPrimary) ?? q.concepts[0];
      const primaryConcept = primary ? conceptBySlugPath.get(primary.concept.key) : undefined;

      return {
        key: q.key,
        unitSlug: primaryConcept?.unitSlug ?? '',
        lessonSlug: primaryConcept?.lessonSlug ?? '',
        type: q.type as string,
        text: q.text,
        hint: q.hint,
        explanation: q.explanation,
        points: q.points,
        difficulty01: q.difficulty01,
        origin: q.origin as string,
        textbookRole: (q.textbookRole as string | null) ?? null,
        sourceRef: q.sourceRef,
        choices: q.choices.map((c) => ({
          id: localId.get(c.id)!,
          text: c.text,
          orderIndex: c.orderIndex,
          misconceptionKey: c.misconception?.key ?? null,
          feedback: c.feedback,
        })),
        answerKey: {
          correctChoiceIds: (q.answerKey?.correctChoiceIds ?? []).flatMap((id) => {
            const local = localId.get(id);
            return local ? [local] : [];
          }),
          acceptedTexts: q.answerKey?.acceptedTexts ?? [],
          numericMin: q.answerKey?.numericMin ?? null,
          numericMax: q.answerKey?.numericMax ?? null,
          caseSensitive: q.answerKey?.caseSensitive ?? false,
          allowPartialCredit: q.answerKey?.allowPartialCredit ?? false,
        },
        concepts: q.concepts.map((link) => ({
          unitSlug: link.concept.lesson.unit.slug,
          lessonSlug: link.concept.lesson.slug,
          conceptSlug: link.concept.slug,
          weight: link.weight,
          isPrimary: link.isPrimary,
        })),
        status: q.status as string,
      };
    });

    return {
      textbook: {
        key: book.key,
        subjectKey: book.subject.key,
        gradeKey: book.grade.key,
        termKey: book.term.key,
        title: book.title,
        edition: book.edition,
        description: book.description,
        issuer: book.issuer,
        isbn: book.isbn,
        publishYear: book.publishYear,
        totalPages: book.totalPages,
        status: book.status,
      },
      units,
      lessons,
      concepts,
      questions,
      prerequisites: edges.map((e) => ({
        conceptKey: e.concept.key,
        prerequisiteKey: e.prerequisite.key,
        strength: e.strength,
        requiredMastery: e.requiredMastery,
      })),
      // Both are addressed by the fully-qualified slug triple, never by a bare
      // concept slug: the same slug may legitimately recur in another lesson,
      // and the importer resolves on the triple.
      misconceptions: misconceptionRows.flatMap((m) => {
        const concept = conceptBySlugPath.get(m.concept.key);
        if (!concept) return [];
        return [
          {
            slug: m.slug,
            unitSlug: concept.unitSlug,
            lessonSlug: concept.lessonSlug,
            conceptSlug: concept.slug,
            name: m.name,
            description: m.description,
            correction: m.remediation,
          },
        ];
      }),
      learningResources: resourceRows.flatMap<ExportableTextbook['learningResources'][number]>((r) => {
        if (r.slug === null) return [];
        const conceptKey = r.concept?.key;
        const concept = conceptKey ? conceptBySlugPath.get(conceptKey) : undefined;
        if (concept) {
          return [
            {
              slug: r.slug,
              unitSlug: concept.unitSlug,
              lessonSlug: concept.lessonSlug,
              conceptSlug: concept.slug,
              kind: r.kind as string,
              title: r.title,
              body: r.body,
              url: r.url,
              orderIndex: r.orderIndex,
              pageStart: r.pageStart,
              pageEnd: r.pageEnd,
              estimatedMins: r.estimatedMins,
            },
          ];
        }
        if (r.lesson) {
          return [
            {
              slug: r.slug,
              scope: 'LESSON' as const,
              unitSlug: r.lesson.unit.slug,
              lessonSlug: r.lesson.slug,
              conceptSlug: null,
              kind: r.kind as string,
              title: r.title,
              body: r.body,
              url: r.url,
              orderIndex: r.orderIndex,
              pageStart: r.pageStart,
              pageEnd: r.pageEnd,
              estimatedMins: r.estimatedMins,
            },
          ];
        }
        return [
          {
            slug: r.slug,
            scope: 'TEXTBOOK' as const,
            unitSlug: null,
            lessonSlug: null,
            conceptSlug: null,
            kind: r.kind as string,
            title: r.title,
            body: r.body,
            url: r.url,
            orderIndex: r.orderIndex,
            pageStart: r.pageStart,
            pageEnd: r.pageEnd,
            estimatedMins: r.estimatedMins,
          },
        ];
      }),
    };
  }

  async textbookStatus(textbookKey: string): Promise<PublicationState | null> {
    const row = await this.db.textbook.findUnique({
      where: { key: textbookKey },
      select: { status: true },
    });
    return row ? (row.status as PublicationState) : null;
  }

  async setTextbookStatus(
    textbookKey: string,
    status: PublicationState,
    publishedAt?: Date,
  ): Promise<void> {
    await this.db.textbook.update({
      where: { key: textbookKey },
      // publishedAt is written only on first publication, so it keeps meaning
      // "when learners first saw this" rather than "when it was last touched".
      data: { status, ...(publishedAt ? { publishedAt } : {}) },
    });
  }

  async linkPrerequisite(input: {
    conceptKey: string;
    prerequisiteKey: string;
    strength: number;
    requiredMastery: number;
  }): Promise<void> {
    // Sequential, not Promise.all: the dev database serves one connection and
    // two concurrent Prisma queries terminate it mid-flight. Import links
    // prerequisites in a loop, which is exactly the load that exposes it.
    const concept = await this.db.concept.findUniqueOrThrow({
      where: { key: input.conceptKey },
      select: { id: true },
    });
    const prerequisite = await this.db.concept.findUniqueOrThrow({
      where: { key: input.prerequisiteKey },
      select: { id: true },
    });

    await this.db.conceptPrerequisite.upsert({
      where: {
        conceptId_prerequisiteId: { conceptId: concept.id, prerequisiteId: prerequisite.id },
      },
      create: {
        conceptId: concept.id,
        prerequisiteId: prerequisite.id,
        strength: input.strength,
        requiredMastery: input.requiredMastery,
      },
      update: { strength: input.strength, requiredMastery: input.requiredMastery },
    });
  }

  async unlinkPrerequisite(conceptKey: string, prerequisiteKey: string): Promise<void> {
    await this.db.conceptPrerequisite.deleteMany({
      where: { concept: { key: conceptKey }, prerequisite: { key: prerequisiteKey } },
    });
  }

  async prerequisitesInTextbook(textbookKey: string): Promise<
    Array<{
      conceptKey: string;
      prerequisiteKey: string;
      strength: number;
      requiredMastery: number;
    }>
  > {
    const rows = await this.db.conceptPrerequisite.findMany({
      where: {
        concept: { lesson: { unit: { textbook: { key: textbookKey } } } },
      },
      select: {
        strength: true,
        requiredMastery: true,
        concept: { select: { key: true } },
        prerequisite: { select: { key: true } },
      },
    });
    return rows.map((r) => ({
      conceptKey: r.concept.key,
      prerequisiteKey: r.prerequisite.key,
      strength: r.strength,
      requiredMastery: r.requiredMastery,
    }));
  }
}

/** Writes content changes to the shared audit trail. */
export class PrismaContentAuditWriter implements ContentAuditWriter {
  constructor(private readonly db: Db) {}

  async record(entry: {
    actorKey: string;
    action: string;
    targetKey: string;
    details?: Readonly<Record<string, unknown>>;
  }): Promise<void> {
    const actor = await this.db.user.findUnique({
      where: { key: entry.actorKey },
      select: { id: true },
    });

    await this.db.auditEntry.create({
      data: {
        actorId: actor?.id ?? null,
        action: entry.action,
        entity: 'content',
        entityKey: entry.targetKey,
        after: (entry.details ?? {}) as object,
      },
    });
  }
}
