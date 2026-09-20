/**
 * Exports a textbook as a content package.
 *
 * Read-only by construction: this service has no write port and could not
 * mutate anything if it tried. That is why export comes first in the delivery
 * sequence — it settles the public contract at zero risk and produces the
 * round-trip fixtures import tests will need.
 *
 * What it is NOT: a database exporter. It emits the business contract declared
 * in `domain/export-profile.ts`, so no Prisma column name, no UUID and no
 * internal timestamp leaves the system. Adding a field here is a deliberate
 * contract change, not a consequence of a schema edit.
 */

import { Errors } from '../../../shared/kernel/errors.js';
import { Err, Ok, type Result } from '../../../shared/kernel/result.js';
import {
  CONTENT_PROFILE,
  CONTENT_PROFILE_VERSION,
  checkPackageIntegrity,
  sortPackage,
  type ContentPackage,
} from '../domain/export-profile.js';
import type { ContentExportReader } from './ports.js';

/** Who is asking. Authorization is decided at the interface, scope is carried here. */
export interface ExportContext {
  readonly actorKey: string;
}

export interface Clock {
  now(): Date;
}

export class ContentExportService {
  constructor(
    private readonly reader: ContentExportReader,
    private readonly clock: Clock,
  ) {}

  /**
   * Export one textbook, whatever its publication state.
   *
   * Draft books are exportable on purpose: the main use for export is to review
   * or move work in progress, and an author who could only export published
   * content could not use this to prepare a book at all. The learner-facing
   * published-only filter is a different question with a different owner —
   * this endpoint is staff-only, and it reports `status` so a consumer always
   * knows what it received.
   */
  async exportTextbook(
    _ctx: ExportContext,
    textbookKey: string,
  ): Promise<Result<ContentPackage>> {
    const raw = await this.reader.readExportable(textbookKey);
    if (!raw) {
      return Err(
        Errors.notFound('content.textbook_not_found', 'No such textbook.', { textbookKey }),
      );
    }

    const pkg: ContentPackage = sortPackage({
      meta: {
        profile: CONTENT_PROFILE,
        profileVersion: CONTENT_PROFILE_VERSION,
        scope: 'FULL',
        exportedAt: this.clock.now().toISOString(),
      },
      textbook: raw.textbook,
      units: raw.units,
      lessons: raw.lessons,
      concepts: raw.concepts,
      prerequisites: raw.prerequisites,
      misconceptions: raw.misconceptions,
      learningResources: raw.learningResources,
      assets: raw.assets,
      questions: raw.questions,
    });

    // Validate our own output. A package whose lesson points at a missing unit
    // can never be imported, and discovering that at import time would report
    // the failure far from the bug that caused it.
    const integrity = checkPackageIntegrity(pkg);
    if (!integrity.ok) {
      return Err(
        Errors.internal('content.export_inconsistent', 'The exported package is not self-consistent.', {
          textbookKey,
          problems: integrity.problems,
        }),
      );
    }

    return Ok(pkg);
  }
}
