/**
 * Mint a development JWT for manual API testing.
 *
 * Temporary: it exists only until the Identity context issues real tokens
 * (capability 16). It deliberately refuses to run outside development so it can
 * never be used to forge a token against a real deployment.
 *
 *   node -r dotenv/config scripts/dev-token.mjs [learnerKey]
 */
import 'dotenv/config';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jwt = createRequire(path.join(ROOT, 'package.json'))('jsonwebtoken');

if (process.env.NODE_ENV === 'production') {
  console.error('dev-token: refusing to run with NODE_ENV=production');
  process.exit(1);
}

const secret = process.env.JWT_SECRET;
if (!secret) {
  console.error('dev-token: JWT_SECRET is not set');
  process.exit(1);
}

const learnerKey = process.argv[2] ?? 'lrn_demo_student';

process.stdout.write(
  jwt.sign(
    { sub: 'usr_demo_student', key: 'usr_demo_student', roles: ['STUDENT'], learnerKey },
    secret,
    { algorithm: 'HS256', expiresIn: '12h' },
  ),
);
