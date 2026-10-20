import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';

type Metadata = {
  key: string;
  size: number;
  etag: string;
  uploaded: Date;
  httpMetadata: Record<string, string>;
  customMetadata: Record<string, string>;
};

function safePath(root: string, key: string): string {
  if (!key || key.includes('\\') || key.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Invalid object key');
  }
  const result = resolve(root, ...key.split('/'));
  if (!result.startsWith(root + sep)) throw new Error('Invalid object key');
  return result;
}

async function bytesOf(body: ArrayBuffer | Uint8Array | ReadableStream | Blob): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  const chunks: Uint8Array[] = [];
  const reader = body.getReader();
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    chunks.push(typeof part.value === 'string' ? new TextEncoder().encode(part.value) : part.value);
  }
  const result = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

async function walk(directory: string, base: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const keys: string[] = [];
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) keys.push(...await walk(absolute, base));
      else if (entry.isFile() && !entry.name.endsWith('.metadata.json')) {
        keys.push(absolute.slice(base.length + 1).split(sep).join('/'));
      }
    }
    return keys;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export function localBucket(dataRoot: string) {
  const root = resolve(dataRoot, 'files');
  const metadataPath = (key: string) => safePath(root, key) + '.metadata.json';
  async function head(key: string): Promise<Metadata | null> {
    try {
      const value = JSON.parse(await readFile(metadataPath(key), 'utf8')) as Metadata;
      const file = safePath(root, key);
      const fileStat = await stat(file);
      return { ...value, size: fileStat.size, uploaded: new Date(value.uploaded) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  return {
    head,
    async get(key: string) {
      const object = await head(key);
      if (!object) return null;
      const file = safePath(root, key);
      return {
        ...object,
        body: Readable.toWeb(createReadStream(file)) as ReadableStream,
        async arrayBuffer() { const bytes = await readFile(file); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
      };
    },
    async put(key: string, body: ArrayBuffer | Uint8Array | ReadableStream | Blob, options: any = {}) {
      const file = safePath(root, key);
      const conditional = options.onlyIf instanceof Headers
        ? options.onlyIf.get('If-None-Match') === '*'
        : options.onlyIf?.etagDoesNotMatch === '*';
      if (conditional && await head(key)) return null;
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      const bytes = await bytesOf(body);
      const object: Metadata = {
        key, size: bytes.byteLength,
        etag: createHash('md5').update(bytes).digest('hex'),
        uploaded: new Date(),
        httpMetadata: options.httpMetadata || {},
        customMetadata: options.customMetadata || {},
      };
      const temp = file + '.' + randomUUID() + '.tmp';
      await writeFile(temp, bytes, { mode: 0o600 });
      try {
        if (conditional) {
          // Exclusive link prevents two concurrent conditional writes from both succeeding.
          const { link } = await import('node:fs/promises');
          try { await link(temp, file); } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'EEXIST') return null;
            throw error;
          }
        } else {
          const { rename } = await import('node:fs/promises');
          await rename(temp, file);
        }
        await writeFile(metadataPath(key), JSON.stringify(object), { mode: 0o600 });
        return object;
      } finally {
        await rm(temp, { force: true });
      }
    },
    async delete(key: string) {
      await rm(safePath(root, key), { force: true });
      await rm(metadataPath(key), { force: true });
    },
    async list(options: { prefix?: string; cursor?: string; limit?: number } = {}) {
      const prefix = options.prefix || '';
      const allKeys = (await walk(root, root)).filter(key => key.startsWith(prefix)).sort();
      let after = '';
      if (options.cursor) {
        try { after = Buffer.from(options.cursor, 'base64url').toString('utf8'); } catch { after = ''; }
      }
      const matching = after ? allKeys.filter(key => key > after) : allKeys;
      const limit = Math.min(Math.max(options.limit || 1000, 1), 1000);
      const keys = matching.slice(0, limit);
      const objects = (await Promise.all(keys.map(head))).filter((item): item is Metadata => Boolean(item));
      const truncated = matching.length > keys.length;
      return { objects, truncated, cursor: truncated ? Buffer.from(keys.at(-1) || '', 'utf8').toString('base64url') : undefined };
    },
  };
}
