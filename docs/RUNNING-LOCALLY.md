# Running Edu7

Three processes, **one URL**.

| Process | Port | What it is |
|---|---|---|
| Gateway + API | **3000** | The application. The API serves `/api/v1`; every other path is the UI. |
| Web (Vite, dev only) | 5173 | Internal. The gateway proxies the UI and HMR to it. |
| Database | 5432 | Internal. PGlite, embedded. |

**Open 3000. That one address is the whole product** — the SPA, its assets, hot
reload in development, and `/api/v1` behind the same origin. The frontend calls
the relative path `/api/v1`, never an absolute backend URL, which keeps the
refresh cookie same-origin without a CORS dance.

This is why the port is configured as `APP_PORT`, never `PORT`: sandboxed
containers export `PORT=8080` for their own router, and binding there makes the
app unreachable — the preview routes the product port (3000) only.

## Repository layout

```
<repo root>/        the system — src/ web/ prisma/ scripts/ docs/ tests/
legacy/             the previous system, kept for reference only
```

`legacy/` is never built, tested or imported from; see
`legacy/ABOUT-THIS-DIRECTORY.md`. The single intentional link is data, not
code: `scripts/convert-legacy-curriculum.mjs` reads `legacy/data/demo/`.

## Cold start

Run these once from the repository root, then use `npm run dev` from then on.

```bash
cp .env.example .env        # config  (gitignored, so it vanishes on a rebuild)
npm ci                      # backend AND frontend deps (postinstall does web/)
npm run db:generate         # Prisma client
npm run db:setup            # schema migrations and seed reference data (run once)
npm run dev                 # start development servers (without re-running setup)
```

`web/` is a separate npm project with its own lockfile, but you no longer have
to remember that: the root `postinstall` installs it too. It used to be a
manual step, and skipping it produced `sh: vite: not found` two commands later
— a failure that names the symptom and not the cause. `npm run dev` now checks
for it before starting anything and tells you what to run.

Set `EDU7_SKIP_WEB_INSTALL=1` if you want to install the two halves yourself.

## Which URL is which

Three services start together and each prints its own address, interleaved.
Only one of them is the app:

| What | URL | |
|---|---|---|
| **The app** | http://localhost:3000 | **open this** — UI and API, one origin |
| API index | http://localhost:3000/api/v1 | the JSON service directory |
| API health | http://localhost:3000/api/v1/health | |
| Database | `postgresql://127.0.0.1:5432` | PGlite, embedded |

Vite also answers directly on 5173 if you open it (its own `/api` proxy still
works there), but that address is a convenience for a desktop, not the product:
previews and tunnels route the gateway port only.

## Where the database actually lives

In **`.pgdata/`** at the repository root — a real Postgres data directory
(`base/`, `global/`, `pg_wal/`, …), not a single file you can open. Roughly
40 MB once seeded, and git-ignored, so it never leaves your machine.

```bash
du -sh .pgdata            # how big it is
ls .pgdata                # PG_VERSION, base/, global/, pg_wal/ ...
```

To *look at the data*, query it rather than opening the directory:

```bash
node scripts/query.mjs "select username, status from users"
```

Any Postgres client works too — `psql postgresql://postgres:postgres@127.0.0.1:5432/postgres`
— while the database is running. Deleting `.pgdata` discards the entire
development database; `npm run db:setup` rebuilds it from migrations and the
seed.

## Two things about the development database

It is **PGlite**, a real Postgres compiled to WASM, served over a TCP socket.
Two of its properties cause errors that name the wrong cause:

**It has a connection limit, and the default was one.** That default is why a
second client — `db:seed` while the API was running, or `scripts/query.mjs` —
used to be dropped with `P1010 — User was denied access on the database` or
`Connection terminated unexpectedly`. Neither is a permissions problem; the
credentials were always fine. The server simply had no free slot, and reported
a capacity limit in the vocabulary of access control.

`scripts/dev-db.mjs` now sets `maxConnections` to 10 (override with
`DEV_DB_MAX_CONNECTIONS`), so you can seed, query and run psql against a live
API. PGlite still executes one statement at a time and queues the rest, so this
buys concurrent *clients*, not parallel execution — and a long open transaction
on one connection will still stall the others. That is why `npm run dev`
finishes database setup before starting the API rather than relying on this.

**It ignores the database name in the URL.** It hosts exactly one database and
reports it as `postgres` whatever you ask for. The URL said `/template1` for a
while, which reads as "the app is running inside Postgres's template database"
— alarming and untrue. It says `/postgres` now because that is what
`current_database()` returns.

## Everyday: one command, three services

```bash
npm run dev
```

This runs in two stages, and the order matters:

1. **Preflight, then database setup.** It checks your tooling, then brings the
   database up, applies migrations and seeds reference data — and waits for
   that to finish. On a fresh checkout this is the stage that builds the
   schema.
2. **The three services**, with colour-coded prefixes; `Ctrl-C` stops all three.

```
[db:setup] applying migrations…
[db:setup] seeding reference data…
[db:setup] database ready

[db]  postgres listening on 127.0.0.1:5432
[api] listening on http://0.0.0.0:3000
[api] serving the API and the Vite dev UI from this one port — HMR included
[web] VITE ready (proxied through 3000)
```

The stages are sequential because they used to be parallel, and the API would
reach an empty database and answer every login with a 500 — an initialisation
failure that looked exactly like an authentication bug. Starting the database
is not the same as the database being *ready*, and only readiness is worth
starting an API against.

Setup is safe to repeat: migrations are recorded in `_prisma_migrations` and
the seed is written as upserts, so a warm start costs a second or two and
changes nothing. It never deletes data — that is `npm run db:reset`.

If you skip `npm run dev` and start the API by hand against a database with no
schema, the API refuses to start and tells you to run `npm run db:setup`
instead of binding a port and failing every request.

They remain **three separate processes**, which is the point: editing React
never restarts the API, Vite keeps hot module replacement, the frontend talks
to the API over real HTTP exactly as it will in production, and CORS, cookies
and tokens are exercised for real rather than faked by sharing a process.
`concurrently` only spares you three terminals.

There is deliberately **no `--kill-others`**: if the API crashes, Vite should
stay up so you can read the error, rather than the whole stack vanishing.

Individual pieces, when you want them:

```bash
npm run db:setup   # database up to date: migrations + seed, then exits
npm run dev:db     # database only
npm run dev:api    # API only
npm run dev:web    # web only  (delegates to web/)
```

`db:setup` uses a database that is already running and starts a temporary one
if none is, so it works whether or not your stack is up.

Demo logins, all with password `demo1234`:
`student` · `teacher` · `parent` · `admin` · `author` · `reviewer` ·
`superadmin` · `ahmed` · `sara`

## If sign-in bounces back to the login form

**This is almost always `COOKIE_SAMESITE`.**

The symptom is misleading: `POST /auth/login` returns **200**, the session is
real, the dashboard may even paint for an instant — and then the next request
401s and the app returns to sign-in, looking exactly like a wrong password.

The cause is that the access token lives in memory only, by design. The
long-lived credential is an httpOnly refresh cookie. When the app is embedded in
an **iframe on another origin** — which is what a sandboxed preview is — that
cookie is third-party, and a `SameSite=Lax` cookie is silently withheld by the
browser. Nothing is logged, because from the server's point of view the request
simply arrived without a cookie.

```bash
# in .env
COOKIE_SAMESITE=none      # iframe / cross-site preview  (default here)
COOKIE_SAMESITE=lax       # same-site deployment — stricter, prefer when possible
```

`none` requires HTTPS. The server checks `X-Forwarded-Proto` (via
`trust proxy`) and **downgrades to `lax` on a plain-HTTP request** rather than
emitting `SameSite=None` without `Secure`, which every modern browser rejects
outright.

Verify the cookie is right:

```bash
curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Host: <preview-host>" -H "Origin: https://<preview-host>" \
  -H "X-Forwarded-Proto: https" -H 'Content-Type: application/json' \
  -d '{"identifier":"student","password":"demo1234"}' -D - -o /dev/null | grep -i set-cookie
```

Expect `HttpOnly; Secure; SameSite=None`. If you see `SameSite=Lax` with no
`Secure`, `.env` is wrong or the API did not restart after you changed it.

## If Vite dies with `uv_interface_addresses` / "Unknown system error 13"

```
SystemError [ERR_SYSTEM_ERROR]: A system error occurred:
uv_interface_addresses returned Unknown system error 13
    at Object.networkInterfaces (node:os:218:16)
    at resolveServerUrls (.../vite/dist/node/chunks/config.js)
```

Already handled in `vite.config.ts`, but worth understanding if it resurfaces.

Some hardened containers block the netlink socket behind
`os.networkInterfaces()`. Vite calls it only to **print the "Network:" line** —
but it does so inside the `listening` handler, so the throw is unhandled and
kills a server that had *already bound its port successfully*. A cosmetic log
line takes down the dev server.

`vite.config.ts` wraps the call and returns `{}` when the syscall is refused:
you lose the "Network:" line and nothing else. Guarded by
`src/test/dev-server-config.test.ts`, which fails if the wrapper is removed.

## If the app shows a blank page or modules fail to load

`node_modules` is excluded from workspace snapshots, so a container rebuild
leaves the dev servers running against **deleted dependencies**. Vite keeps
answering and serves broken module graphs through the gateway.

```bash
npm ci                # from the repository root
cd web && npm ci
# then restart the dev servers
```

`.env` and `.pgdata` are gitignored and disappear the same way — if the API
fails with `DATABASE_URL is not set`, redo the cold start above.

## What the student actually sees today

The demo student is entitled to **one** textbook: the 3-concept seed book. The
two converted national curricula (55 and 57 concepts) are still `DRAFT`, and
draft content is correctly invisible to learners.

So a mostly-empty dashboard is **expected**, not a bug. It fills once those
books pass SUBMIT → APPROVE → PUBLISH — see `OPEN-ITEMS-CLOSURE-PLAN.md`.
