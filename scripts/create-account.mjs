import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const [username, role, displayName] = process.argv.slice(2);
if (!/^[a-zA-Z0-9._-]{3,64}$/.test(username || '') || !['owner', 'employee'].includes(role) || !displayName?.trim()) {
  process.stderr.write('Usage: node scripts/create-account.mjs USERNAME owner|employee DISPLAY_NAME (password on stdin)\n');
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
mkdirSync(root, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(join(root, 'gugemei.sqlite'));
db.exec('CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN (\'owner\', \'employee\')), password_hash TEXT NOT NULL, salt TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created TEXT NOT NULL, updated TEXT NOT NULL)');
if (db.prepare('SELECT 1 FROM accounts WHERE username = ?').get(username)) {
  process.stderr.write('Account already exists; no changes made.\n');
  process.exit(1);
}
const salt = randomBytes(32);
const hash = scryptSync(password, salt, 64);
const now = new Date().toISOString();
db.prepare('INSERT INTO accounts(id, username, display_name, role, password_hash, salt, active, created, updated) VALUES(?,?,?,?,?,?,1,?,?)')
  .run(randomUUID(), username, displayName.trim(), role, hash.toString('hex'), salt.toString('hex'), now, now);
process.stdout.write(`Created ${role} account: ${username}\n`);
