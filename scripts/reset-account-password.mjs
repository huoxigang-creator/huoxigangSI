import { randomBytes, scryptSync } from 'node:crypto';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const [username] = process.argv.slice(2);
if (!/^[a-zA-Z0-9._-]{3,64}$/.test(username || '')) {
  process.stderr.write('Usage: node scripts/reset-account-password.mjs USERNAME (new password on stdin)\n');
  process.exit(2);
}

let input = '';
for await (const chunk of process.stdin) input += chunk;
const password = input.replace(/[\r\n]+$/, '');
if (password.length < 12 || password.length > 1024) {
  process.stderr.write('Password must be 12-1024 characters.\n');
  process.exit(2);
}

const root = resolve(process.env.GUGEMEI_DATA_DIR || join(process.cwd(), 'data'));
const db = new DatabaseSync(join(root, 'gugemei.sqlite'));
const account = db.prepare('SELECT id FROM accounts WHERE username = ?').get(username);
if (!account) {
  process.stderr.write('Account not found; no changes made.\n');
  process.exit(1);
}
const salt = randomBytes(32);
const hash = scryptSync(password, salt, 64);
db.prepare('UPDATE accounts SET password_hash = ?, salt = ?, updated = ? WHERE id = ?')
  .run(hash.toString('hex'), salt.toString('hex'), new Date().toISOString(), account.id);
process.stdout.write(`Password reset for account: ${username}\n`);
