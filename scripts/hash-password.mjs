#!/usr/bin/env node
/**
 * hash-password.mjs — generate a PBKDF2-SHA256 hash of a password
 * for use as the HAWKEYE_BRAIN_PASSWORD_HASH env var.
 *
 * WHY:
 *   The deployed app authenticates MLRO login via a password, not a
 *   hex token. We never store the plaintext — the server only ever
 *   sees the hash format below and compares a presented password by
 *   re-deriving the hash with the stored salt + iterations.
 *
 *   PBKDF2-SHA256 at 310_000 iterations is OWASP's current
 *   recommendation for password storage (2023 guidance). Yes, argon2id
 *   is stronger — but this single-env-var pattern has to run on
 *   Netlify Functions without a native module build step, so we stay
 *   on the Node builtin `crypto.pbkdf2Sync`.
 *
 * USAGE:
 *
 *   # Interactive (recommended — password never enters shell history):
 *   node scripts/hash-password.mjs
 *
 *   # Non-interactive (for CI scripting — use with care):
 *   HAWKEYE_PASSWORD='your-password' node scripts/hash-password.mjs
 *
 *   The script prints a single line you paste into Netlify under
 *   HAWKEYE_BRAIN_PASSWORD_HASH. The plaintext is never logged or
 *   written to disk.
 *
 * FORMAT:
 *   pbkdf2-sha256$<iterations>$<salt-base64>$<hash-base64>
 *
 *   Rotating iterations or salt is non-breaking — the server parses
 *   the full envelope on every verify, so upgrading the ceiling later
 *   only requires regenerating the hash.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20-21 (CO accountability; the MLRO login
 *     grants access to STR + freeze + four-eyes flows — a weak
 *     credential is a direct audit finding)
 *   - CLAUDE.md Seguridad §5 (password hashing; bcrypt / argon2 /
 *     PBKDF2 with strong iteration count; NEVER plaintext)
 */

import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { stdin as input, stdout as output, exit, env } from 'node:process';

const ITERATIONS = 310_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;
const DIGEST = 'sha256';
const MIN_PASSWORD_LEN = 12;

function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES);
  const hash = pbkdf2Sync(password, salt, ITERATIONS, HASH_BYTES, DIGEST);
  return `pbkdf2-${DIGEST}$${ITERATIONS}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/**
 * Read a password from stdin with echo disabled when the environment
 * supports it. Falls back to plain readline on non-TTY stdin (e.g.
 * piped input from a CI secret manager).
 */
async function promptPassword(promptText) {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input, output, terminal: true });
    // Silence echo. Node's readline doesn't support this natively —
    // we intercept the output write so characters never print.
    const origWrite = output.write.bind(output);
    let muted = false;
    output.write = (chunk, encoding, cb) => {
      if (muted && typeof chunk === 'string' && chunk !== promptText) return true;
      return origWrite(chunk, encoding, cb);
    };
    rl.question(promptText, (answer) => {
      muted = false;
      output.write = origWrite;
      output.write('\n');
      rl.close();
      resolve(answer);
    });
    muted = true;
    rl.on('error', (err) => {
      output.write = origWrite;
      reject(err);
    });
  });
}

async function main() {
  let password = env.HAWKEYE_PASSWORD;
  if (!password) {
    if (!input.isTTY) {
      console.error(
        'hash-password: stdin is not a TTY and HAWKEYE_PASSWORD is not set. ' +
          'Either run interactively or pass HAWKEYE_PASSWORD in the environment.'
      );
      exit(2);
    }
    password = await promptPassword('Password: ');
    const confirm = await promptPassword('Confirm : ');
    if (password !== confirm) {
      console.error('Passwords did not match.');
      exit(2);
    }
  }

  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LEN) {
    console.error(
      `Password must be at least ${MIN_PASSWORD_LEN} characters (got ${password?.length ?? 0}).`
    );
    exit(2);
  }

  const envelope = hashPassword(password);
  // Clobber the variable so it isn't left in memory longer than needed.
  password = null;

  output.write('\n');
  output.write('Set this on Netlify (Site settings → Environment variables):\n\n');
  output.write(`HAWKEYE_BRAIN_PASSWORD_HASH=${envelope}\n\n`);
  output.write(
    'Also ensure HAWKEYE_JWT_SECRET is set to a random 32+ byte value ' +
      '(openssl rand -hex 48). Then redeploy so the functions pick up both.\n'
  );
}

main().catch((err) => {
  console.error('hash-password: failed:', err?.message ?? err);
  exit(1);
});
