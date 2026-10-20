import { env } from './local-env';
import { z } from 'zod';
import { PERMANENT_EXPIRES_AT } from './confirm-sheet-constants';

export class ConfirmSheetError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export type ConfirmItemKind = 'selection' | 'pending';
export type ConfirmItemStatus = 'pending' | 'confirmed' | 'undecided' | 'disagree';
export type ConfirmItem = { id: string; kind: ConfirmItemKind; label: string; detail: string; status: ConfirmItemStatus; note?: string };
export type ConfirmSignature = { name: string; phone: string; data_url: string; signed_at: string };
export type ConfirmAttachment = { key: string; name: string; mime: string; size: number };
export type ConfirmSheetValue = {
  token: string;
  lookup: string;
  project_id: string;
  title: string;
  customer_name: string;
  customer_phone: string;
  address: string;
  note: string;
  expires_at: string;
  revoked: boolean;
  items: ConfirmItem[];
  attachments?: ConfirmAttachment[];
  signature?: ConfirmSignature;
};

type Row = { id: string; owner: string; kind: string; project: string; data: string; created: string };
type Deps = { database: () => D1Database | undefined; now?: () => Date };

const itemKind = z.enum(['selection', 'pending']);
const itemStatus = z.enum(['pending', 'confirmed', 'undecided', 'disagree']);
const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/, '编号无效');
const clean = (value: unknown, max: number) => String(value ?? '').slice(0, max);
const hash = async (token: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))).map(value => value.toString(16).padStart(2, '0')).join('');
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32))).map(value => value.toString(16).padStart(2, '0')).join('');

const createInput = z.object({
  id: z.string().uuid().optional(),
  project_id: identifier,
  title: z.string().trim().min(1).max(100),
  customer_name: z.string().trim().max(50).default(''),
  customer_phone: z.string().trim().max(30).default(''),
  address: z.string().trim().max(200).default(''),
  note: z.string().trim().max(2000).default(''),
  items: z.array(z.object({
    kind: itemKind,
    label: z.string().trim().min(1).max(100),
    detail: z.string().trim().max(200).default(''),
  })).min(1).max(500),
  attachments: z.array(z.object({
    key: z.string().trim().min(1).max(300),
    name: z.string().trim().min(1).max(240),
    mime: z.string().trim().min(1).max(100),
    size: z.number().int().nonnegative().max(10_485_760),
  })).max(20).default([]),
});

const ACTIVE_PARENT = "EXISTS (SELECT 1 FROM records AS parent WHERE parent.id = ? AND parent.owner = ? AND parent.kind = 'project' AND COALESCE(json_extract(parent.data, '$.deleted'), 0) = 0)";

function database() {
  if (!env.DB) throw new ConfirmSheetError('数据库尚未就绪', 503);
  return env.DB;
}
function changes(result: any) {
  const n = result?.meta?.changes;
  if (!Number.isSafeInteger(n) || n < 0) throw new ConfirmSheetError('无法确认保存结果，请刷新核对', 503);
  return n;
}
function unpack(row: Row): { id: string; owner: string; project: string; created: string; value: ConfirmSheetValue } {
  return { id: row.id, owner: row.owner, project: row.project, created: row.created, value: JSON.parse(row.data) as ConfirmSheetValue };
}
async function loadOwnerRows(owner: string) {
  const result = await database().prepare("SELECT * FROM records WHERE owner = ? AND kind = 'confirm_sheet' ORDER BY created DESC").bind(owner).all<Row>();
  return result.results.map(unpack);
}

export function createConfirmSheetService(deps: Deps) {
  const now = () => deps.now?.() ?? new Date();

  async function create(owner: string, args: unknown, origin: string) {
    const input = createInput.parse(args);
    const rows = await loadOwnerRows(owner);
    if (input.id) {
      const existing = rows.find(row => row.id === input.id);
      if (existing && JSON.stringify(existing.value.items) !== JSON.stringify(input.items)) {
        throw new ConfirmSheetError('重复提交编号对应不同内容', 409);
      }
      if (existing) return display(existing, origin);
    }
    const token = randomToken();
    const id = input.id || crypto.randomUUID();
    const lookup = 'cs_' + await hash(token);
    const created = now().toISOString();
    const expiresAt = PERMANENT_EXPIRES_AT;
    const items: ConfirmItem[] = input.items.map((item, index) => ({
      id: 'i' + index,
      kind: item.kind,
      label: item.label,
      detail: item.detail,
      status: 'pending',
    }));
    const value: ConfirmSheetValue = {
      token,
      lookup,
      project_id: input.project_id,
      title: input.title,
      customer_name: input.customer_name,
      customer_phone: input.customer_phone,
      address: input.address,
      note: input.note,
      expires_at: expiresAt,
      revoked: false,
      items,
      attachments: input.attachments,
    };
    const results = await database().batch([
      database().prepare(`INSERT INTO records(id, owner, kind, project, data, created) SELECT ?, ?, 'confirm_sheet', ?, ?, ? WHERE ${ACTIVE_PARENT} AND NOT EXISTS (SELECT 1 FROM records WHERE id = ?) ON CONFLICT(id) DO NOTHING`)
        .bind(id, owner, input.project_id, JSON.stringify(value), created, input.project_id, owner, id),
      database().prepare("INSERT INTO records(id, owner, kind, project, data, created) SELECT ?, ?, 'audit', ?, ?, ? WHERE changes() > 0")
        .bind(crypto.randomUUID(), owner, input.project_id, JSON.stringify({ action: 'create_confirm_sheet', detail: '创建客户确认单', record_id: id }), created),
    ]);
    if (!changes(results[0])) throw new ConfirmSheetError('确认单编号冲突或项目无效', 409);
    const row = unpack((await database().prepare("SELECT * FROM records WHERE id = ? AND owner = ? AND kind = 'confirm_sheet'").bind(id, owner).all<Row>()).results[0]);
    return display(row, origin);
  }

  function display(row: ReturnType<typeof unpack>, origin: string) {
    const value = row.value;
    const counts: Record<string, number> = {};
    for (const item of value.items) counts[item.status] = (counts[item.status] || 0) + 1;
    const confirmed = (counts.confirmed || 0) + (counts.undecided || 0) + (counts.disagree || 0);
    return {
      id: row.id,
      project_id: value.project_id,
      title: value.title,
      customer_name: value.customer_name,
      customer_phone: value.customer_phone,
      address: value.address,
      url: origin + '/s/c/' + value.token,
      expires_at: value.expires_at,
      created: row.created,
      revoked: value.revoked === true,
      expired: Date.parse(value.expires_at) <= now().getTime(),
      item_count: value.items.length,
      confirmed_count: confirmed,
      signed: Boolean(value.signature),
      signer: value.signature ? { name: value.signature.name, phone: value.signature.phone, signed_at: value.signature.signed_at } : null,
    };
  }

  async function list(owner: string, projectId: unknown, origin: string) {
    identifier.parse(projectId);
    const rows = await loadOwnerRows(owner);
    return rows.filter(row => row.value.project_id === projectId && !row.value.revoked).map(row => display(row, origin));
  }

  async function detail(owner: string, id: unknown) {
    z.string().uuid().parse(id);    const rows = await loadOwnerRows(owner);
    const row = rows.find(candidate => candidate.id === id);
    if (!row) throw new ConfirmSheetError('确认单不存在', 404);
    return {
      id: row.id,
      project_id: row.value.project_id,
      title: row.value.title,
      customer_name: row.value.customer_name,
      customer_phone: row.value.customer_phone,
      address: row.value.address,
      note: row.value.note,
      expires_at: row.value.expires_at,
      created: row.created,
      revoked: row.value.revoked === true,
      items: row.value.items,
      signature: row.value.signature || null,
      attachments: row.value.attachments || [],
    };
  }

  async function revoke(owner: string, id: unknown) {
    z.string().uuid().parse(id);
    const rows = await loadOwnerRows(owner);
    const row = rows.find(candidate => candidate.id === id);
    if (!row) throw new ConfirmSheetError('确认单不存在', 404);
    if (row.value.revoked) return { id, revoked: true };
    const updated = { ...row.value, revoked: true, revoked_at: now().toISOString() };
    const results = await database().batch([
      database().prepare("UPDATE records SET data = ? WHERE id = ? AND owner = ? AND kind = 'confirm_sheet' AND data = ?").bind(JSON.stringify(updated), id, owner, JSON.stringify(row.value)),
      database().prepare("INSERT INTO records(id, owner, kind, project, data, created) SELECT ?, ?, 'audit', ?, ?, ? WHERE changes() > 0")
        .bind(crypto.randomUUID(), owner, row.project, JSON.stringify({ action: 'revoke_confirm_sheet', detail: '停用客户确认单链接', record_id: id }), now().toISOString()),
    ]);
    if (!changes(results[0])) throw new ConfirmSheetError('确认单状态已变化，请刷新核对', 409);
    return { id, revoked: true };
  }

  async function read(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new ConfirmSheetError('确认单链接不存在或已失效', 404);
    const lookup = 'cs_' + await hash(token);
    const result = await database().prepare("SELECT * FROM records WHERE kind = 'confirm_sheet' AND json_extract(data, '$.lookup') = ? LIMIT 1").bind(lookup).all<Row>();
    const row = result.results[0];
    if (!row) throw new ConfirmSheetError('确认单链接不存在或已失效', 404);
    const value = unpack(row).value;
    if (value.revoked || !Number.isFinite(Date.parse(value.expires_at)) || Date.parse(value.expires_at) <= now().getTime()) {
      throw new ConfirmSheetError('确认单链接已停用或已到期，请联系商家', 410);
    }
    return {
      id: row.id,
      project_id: row.project,
      title: value.title,
      customer_name: value.customer_name,
      address: value.address,
      note: value.note,
      expires_at: value.expires_at,
      submitted: Boolean(value.signature),
      signature: value.signature || null,
      items: value.items.map(item => ({ id: item.id, kind: item.kind, label: item.label, detail: item.detail, status: item.status, note: item.note || '' })),
      attachments: value.attachments || [],
    };
  }

  const submitInput = z.object({
    token: z.string().regex(/^[a-f0-9]{64}$/),
    name: z.string().trim().max(50).default(''),
    phone: z.string().trim().max(30).default(''),
    signature_data_url: z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, '签名内容无效'),
    items: z.array(z.object({ id: z.string().min(1).max(10), status: itemStatus, note: z.string().trim().max(200).default('') })).min(1).max(50),
  });

  async function submit(token: string, args: unknown) {
    const input = submitInput.parse(args);
    if (input.signature_data_url.length > 400_000) throw new ConfirmSheetError('签名图片过大，请重新签名', 400);
    const lookup = 'cs_' + await hash(token);
    const result = await database().prepare("SELECT * FROM records WHERE kind = 'confirm_sheet' AND json_extract(data, '$.lookup') = ? LIMIT 1").bind(lookup).all<Row>();
    const row = result.results[0];
    if (!row) throw new ConfirmSheetError('确认单链接不存在或已失效', 404);
    const { value } = unpack(row);
    if (value.revoked || !Number.isFinite(Date.parse(value.expires_at)) || Date.parse(value.expires_at) <= now().getTime()) {
      throw new ConfirmSheetError('确认单链接已停用或已到期，请联系商家', 410);
    }
    if (value.signature) throw new ConfirmSheetError('该确认单已提交，不能重复签字', 409);
    const byId = new Map(value.items.map(item => [item.id, item]));
    for (const entry of input.items) {
      const target = byId.get(entry.id);
      if (!target) throw new ConfirmSheetError('确认内容与当前确认单不一致', 400);
      target.status = entry.status;
      target.note = entry.note;
    }
    const signature = { name: input.name || '客户', phone: input.phone || '', data_url: input.signature_data_url, signed_at: now().toISOString() };
    const updated: ConfirmSheetValue = {
      ...value,
      items: value.items,
      signature,
    };
    const results = await database().batch([
      database().prepare("UPDATE records SET data = ? WHERE id = ? AND kind = 'confirm_sheet' AND data = ?").bind(JSON.stringify(updated), row.id, row.data),
      database().prepare("INSERT INTO records(id, owner, kind, project, data, created) SELECT ?, ?, 'audit', ?, ?, ? WHERE changes() > 0")
        .bind(crypto.randomUUID(), row.owner, row.project, JSON.stringify({ action: 'submit_confirm_sheet', detail: '客户确认单已签字提交', record_id: row.id }), now().toISOString()),
    ]);
    if (!changes(results[0])) throw new ConfirmSheetError('确认单状态已变化，请刷新后重试', 409);
    return { ok: true, submitted_at: signature.signed_at };
  }

  return { create, list, detail, revoke, read, submit };
}

export const confirmSheetService = createConfirmSheetService({ database: () => env.DB });
