#!/usr/bin/env node
/**
 * Import one or more Edu7 JSON content packages through the canonical
 * ContentImportService. The Python content engine is not required.
 *
 * Safe default: dry-run. --apply performs a preflight for every file first,
 * then writes only if all preflights are free of blocking problems.
 *
 * Examples:
 *   npm run content:import -- --file ./content-data/G07/SCI/P1.json
 *   npm run content:import -- --file a.json --file b.json --apply
 *   npm run content:import -- --file questions-1.json --file questions-2.json --apply
 *   npm run content:import -- --file update.json --mode UPDATE --apply
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnv } from '../src/shared/config/env.js';
import { buildContainer } from '../src/composition/container.js';

type Mode = 'APPEND_DEDUP' | 'UPDATE';

function usage(): never {
  console.error(
    [
      'Usage: npm run content:import -- --file <package.json> [options]',
      '',
      'Options:',
      '  --file <path>          Repeatable. Import several JSON files in one run.',
      '  --apply                Apply after all files pass preflight. Default is dry-run.',
      '  --mode <mode>          APPEND_DEDUP (default) or UPDATE.',
      '  --target <textbookKey> Override the package textbook key.',
      '  --help                 Show this help.',
    ].join('\n'),
  );
  process.exit(2);
}

function parseArgs(argv: readonly string[]) {
  const files: string[] = [];
  let apply = false;
  let mode: Mode = 'APPEND_DEDUP';
  let targetTextbookKey: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help') usage();
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg === '--file') {
      const value = argv[++i];
      if (!value) usage();
      files.push(value);
      continue;
    }
    if (arg === '--mode') {
      const value = argv[++i];
      if (value !== 'APPEND_DEDUP' && value !== 'UPDATE') usage();
      mode = value;
      continue;
    }
    if (arg === '--target') {
      targetTextbookKey = argv[++i];
      if (!targetTextbookKey) usage();
      continue;
    }
    console.error(`Unknown argument: ${arg}`);
    usage();
  }

  if (files.length === 0) usage();
  return { files, apply, mode, targetTextbookKey };
}

function readPackage(file: string): Record<string, unknown> {
  const path = resolve(file);
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('The root JSON value must be an object.');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `Cannot read JSON package "${path}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function printResult(label: string, result: any): boolean {
  if (!result.ok) {
    console.error(`[content-import] ${label}: ${result.error.code}: ${result.error.message}`);
    return false;
  }

  const value = result.value;
  console.log(
    JSON.stringify(
      {
        file: label,
        textbookKey: value.textbookKey,
        dryRun: value.dryRun,
        applied: value.applied,
        created: value.created,
        unchanged: value.unchanged,
        problems: value.problems,
      },
      null,
      2,
    ),
  );

  return value.problems.every((problem: { severity: string }) => problem.severity !== 'BLOCKING');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const packages = args.files.map(readPackage);
  const env = loadEnv();
  const container = buildContainer(env);

  try {
    const ctx = {
      actorKey: 'SYSTEM_JSON_CONTENT_IMPORT',
      canManageOfficialBank: true,
    } as const;

    // Always preflight every file. This makes multi-file question/content
    // batches safe: an invalid second file cannot leave the first half applied.
    let preflightOk = true;
    for (const [index, pkg] of packages.entries()) {
      const result = await container.useCases.contentImport.importPackage(ctx, pkg, {
        dryRun: true,
        mode: args.mode,
        targetTextbookKey: args.targetTextbookKey,
      });
      preflightOk = printResult(`preflight:${args.files[index]}`, result) && preflightOk;
    }

    if (!args.apply) {
      console.log('[content-import] dry-run only; nothing was written.');
      return;
    }

    if (!preflightOk) {
      console.error('[content-import] apply refused because at least one file has blocking problems.');
      process.exitCode = 1;
      return;
    }

    let applyOk = true;
    for (const [index, pkg] of packages.entries()) {
      const result = await container.useCases.contentImport.importPackage(ctx, pkg, {
        dryRun: false,
        mode: args.mode,
        targetTextbookKey: args.targetTextbookKey,
      });
      applyOk = printResult(`apply:${args.files[index]}`, result) && applyOk;
    }

    if (!applyOk) process.exitCode = 1;
  } finally {
    await container.shutdown();
  }
}

main().catch((error) => {
  console.error('[content-import] failed:', error);
  process.exitCode = 1;
});
