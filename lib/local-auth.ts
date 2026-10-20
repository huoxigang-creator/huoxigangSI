import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDirectory, rawDatabase } from './local-env';

export type Account = { id: string; username: string; display_name: string; role: 'owner' | 'employee'; active: number; updated: string };
export const SESSION_COOKIE = 'gugemei_session';
const sessionSecretPath = join(dataDirectory, 'session-secret');

function sessionSecret(): Buffer {
  try { return readFileSync(sessionSecretPath); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const value = randomBytes(32);
    try { writeFileSync(sessionSecretPath, value, { flag: 'wx', mode: 0o600 }); return value; }
    catch (writeError) {
      if ((writeError as NodeJS.ErrnoException).code === 'EEXIST') return readFileSync(sessionSecretPath);
      throw writeError;
    }
  }
}

function sign(payload: string): string {
  return createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
}

export function issueSession(account: Account): string {
  const payload = Buffer.from(JSON.stringify({ id: account.id, revision: account.updated, expires: Date.now() + 12 * 60 * 60 * 1000, nonce: randomBytes(12).toString('base64url') })).toString('base64url');
  return payload + '.' + sign(payload);
}

export function sessionAccount(token: string | undefined): Account | null {
  if (!token || token.length > 1024) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return null;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  let claims: { id?: string; revision?: string; expires?: number };
  try { claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); }
  catch { return null; }
  if (typeof claims.id !== 'string' || typeof claims.expires !== 'number' || claims.expires < Date.now()) return null;
  const account = rawDatabase.prepare('SELECT id, username, display_name, role, active, updated FROM accounts WHERE id = ?').get(claims.id) as Account | undefined;
  return account?.active === 1 && claims.revision === account.updated ? account : null;
}

export function verifyPassword(username: string, password: string): Account | null {
  if (!username || !password || username.length > 100 || password.length > 1024) return null;
  const row = rawDatabase.prepare('SELECT id, username, display_name, role, active, updated, password_hash, salt FROM accounts WHERE username = ?').get(username) as (Account & { password_hash: string; salt: string }) | undefined;
  if (!row || row.active !== 1) return null;
  const expected = Buffer.from(row.password_hash, 'hex');
  const actual = scryptSync(password, Buffer.from(row.salt, 'hex'), expected.length);
  if (!timingSafeEqual(actual, expected)) return null;
  return { id: row.id, username: row.username, display_name: row.display_name, role: row.role, active: row.active, updated: row.updated };
}
