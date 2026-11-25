/**
 * Read-only adapter for the existing indexer2 curriculum workspace.
 *
 * This adapter deliberately does not create, rename, slice, or rewrite any
 * workspace artifact. It only discovers index.json + book_manifest.json and
 * verifies the lesson PDFs already produced by indexer2.
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

type JsonRecord = Record<string, unknown>;

export interface Indexer2LessonSnapshot {
  readonly lessonNumber: number;
  readonly title: string;
  readonly printedPageStart: number | null;
  readonly printedPageEnd: number | null;
  readonly pdfPageStart: number | null;
  readonly pdfPageEnd: number | null;
  readonly relativePdfPath: string | null;
  readonly pdfExists: boolean;
  readonly sizeBytes: number | null;
  readonly sha256: string | null;
  readonly issues: readonly string[];
}

export interface Indexer2UnitSnapshot {
  readonly unitNumber: number;
  readonly title: string;
  readonly partKey: 'P01' | 'P02' | null;
  readonly lessons: readonly Indexer2LessonSnapshot[];
  readonly issues: readonly string[];
}

export interface Indexer2WorkspaceSnapshot {
  readonly workspaceKey: string;
  readonly relativePath: string;
  readonly title: string;
  readonly gradeKey: string;
  readonly subjectKey: string;
  readonly componentKey: string | null;
  readonly partKey: string;
  readonly sourceLayout: string | null;
  readonly sourceSha256: string | null;
  readonly physicalPageCount: number | null;
  readonly units: readonly Indexer2UnitSnapshot[];
  readonly issues: readonly string[];
}

interface WorkspaceCandidate {
  readonly workspaceDir: string;
  readonly relativePath: string;
  readonly workspaceKey: string;
}

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveInt(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function partKey(value: unknown): 'P01' | 'P02' | null {
  return value === 'P01' || value === 'P02' ? value : null;
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function normalizeRelativePath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) return null;
  return normalized;
}

async function readJson(filePath: string): Promise<JsonRecord | null> {
  try {
    return record(JSON.parse(await fs.readFile(filePath, 'utf8')));
  } catch {
    return null;
  }
}

export class Indexer2WorkspaceReader {
  private readonly rootDir: string;
  private rootRealPath: string | null = null;

  constructor(rootDir: string) {
    this.rootDir = path.resolve(rootDir);
  }

  private async getRootRealPath(): Promise<string> {
    if (!this.rootRealPath) {
      this.rootRealPath = await fs.realpath(this.rootDir);
    }
    return this.rootRealPath;
  }

  private workspaceKey(relativePath: string): string {
    return createHash('sha256').update(relativePath).digest('hex').slice(0, 24);
  }

  private async findCandidates(): Promise<WorkspaceCandidate[]> {
    const candidates: WorkspaceCandidate[] = [];
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 3) return;
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      if (entries.some((entry) => entry.isFile() && entry.name === 'index.json')) {
        const relativePath = path.relative(this.rootDir, dir).split(path.sep).join('/');
        const segments = relativePath.split('/').filter(Boolean);
        // indexer2's canonical workspace is grade/subject[/component].
        if (segments.length === 2 || segments.length === 3) {
          candidates.push({
            workspaceDir: dir,
            relativePath,
            workspaceKey: this.workspaceKey(relativePath),
          });
        }
        return;
      }

      if (depth === 3) return;
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        await walk(path.join(dir, entry.name), depth + 1);
      }
    };

    try {
      await fs.access(this.rootDir);
    } catch {
      return [];
    }
    await walk(this.rootDir, 0);
    return candidates.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  }

  async listWorkspaces(): Promise<readonly Indexer2WorkspaceSnapshot[]> {
    const candidates = await this.findCandidates();
    const snapshots: Indexer2WorkspaceSnapshot[] = [];
    for (const candidate of candidates) {
      snapshots.push(await this.inspectCandidate(candidate));
    }
    return snapshots;
  }

  async inspectWorkspace(workspaceKey: string): Promise<Indexer2WorkspaceSnapshot | null> {
    const candidates = await this.findCandidates();
    const candidate = candidates.find((item) => item.workspaceKey === workspaceKey);
    return candidate ? this.inspectCandidate(candidate) : null;
  }

  private async resolveLessonPdf(
    candidate: WorkspaceCandidate,
    unit: JsonRecord,
    lesson: JsonRecord,
    manifest: JsonRecord | null,
  ): Promise<{ relativePath: string | null; bytes: Buffer | null; issues: string[] }> {
    const issues: string[] = [];
    const unitNumber = positiveInt(unit.unitNumber);
    const lessonNumber = positiveInt(lesson.lessonNumber);
    const unitPart = partKey(unit.partKey);
    const sliceFile = record(lesson.sliceFile);
    const references: string[] = [];

    const rawIndexPath = sliceFile?.workspaceUri ?? sliceFile?.path ?? lesson.pdfPath ?? lesson.relative;
    const normalizedIndexPath = normalizeRelativePath(rawIndexPath);
    if (rawIndexPath !== undefined && rawIndexPath !== null && !normalizedIndexPath) {
      issues.push('Index contains an unsafe lesson PDF path.');
      return { relativePath: null, bytes: null, issues };
    }
    if (normalizedIndexPath) {
      const workspacePrefix = `workspace/${candidate.relativePath}/`;
      references.push(normalizedIndexPath.startsWith(workspacePrefix)
        ? normalizedIndexPath.slice(workspacePrefix.length)
        : normalizedIndexPath.startsWith('workspace/')
          ? normalizedIndexPath.slice('workspace/'.length)
          : normalizedIndexPath);
    }

    const slices = Array.isArray(manifest?.slices) ? manifest.slices : [];
    const manifestSlice = slices
      .map(record)
      .find((item) => {
        if (!item) return false;
        const key = text(item.lessonKey);
        const pathValue = normalizeRelativePath(item.path);
        return (key && key.endsWith(`_U${String(unitNumber).padStart(2, '0')}_L${String(lessonNumber).padStart(2, '0')}`)) ||
          (pathValue && unitPart && pathValue === `${unitPart}/units/unit_${String(unitNumber).padStart(2, '0')}/lesson_${String(lessonNumber).padStart(2, '0')}.pdf`);
      });
    const manifestPath = normalizeRelativePath(manifestSlice?.path);
    if (manifestSlice?.path !== undefined && !manifestPath) {
      issues.push('Manifest contains an unsafe lesson PDF path.');
      return { relativePath: null, bytes: null, issues };
    }
    if (manifestPath) references.push(manifestPath);

    const uniqueReferences = [...new Set(references)];
    if (uniqueReferences.length > 1) {
      issues.push('Index and book_manifest reference different lesson PDF paths.');
      return { relativePath: null, bytes: null, issues };
    }

    const relativePath = uniqueReferences[0] ?? (
      unitNumber && lessonNumber && unitPart
        ? `${unitPart}/units/unit_${String(unitNumber).padStart(2, '0')}/lesson_${String(lessonNumber).padStart(2, '0')}.pdf`
        : null
    );
    if (!relativePath) {
      issues.push('No lesson PDF path is available in index, manifest, or canonical layout.');
      return { relativePath: null, bytes: null, issues };
    }

    const rootReal = await this.getRootRealPath();
    const workspaceReal = await fs.realpath(candidate.workspaceDir).catch(() => null);
    if (!workspaceReal || !workspaceReal.startsWith(rootReal + path.sep)) {
      issues.push('Workspace directory resolves outside the configured root.');
      return { relativePath, bytes: null, issues };
    }

    const fullPath = path.resolve(candidate.workspaceDir, relativePath);
    if (!fullPath.startsWith(workspaceReal + path.sep)) {
      issues.push('Lesson PDF path escapes the workspace directory.');
      return { relativePath, bytes: null, issues };
    }

    const fileReal = await fs.realpath(fullPath).catch(() => null);
    if (!fileReal || !fileReal.startsWith(workspaceReal + path.sep)) {
      issues.push('Lesson PDF is missing or resolves outside the workspace directory.');
      return { relativePath, bytes: null, issues };
    }

    try {
      const stat = await fs.stat(fileReal);
      if (!stat.isFile() || !relativePath.toLowerCase().endsWith('.pdf')) {
        issues.push('Resolved lesson asset is not a PDF file.');
        return { relativePath, bytes: null, issues };
      }
      const bytes = await fs.readFile(fileReal);
      if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
        issues.push('Resolved lesson asset does not have a PDF file signature.');
        return { relativePath, bytes: null, issues };
      }
      if (manifestSlice && typeof manifestSlice.byteSize === 'number' && manifestSlice.byteSize !== bytes.length) {
        issues.push('Lesson PDF byte size differs from book_manifest.');
      }
      const manifestRange = Array.isArray(manifestSlice?.pdfRange)
        ? manifestSlice.pdfRange.map(positiveInt)
        : [];
      if (manifestRange.length === 2) {
        const [manifestStart, manifestEnd] = manifestRange;
        if (
          manifestStart !== null &&
          manifestEnd !== null &&
          (positiveInt(lesson.pdfPageStart) !== manifestStart ||
            positiveInt(lesson.pdfPageEnd) !== manifestEnd)
        ) {
          issues.push('Lesson PDF page range differs between index.json and book_manifest.json.');
        }
      }
      if (typeof manifestSlice?.sha256 === 'string' && manifestSlice.sha256 && sha256(bytes) !== manifestSlice.sha256) {
        issues.push('Lesson PDF SHA-256 differs from book_manifest.');
      }
      return { relativePath, bytes, issues };
    } catch {
      issues.push('Lesson PDF could not be read.');
      return { relativePath, bytes: null, issues };
    }
  }

  private async inspectCandidate(candidate: WorkspaceCandidate): Promise<Indexer2WorkspaceSnapshot> {
    const [index, manifest] = await Promise.all([
      readJson(path.join(candidate.workspaceDir, 'index.json')),
      readJson(path.join(candidate.workspaceDir, 'book_manifest.json')),
    ]);
    const issues: string[] = [];
    if (!index) issues.push('index.json is missing or invalid JSON.');
    if (!manifest) issues.push('book_manifest.json is missing or invalid JSON.');

    const gradeKey = text(index?.gradeKey);
    const subjectKey = text(index?.subjectKey);
    const componentKey = text(index?.componentKey) || null;
    if (!gradeKey || !subjectKey) issues.push('index.json must declare gradeKey and subjectKey.');
    if (text(manifest?.gradeKey) && text(manifest?.gradeKey) !== gradeKey) {
      issues.push('index.json and book_manifest.json gradeKey values differ.');
    }
    if (text(manifest?.subjectKey) && text(manifest?.subjectKey) !== subjectKey) {
      issues.push('index.json and book_manifest.json subjectKey values differ.');
    }

    const indexUnits = Array.isArray(index?.units) ? index.units : [];
    const units: Indexer2UnitSnapshot[] = [];
    for (const rawUnit of indexUnits) {
      const unit = record(rawUnit);
      if (!unit) continue;
      const number = positiveInt(unit.unitNumber);
      const unitIssues: string[] = [];
      if (!number) unitIssues.push('Unit has no valid unitNumber.');
      const assignedPart = partKey(unit.partKey);
      if (!assignedPart) unitIssues.push('Unit partKey must be P01 or P02.');
      const lessons: Indexer2LessonSnapshot[] = [];
      const indexLessons = Array.isArray(unit.lessons) ? unit.lessons : [];
      for (const rawLesson of indexLessons) {
        const lesson = record(rawLesson);
        if (!lesson) continue;
        const lessonNumber = positiveInt(lesson.lessonNumber);
        const lessonIssues: string[] = [];
        if (!lessonNumber) lessonIssues.push('Lesson has no valid lessonNumber.');
        const resolved = await this.resolveLessonPdf(candidate, unit, lesson, manifest);
        lessonIssues.push(...resolved.issues);
        const pdfPageStart = positiveInt(lesson.pdfPageStart);
        const pdfPageEnd = positiveInt(lesson.pdfPageEnd);
        lessons.push({
          lessonNumber: lessonNumber ?? 0,
          title: text(lesson.title) || `Lesson ${lessonNumber ?? ''}`.trim(),
          printedPageStart: positiveInt(lesson.printedPageStart),
          printedPageEnd: positiveInt(lesson.printedPageEnd),
          pdfPageStart,
          pdfPageEnd,
          relativePdfPath: resolved.relativePath,
          pdfExists: resolved.bytes !== null,
          sizeBytes: resolved.bytes?.length ?? null,
          sha256: resolved.bytes ? sha256(resolved.bytes) : null,
          issues: lessonIssues,
        });
      }
      units.push({
        unitNumber: number ?? 0,
        title: text(unit.title) || `Unit ${number ?? ''}`.trim(),
        partKey: assignedPart,
        lessons,
        issues: unitIssues,
      });
    }

    return {
      workspaceKey: candidate.workspaceKey,
      relativePath: candidate.relativePath,
      title: text(index?.title) || text(index?.displayName) || candidate.relativePath,
      gradeKey,
      subjectKey,
      componentKey,
      partKey: text(index?.partKey) || 'UNKNOWN',
      sourceLayout: text(index?.sourceLayout) || null,
      sourceSha256: text(manifest?.sourceSha256) || null,
      physicalPageCount: positiveInt(manifest?.totalPages),
      units,
      issues,
    };
  }
}
