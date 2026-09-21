import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { WorkspaceManager } from '../../../infrastructure/storage/workspace-manager.js';
import type { WorkspaceImporterService, WorkspaceImportResult } from './workspace-importer.service.js';
import { textbookKey as buildTextbookKey } from '../../../shared/kernel/identifiers.js';

const execFileAsync = promisify(execFile);

export interface WorkspaceArchiveImportOptions {
  readonly textbookKey?: string;
  readonly dryRun?: boolean;
  readonly actorKey?: string;
}

export interface WorkspaceArchiveResult {
  readonly textbookKey: string;
  readonly workspaceDir: string;
  readonly mode: 'FULL_WORKSPACE' | 'PARTIAL_WORKSPACE';
  readonly dryRun: boolean;
  readonly addedFiles: number;
  readonly updatedFiles: number;
  readonly unchangedFiles: number;
  readonly importSummary?: WorkspaceImportResult;
}

export class WorkspaceArchiveService {
  constructor(
    private readonly workspaceManager: WorkspaceManager,
    private readonly workspaceImporter: WorkspaceImporterService,
    private readonly pythonCommand: string,
    private readonly engineRoot: string,
    private readonly maxArchiveBytes = 1024 * 1024 * 1024,
    private readonly timeoutMs = 15 * 60 * 1000,
  ) {}

  async importZip(
    archive: Buffer,
    options: WorkspaceArchiveImportOptions = {},
  ): Promise<WorkspaceArchiveResult> {
    if (archive.length === 0) throw new Error('Workspace ZIP is empty.');
    if (archive.length > this.maxArchiveBytes) {
      throw new Error('Workspace ZIP exceeds the configured upload limit.');
    }

    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'edu7-workspace-zip-'));
    const zipPath = path.join(temp, 'input.zip');
    const extracted = path.join(temp, 'extracted');
    let candidate: string | null = null;

    try {
      await fs.writeFile(zipPath, archive);
      await this.runPython(['extract', zipPath, extracted]);

      const sourceRoot = await this.findArchiveWorkspaceRoot(extracted);
      const pkg = await this.readPackage(sourceRoot);
      const textbookKey = await this.resolveTextbookKey(pkg, options.textbookKey);
      const workspaceDir = pkg
        ? this.workspaceManager.getWorkspaceDir({
            term: pkg.textbook.termKey,
            grade: pkg.textbook.gradeKey,
            subject: pkg.textbook.subjectKey,
            edition: pkg.textbook.edition,
          })
        : this.workspaceManager.getWorkspaceDirFromTextbookKey(textbookKey);

      const mode = pkg ? 'FULL_WORKSPACE' : 'PARTIAL_WORKSPACE';

      const parent = path.dirname(workspaceDir);
      await fs.mkdir(parent, { recursive: true });
      candidate = path.join(parent, `.incoming-${textbookKey}-${crypto.randomUUID()}`);

      if (await this.exists(workspaceDir)) {
        await fs.cp(workspaceDir, candidate, { recursive: true, dereference: true });
      } else {
        await fs.mkdir(candidate, { recursive: true });
      }

      const overlayRoot = sourceRoot;
      await this.overlayDirectory(overlayRoot, candidate);

      const comparison = await this.compareTrees(workspaceDir, candidate);

      // A dry-run validates the exact merged candidate, not merely the uploaded
      // archive. This catches conflicts between an update package and the
      // existing workspace before anything is written to canonical storage.
      const validation = await this.workspaceImporter.importFromWorkspace(candidate, {
        dryRun: true,
        syncAssets: true,
        actorKey: options.actorKey,
      });

      if (options.dryRun !== false) {
        return {
          textbookKey,
          workspaceDir,
          mode,
          dryRun: true,
          ...comparison,
          importSummary: validation,
        };
      }

      const applied = await this.workspaceImporter.importFromWorkspace(candidate, {
        dryRun: false,
        syncAssets: true,
        actorKey: options.actorKey,
      });

      await this.commitCandidate(workspaceDir, candidate);
      candidate = null;

      return {
        textbookKey,
        workspaceDir,
        mode,
        dryRun: false,
        ...comparison,
        importSummary: applied,
      };
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
      if (candidate) await fs.rm(candidate, { recursive: true, force: true });
    }
  }

  async exportZip(textbookKey: string): Promise<{
    filePath: string;
    downloadName: string;
    sizeBytes: number;
  }> {
    const workspaceDir = this.workspaceManager.getWorkspaceDirFromTextbookKey(textbookKey);
    const inspection = await this.workspaceManager.inspectWorkspace(workspaceDir);
    if (!inspection.indexManifest || !inspection.contentPackage) {
      throw new Error(`Workspace is not exportable: ${textbookKey}`);
    }

    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'edu7-workspace-export-'));
    const out = path.join(temp, `${textbookKey}.zip`);
    try {
      await this.runPython(['create', workspaceDir, out, textbookKey]);
      const stat = await fs.stat(out);
      // Move the generated archive out of the cleanup directory. The caller
      // owns the returned path and HTTP streaming removes it after completion.
      const retained = path.join(os.tmpdir(), `${textbookKey}-${crypto.randomUUID()}.zip`);
      await fs.copyFile(out, retained);
      const retainedStat = await fs.stat(retained);
      return { filePath: retained, downloadName: `${textbookKey}.zip`, sizeBytes: retainedStat.size || stat.size };
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
    }
  }

  private async runPython(args: string[]): Promise<void> {
    await execFileAsync(
      this.pythonCommand,
      ['-m', 'edu7_content.workspace.archive', ...args],
      {
        cwd: path.resolve(this.engineRoot, '..'),
        timeout: this.timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, PYTHONPATH: path.join(this.engineRoot, 'src') },
      },
    );
  }

  private async findArchiveWorkspaceRoot(extracted: string): Promise<string> {
    const packageFiles: string[] = [];
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 4) return;
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full, depth + 1);
        else if (entry.name === 'edu7-content-package.json') packageFiles.push(path.dirname(full));
      }
    };
    await walk(extracted, 0);
    if (packageFiles.length > 1) throw new Error('ZIP contains more than one workspace package.');
    if (packageFiles.length === 1) return packageFiles[0];

    const entries = await fs.readdir(extracted, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory());
    if (dirs.length === 1 && entries.length === 1) return path.join(extracted, dirs[0].name);
    return extracted;
  }

  private async readPackage(root: string): Promise<any | null> {
    const file = path.join(root, 'edu7-content-package.json');
    try {
      return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch {
      return null;
    }
  }

  private async resolveTextbookKey(pkg: any | null, supplied?: string): Promise<string> {
    if (pkg?.textbook) {
      const tb = pkg.textbook;
      const derived = buildTextbookKey({
        subject: tb.subjectKey,
        grade: Number(String(tb.gradeKey).replace(/\D/g, '')),
        term: Number(String(tb.termKey).replace(/\D/g, '')),
        edition: tb.edition,
      });
      if (!derived.ok || derived.value !== tb.key) {
        throw new Error('Workspace package textbook identity does not match its coordinates.');
      }
      if (supplied && supplied !== tb.key) throw new Error('ZIP textbookKey conflicts with package textbook key.');
      return tb.key;
    }
    if (!supplied) throw new Error('A partial workspace ZIP must specify textbookKey.');
    return supplied;
  }

  private async overlayDirectory(source: string, target: string): Promise<void> {
    for (const entry of await fs.readdir(source, { withFileTypes: true })) {
      if (entry.name === 'textbook.pdf') continue;
      const src = path.join(source, entry.name);
      const dst = path.join(target, entry.name);
      if (entry.isDirectory()) {
        await fs.mkdir(dst, { recursive: true });
        await this.overlayDirectory(src, dst);
      } else if (entry.isFile()) {
        await fs.mkdir(path.dirname(dst), { recursive: true });
        await fs.copyFile(src, dst);
      }
    }
  }

  private async compareTrees(before: string, after: string) {
    const beforeMap = await this.fileHashes(before);
    const afterMap = await this.fileHashes(after);
    let addedFiles = 0;
    let updatedFiles = 0;
    let unchangedFiles = 0;
    for (const [file, hash] of afterMap) {
      const old = beforeMap.get(file);
      if (!old) addedFiles++;
      else if (old === hash) unchangedFiles++;
      else updatedFiles++;
    }
    return { addedFiles, updatedFiles, unchangedFiles };
  }

  private async fileHashes(root: string): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (!(await this.exists(root))) return result;
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.isFile()) {
          const hash = crypto.createHash('sha256').update(await fs.readFile(full)).digest('hex');
          result.set(path.relative(root, full).split(path.sep).join('/'), hash);
        }
      }
    };
    await walk(root);
    return result;
  }

  private async commitCandidate(target: string, candidate: string): Promise<void> {
    const targetExists = await this.exists(target);
    const backup = `${target}.previous-${crypto.randomUUID()}`;
    if (targetExists) {
      await fs.rename(target, backup);
    }
    try {
      await fs.rename(candidate, target);
      if (targetExists) await fs.rm(backup, { recursive: true, force: true });
    } catch (error) {
      if (targetExists && !(await this.exists(target)) && (await this.exists(backup))) {
        await fs.rename(backup, target);
      }
      throw error;
    }
  }

  private async exists(file: string): Promise<boolean> {
    try {
      await fs.stat(file);
      return true;
    } catch {
      return false;
    }
  }
}
