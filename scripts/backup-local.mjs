import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const dataRoot = resolve(process.env.GUGEMEI_DATA_DIR || '/var/lib/gugemei');
const backupRoot = join(dataRoot, 'backups');
const databasePath = join(dataRoot, 'gugemei.sqlite');
const sessionPath = join(dataRoot, 'session-secret');
if (!existsSync(databasePath) || !existsSync(sessionPath)) throw new Error('Live database or session secret is missing');
mkdirSync(backupRoot, { recursive: true, mode: 0o700 });

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const base = `gugemei-backup-${stamp}`;
const dbFile = join(backupRoot, `${base}-db.sqlite`);
const filesFile = join(backupRoot, `${base}-files.tar.gz`);
const reportFile = join(backupRoot, `${base}-report.json`);
async function hash(path) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}

try {
  const live = new DatabaseSync(databasePath);
  live.exec('PRAGMA busy_timeout = 5000');
  live.prepare('VACUUM INTO ?').run(dbFile);
  live.close();
  const restored = new DatabaseSync(dbFile);
  const integrity = restored.prepare('PRAGMA integrity_check').get().integrity_check;
  const records = Number(restored.prepare('SELECT COUNT(*) AS n FROM records').get().n);
  const accounts = Number(restored.prepare('SELECT COUNT(*) AS n FROM accounts').get().n);
  restored.close();
  if (integrity !== 'ok') throw new Error('Database snapshot integrity check failed');

  const items = ['session-secret'];
  if (existsSync(join(dataRoot, 'files'))) items.push('files');
  const tar = spawnSync('/usr/bin/tar', ['-C', dataRoot, '-czf', filesFile, ...items], { encoding: 'utf8' });
  if (tar.status !== 0) throw new Error(`Attachment archive failed: ${tar.stderr}`);
  const listing = spawnSync('/usr/bin/tar', ['-tzf', filesFile], { encoding: 'utf8' });
  if (listing.status !== 0 || !listing.stdout.includes('session-secret')) throw new Error('Attachment archive verification failed');

  const report = {
    created: new Date().toISOString(), records, accounts,
    database: { file: `${base}-db.sqlite`, bytes: statSync(dbFile).size, sha256: await hash(dbFile) },
    files: { file: `${base}-files.tar.gz`, bytes: statSync(filesFile).size, sha256: await hash(filesFile) },
  };
  writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });

  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const name of readdirSync(backupRoot)) {
    if (!/^gugemei-backup-\d{8}T\d{6}Z-(db\.sqlite|files\.tar\.gz|report\.json)$/.test(name)) continue;
    const path = join(backupRoot, name);
    if (statSync(path).mtimeMs < cutoff) rmSync(path);
  }
  console.log(JSON.stringify({ report: reportFile, records, accounts }));
} catch (error) {
  for (const path of [dbFile, filesFile, reportFile]) {
    if (existsSync(path)) rmSync(path);
  }
  throw error;
}
