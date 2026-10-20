import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { localBucket } from './local-files';

const root = resolve(process.env.GUGEMEI_DATA_DIR || join(process.cwd(), 'data'));
mkdirSync(root, { recursive: true, mode: 0o700 });
const database = new DatabaseSync(join(root, 'gugemei.sqlite'));
database.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
database.exec('CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, owner TEXT NOT NULL, kind TEXT NOT NULL, project TEXT NOT NULL, data TEXT NOT NULL, created TEXT NOT NULL)');
database.exec('CREATE INDEX IF NOT EXISTS records_owner_created ON records(owner, created DESC)');
database.exec('CREATE INDEX IF NOT EXISTS records_owner_kind_project ON records(owner, kind, project)');
database.exec('CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN (\'owner\', \'employee\')), password_hash TEXT NOT NULL, salt TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created TEXT NOT NULL, updated TEXT NOT NULL)');
// 迁移：已有库的 accounts 表补充 phone 列（短信登录/忘记密码用，可空）。
{
  const accountColumns = database.prepare('PRAGMA table_info(accounts)').all() as { name: string }[];
  if (!accountColumns.some(column => column.name === 'phone')) {
    database.exec('ALTER TABLE accounts ADD COLUMN phone TEXT');
  }
}
database.exec('CREATE TABLE IF NOT EXISTS sms_codes (id TEXT PRIMARY KEY, phone TEXT NOT NULL, purpose TEXT NOT NULL CHECK(purpose IN (\'login\', \'reset\')), code_hash TEXT NOT NULL, expires INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL)');
database.exec('CREATE INDEX IF NOT EXISTS sms_codes_phone_purpose ON sms_codes(phone, purpose)');

export const rawDatabase = database;
export const dataDirectory = root;

class BoundStatement {
  constructor(readonly sql: string, readonly values: any[] = []) {}

  bind(...values: any[]) {
    return new BoundStatement(this.sql, values);
  }

  all<T = Record<string, unknown>>() {
    const results = database.prepare(this.sql).all(...this.values) as T[];
    return Promise.resolve({ success: true, results, meta: { changes: 0 } });
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = database.prepare(this.sql).get(...this.values) as Record<string, unknown> | undefined;
    return row ? (column ? row[column] as T : row as T) : null;
  }

  run() {
    const result = database.prepare(this.sql).run(...this.values);
    return Promise.resolve({ success: true, meta: { changes: Number(result.changes) } });
  }
}

const localDatabase = {
  prepare(sql: string) {
    return new BoundStatement(sql);
  },
  async batch(statements: BoundStatement[]) {
    database.exec('BEGIN IMMEDIATE');
    try {
      const results = [];
      for (const statement of statements) {
        const sql = statement.sql.trimStart().toUpperCase();
        if (sql.startsWith('SELECT') || sql.startsWith('WITH')) {
          results.push(await statement.all());
        } else {
          results.push(await statement.run());
        }
      }
      database.exec('COMMIT');
      return results;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  },
};

export const env = {
  ...process.env,
  DB: localDatabase as unknown as D1Database,
  BUCKET: localBucket(root) as unknown as R2Bucket,
};
