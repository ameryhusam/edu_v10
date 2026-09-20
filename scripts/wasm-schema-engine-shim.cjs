#!/usr/bin/env node
'use strict';
/**
 * WASM shim for the Prisma schema engine.
 *
 * Why this exists: `prisma migrate` normally downloads a native engine binary
 * from binaries.prisma.sh. In restricted or air-gapped networks (including CI
 * and this sandbox) that download fails and every schema command dies. Prisma
 * also ships the same engine compiled to WebAssembly, so this file speaks the
 * binary's JSON-RPC-over-stdio protocol and forwards each call to the WASM
 * build instead.
 *
 * It is generated into node_modules by scripts/setup-schema-engine.mjs and is
 * therefore never committed.
 *
 * Schema-only commands (`migrate diff --from-empty`, `validate`, `format`)
 * work with no database at all. Commands that touch a live database require a
 * reachable DATABASE_URL, exactly as the real engine does.
 */
const path = require('path');
const fs = require('fs');
const readline = require('readline');

const args = process.argv.slice(2);
const datamodelPaths = [];
let datasourceArg = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--datamodels') {
    const v = args[++i];
    if (v !== undefined) datamodelPaths.push(v);
  } else if (args[i] === '--datasource') {
    try {
      datasourceArg = JSON.parse(args[++i]);
    } catch {
      datasourceArg = null;
    }
  }
}

if (args.includes('--version')) {
  console.log('schema-engine 7.10.0 (wasm-shim)');
  process.exit(0);
}

const log = (level, message) => {
  try {
    process.stderr.write(JSON.stringify({ level, fields: { message } }) + '\n');
  } catch {}
};

function resolveUrl() {
  let url = null;
  if (datasourceArg && typeof datasourceArg === 'object') {
    url =
      typeof datasourceArg.url === 'string'
        ? datasourceArg.url
        : datasourceArg.url && typeof datasourceArg.url.value === 'string'
          ? datasourceArg.url.value
          : null;
  }
  return url || process.env.DATABASE_URL || '';
}

/* Positional CLI subcommands used by execa (exit 0 = success). */
const cliIdx = args.indexOf('cli');
if (cliIdx !== -1) {
  const cmd = args[cliIdx + 1];
  const fail = (code, message) => {
    process.stderr.write('error: ' + message + '\n');
    process.stderr.write(
      JSON.stringify({
        level: 'ERROR',
        target: 'schema_engine::logger',
        fields: { error_code: code, message },
      }) + '\n',
    );
    process.exit(1);
  };
  // Without a live database these cannot be verified; report honestly.
  if (cmd === 'can-connect-to-database') {
    fail('P1001', `Cannot reach the database at ${resolveUrl() || '(no DATABASE_URL)'}`);
  }
  if (cmd === 'create-database') {
    fail('P1001', 'create-database requires a reachable database server');
  }
  process.stderr.write(`wasm-shim: unknown positional command: ${cmd}\n`);
  process.exit(1);
}

const cwd = process.cwd();
const schemaFiles = [];
for (const mp of datamodelPaths.length ? datamodelPaths : ['prisma/schema.prisma']) {
  const abs = path.isAbsolute(mp) ? mp : path.join(cwd, mp);
  try {
    schemaFiles.push({ content: fs.readFileSync(abs, 'utf8'), path: mp });
  } catch (e) {
    log('ERROR', `cannot read schema file ${mp}: ${e.message}`);
  }
}
if (!schemaFiles.length) {
  log('ERROR', 'no schema files — cannot start engine');
  process.exit(1);
}

function buildMigrationsList() {
  const baseDir = path.join(cwd, 'prisma', 'migrations');
  const dirs = [];
  if (fs.existsSync(baseDir)) {
    for (const d of fs.readdirSync(baseDir).sort()) {
      const sqlPath = path.join(baseDir, d, 'migration.sql');
      if (!fs.existsSync(sqlPath)) continue;
      dirs.push({
        path: d,
        migrationFile: {
          path: 'migration.sql',
          content: { tag: 'ok', value: fs.readFileSync(sqlPath, 'utf8') },
        },
      });
    }
  }
  const lockPath = path.join(baseDir, 'migration_lock.toml');
  return {
    baseDir,
    lockfile: {
      path: 'migration_lock.toml',
      content: fs.existsSync(lockPath) ? fs.readFileSync(lockPath, 'utf8') : null,
    },
    shadowDbInitScript: '',
    migrationDirectories: dirs,
  };
}

const DEFAULT_FILTERS = { externalTables: [], externalEnums: [] };

(async () => {
  const enginePath = path.join(__dirname, '..', 'schema-engine-wasm', 'schema_engine.js');
  const { SchemaEngine } = await import(enginePath);

  const datamodels = schemaFiles.map((f) => [f.content, f.path]);
  // No driver adapter: schema-only operations (diff/validate/format) never
  // touch a database. Database-touching methods will surface a clear error.
  const engine = await SchemaEngine.new({ datamodels }, (m) => {
    if (typeof m === 'string') log('INFO', m);
  });
  log('INFO', 'wasm-shim ready (schema-only mode)');

  const schemasContainer = () => ({ files: schemaFiles });

  const METHODS = {
    async getDatabaseVersion() {
      return engine.version();
    },
    async diff(p) {
      return engine.diff({
        from: p && p.from,
        to: p && p.to,
        script: !!(p && p.script),
        exitCode: p && p.exitCode != null ? p.exitCode : null,
        shadowDatabaseUrl: p && p.shadowDatabaseUrl != null ? p.shadowDatabaseUrl : null,
      });
    },
    async createMigration(p) {
      return engine.createMigration({
        draft: !!(p && p.draft),
        migrationName: (p && (p.migrationName || p.name)) || 'migration',
        migrationsList: (p && p.migrationsList) || buildMigrationsList(),
        schema: (p && p.schema) || schemasContainer(),
      });
    },
    async applyMigrations(p) {
      return engine.applyMigrations({
        migrationsList: (p && p.migrationsList) || buildMigrationsList(),
        filters: (p && p.filters) || DEFAULT_FILTERS,
      });
    },
    async schemaPush(p) {
      return engine.schemaPush({
        schema: (p && p.schema) || schemasContainer(),
        force: !!(p && p.force),
        filters: (p && p.filters) || DEFAULT_FILTERS,
      });
    },
    async devDiagnostic(p) {
      return engine.devDiagnostic({
        migrationsList: (p && p.migrationsList) || buildMigrationsList(),
        filters: (p && p.filters) || DEFAULT_FILTERS,
      });
    },
    async diagnoseMigrationHistory(p) {
      return engine.diagnoseMigrationHistory({
        migrationsList: (p && p.migrationsList) || buildMigrationsList(),
        optInToShadowDatabase: !!(p && p.optInToShadowDatabase),
        filters: (p && p.filters) || DEFAULT_FILTERS,
      });
    },
    async evaluateDataLoss(p) {
      return engine.evaluateDataLoss({
        migrationsList: (p && p.migrationsList) || buildMigrationsList(),
        schema: (p && p.schema) || schemasContainer(),
        filters: (p && p.filters) || DEFAULT_FILTERS,
      });
    },
    async ensureConnectionValidity() {
      return engine.ensureConnectionValidity({
        datasource: { tag: 'Schema', files: schemaFiles },
      });
    },
    async reset() {
      return engine.reset();
    },
    async dbExecute(p) {
      return engine.dbExecute(p || {});
    },
  };

  const respond = (id, payload) => {
    try {
      process.stdout.write(JSON.stringify({ id, jsonrpc: '2.0', ...payload }) + '\n');
    } catch {}
  };

  let queue = Promise.resolve();
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    line = line.trim();
    if (!line) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    const { id, method, params } = msg || {};
    if (typeof id !== 'number' || !method) return;

    queue = queue.then(async () => {
      try {
        const fn = METHODS[method];
        if (!fn) {
          respond(id, {
            error: {
              message: `method ${method} is not supported by the wasm shim`,
              data: { message: `unsupported method ${method}`, is_panic: false },
            },
          });
          return;
        }
        respond(id, { result: await fn(params) });
      } catch (err) {
        const message = (err && (err.message || err.error)) || String(err);
        respond(id, {
          error: { message, data: { message, is_panic: false } },
        });
      }
    });
  });
})().catch((err) => {
  log('ERROR', 'wasm-shim failed to start: ' + ((err && err.message) || String(err)));
  process.exit(1);
});
