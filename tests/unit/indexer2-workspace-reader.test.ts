import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Indexer2WorkspaceReader } from '../../src/infrastructure/storage/indexer2-workspace-reader.js';

const temporaryRoots: string[] = [];

async function createWorkspace(options?: { indexPath?: string; manifestPath?: string }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-indexer2-reader-'));
  temporaryRoots.push(root);
  const workspace = path.join(root, 'G07', 'MATH');
  const lessonPath = path.join(workspace, 'P01', 'units', 'unit_01', 'lesson_01.pdf');
  await fs.mkdir(path.dirname(lessonPath), { recursive: true });
  const pdfBytes = Buffer.from('%PDF-1.7 test lesson');
  await fs.writeFile(lessonPath, pdfBytes);

  const index = {
    templateId: 'edu.index_template.v1',
    title: 'الرياضيات للصف السابع',
    gradeKey: 'G07',
    subjectKey: 'MATH',
    componentKey: null,
    partKey: 'BOTH',
    sourceLayout: 'MERGED_PARTS_FILE',
    units: [{
      unitNumber: 1,
      title: 'الوحدة الأولى',
      partKey: 'P01',
      lessons: [{
        lessonNumber: 1,
        title: 'الدرس الأول',
        printedPageStart: 1,
        printedPageEnd: 4,
        pdfPageStart: 9,
        pdfPageEnd: 12,
        sliceFile: {
          workspaceUri: 'workspace/G07/MATH/P01/units/unit_01/lesson_01.pdf',
          fileName: 'lesson_01.pdf',
          isAvailable: true,
        },
      }],
    }],
  };
  const manifest = {
    manifestVersion: 'edu.book_manifest.v1',
    gradeKey: 'G07',
    subjectKey: 'MATH',
    sourceSha256: 'a'.repeat(64),
    totalPages: 100,
    slices: [{
      lessonKey: 'G07_MATH_P01_U01_L01',
      title: 'الدرس الأول',
      path: options?.manifestPath ?? 'P01/units/unit_01/lesson_01.pdf',
      byteSize: options?.manifestPath ? pdfBytes.length : pdfBytes.length,
      pdfRange: [9, 12],
    }],
  };
  await fs.writeFile(path.join(workspace, 'index.json'), JSON.stringify(index));
  await fs.writeFile(path.join(workspace, 'book_manifest.json'), JSON.stringify(manifest));
  return { root, workspace, pdfBytes };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('Indexer2WorkspaceReader', () => {
  it('discovers the grade/subject workspace and resolves its existing P01 lesson PDF', async () => {
    const { root, pdfBytes } = await createWorkspace();
    const reader = new Indexer2WorkspaceReader(root);

    const workspaces = await reader.listWorkspaces();
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]?.gradeKey).toBe('G07');
    expect(workspaces[0]?.subjectKey).toBe('MATH');
    expect(workspaces[0]?.partKey).toBe('BOTH');
    expect(workspaces[0]?.units[0]?.partKey).toBe('P01');

    const lesson = workspaces[0]?.units[0]?.lessons[0];
    expect(lesson?.relativePdfPath).toBe('P01/units/unit_01/lesson_01.pdf');
    expect(lesson?.pdfExists).toBe(true);
    expect(lesson?.sizeBytes).toBe(pdfBytes.length);
    expect(lesson?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(lesson?.pdfPageStart).toBe(9);
    expect(lesson?.pdfPageEnd).toBe(12);
  });

  it('reports disagreement between the index and book manifest paths', async () => {
    const { root } = await createWorkspace({ manifestPath: 'P01/units/unit_01/lesson_02.pdf' });
    const reader = new Indexer2WorkspaceReader(root);

    const [workspace] = await reader.listWorkspaces();
    expect(workspace?.units[0]?.lessons[0]?.issues).toContain(
      'Index and book_manifest reference different lesson PDF paths.',
    );
  });

  it('does not resolve a path traversal reference from index.json', async () => {
    const { root, workspace } = await createWorkspace();
    const indexPath = path.join(workspace, 'index.json');
    const index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
    index.units[0].lessons[0].sliceFile.workspaceUri = 'workspace/G07/MATH/../../outside.pdf';
    await fs.writeFile(indexPath, JSON.stringify(index));

    const reader = new Indexer2WorkspaceReader(root);
    const [snapshot] = await reader.listWorkspaces();
    expect(snapshot?.units[0]?.lessons[0]?.pdfExists).toBe(false);
    expect(snapshot?.units[0]?.lessons[0]?.issues).toContain('Index contains an unsafe lesson PDF path.');
  });

  it('returns null for an unknown opaque workspace key', async () => {
    const { root } = await createWorkspace();
    const reader = new Indexer2WorkspaceReader(root);
    await expect(reader.inspectWorkspace('not-a-workspace')).resolves.toBeNull();
  });
});
