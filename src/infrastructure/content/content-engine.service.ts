import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
  ContentEnginePort,
  ContentEnginePrepareInput,
  ContentEnginePrepareResult,
} from '../../contexts/content/application/content-engine.port.js';

const execFileAsync = promisify(execFile);

export class ContentEngineService implements ContentEnginePort {
  constructor(
    private readonly pythonCommand: string,
    private readonly engineRoot: string,
  ) {}

  async prepare(input: ContentEnginePrepareInput): Promise<ContentEnginePrepareResult> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'edu7-content-'));
    const sourcePath = path.join(tempDir, 'source.pdf');

    try {
      await fs.writeFile(sourcePath, input.pdf);
      await fs.mkdir(input.workspaceDir, { recursive: true });

      const args = [
        '-m',
        'edu7_content.cli.main',
        'prepare',
        sourcePath,
        '--workspace',
        input.workspaceDir,
        '--subject',
        input.subject,
        '--grade',
        input.grade,
        '--term',
        input.term,
      ];
      if (input.edition) args.push('--edition', input.edition);
      if (input.title) args.push('--title', input.title);

      const result = await execFileAsync(this.pythonCommand, args, {
        // Run from the repository root so the Python engine can discover the
        // shared .env while PYTHONPATH points at its src package.
        cwd: path.resolve(this.engineRoot, '..'),
        timeout: input.timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
        env: {
          ...process.env,
          PYTHONPATH: path.join(this.engineRoot, 'src'),
        },
      });

      let preparedWorkspaceDir = input.workspaceDir;
      if (!input.edition) {
        const entries = await fs.readdir(input.workspaceDir, { withFileTypes: true });
        const candidates = entries
          .filter((entry) => entry.isDirectory() && /^ED[A-Z0-9-]+$/i.test(entry.name))
          .map((entry) => path.join(input.workspaceDir, entry.name));
        if (candidates.length !== 1) {
          throw new Error('Content engine did not produce exactly one edition workspace when edition was not supplied.');
        }
        const firstCandidate = candidates[0];
        if (firstCandidate) preparedWorkspaceDir = firstCandidate;
      }
      return {
        workspaceDir: preparedWorkspaceDir,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`edu7-content prepare failed: ${detail}`);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
}
