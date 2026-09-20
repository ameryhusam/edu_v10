/**
 * The dev server has to survive the container it actually runs in.
 *
 * Two of these guards exist because the dev server broke in ways that looked
 * like application bugs: a blocked syscall killed Vite after it had already
 * bound its port, and an absolute backend URL would send the browser to a
 * machine that is not the one serving the API. Neither is covered by a
 * component test, because neither is in a component.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const config = readFileSync(join(__dirname, '../../vite.config.ts'), 'utf8');

describe('vite dev server config', () => {
  it('guards os.networkInterfaces(), which throws in hardened containers', () => {
    // Vite calls networkInterfaces() only to print the "Network:" line, but it
    // does so in the 'listening' handler — so an EPERM there is an unhandled
    // throw that kills a server which had already started successfully. The
    // reported error was "uv_interface_addresses returned Unknown system
    // error 13". Losing the log line is acceptable; losing the server is not.
    expect(config).toMatch(/os\.networkInterfaces\s*=/);
    expect(config).toMatch(/catch\s*{\s*return\s*{\s*}\s*;?\s*}/);
  });

  it('proxies /api instead of hardcoding a backend origin', () => {
    // The browser is not the machine running the API. It must call its own
    // origin and let Vite forward, which also keeps the refresh cookie
    // same-origin so it can stay httpOnly.
    expect(config).toMatch(/['"]\/api['"]\s*:/);
    expect(config).toMatch(/target:\s*['"]http:\/\/127\.0\.0\.1:3000['"]/);
  });

  it('binds every interface and accepts the generated preview host', () => {
    // The preview host is generated per sandbox, so an exact allowlist would
    // break on each restart.
    expect(config).toMatch(/host:\s*['"]0\.0\.0\.0['"]/);
    expect(config).toMatch(/allowedHosts:\s*true/);
  });
});
