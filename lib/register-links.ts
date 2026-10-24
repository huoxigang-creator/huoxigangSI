// 客户扫码自助建档：二维码登记链接的生成、校验与建档提交。
// 登记链接存于 records（kind='register_link'），扫码页免登录提交后自动创建客户档案（kind='project'，project_type='customer'）。
import { env } from './local-env';
import { execute, BusinessError } from './service';

export class RegisterLinkError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

function db() {
  if (!env.DB) throw new RegisterLinkError('数据库尚未就绪', 503);
  return env.DB;
}

type StoredRow = { id: string; owner: string; kind: string; project: string; data: string; created: string };

const LINK_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000; // 登记链接有效期一年

// 登录态：生成一条登记链接（token 绑定当前账号与渠道来源）
export async function createRegisterLink(owner: string, source: string, company: string) {
  const id = crypto.randomUUID();
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const created = new Date().toISOString();
  const data = { token, source, owner, company, created, expires_at: new Date(Date.now() + LINK_LIFETIME_MS).toISOString() };
  const res = await db().prepare('INSERT INTO records(id,owner,kind,project,data,created) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING')
    .bind(id, owner, 'register_link', '', JSON.stringify(data), created).run();
  if (Number(res.meta?.changes ?? 0) !== 1) throw new RegisterLinkError('生成失败，请重试', 503);
  return { token, path: '/s/r/' + token };
}

// 免登录：读取并校验登记链接
async function read(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new RegisterLinkError('链接无效', 404);
  const res = await db().prepare("SELECT * FROM records WHERE kind='register_link' AND json_extract(data,'$.token')=? LIMIT 1").bind(token).all<StoredRow>();
  const row = res.results?.[0];
  if (!row || JSON.parse(row.data).deleted) throw new RegisterLinkError('链接不存在或已停用', 404);
  const value = JSON.parse(row.data);
  if (Date.parse(value.expires_at) < Date.now()) throw new RegisterLinkError('链接已过期，请联系商家重新生成', 410);
  return { id: row.id, owner: row.owner, source: value.source || '', company: value.company || '', expires_at: value.expires_at };
}

// 扫码页打开时校验链接，返回商家名称与来源（供页面展示）
export async function inspectRegisterLink(token: string) {
  const link = await read(token);
  return { company: link.company, source: link.source };
}

// 免登录：提交建档（同手机号已建档则合并补充资料，不重复建档）
export async function submitRegister(token: string, input: { name: string; customer: string; phone: string; address: string; note: string }) {
  const link = await read(token);
  const customer = input.customer.trim(), phone = input.phone.replace(/\s/g, '').trim(), address = input.address.trim(), note = input.note.trim();
  if (!customer) throw new RegisterLinkError('请填写客户姓名', 400);
  if (!/^1\d{10}$/.test(phone)) throw new RegisterLinkError('请填写正确的11位手机号', 400);
  if (address.length > 200 || note.length > 2000 || customer.length > 50) throw new RegisterLinkError('填写内容过长，请精简后重试', 400);
  // 订单名称未单独填写时，由"客户姓名 · 地址"自动生成（与手工建档命名一致）
  let name = input.name.trim() || (customer + (address ? ' · ' + address : ''));
  if (name.length > 100) name = name.slice(0, 100);

  // 去重：同一账号下同手机号且未删除的终端客户视为已有档案
  const existing = await db().prepare("SELECT id,data FROM records WHERE owner=? AND kind='project' AND json_extract(data,'$.project_type')='customer' AND json_extract(data,'$.phone')=? AND COALESCE(json_extract(data,'$.deleted'),0)=0 ORDER BY created DESC LIMIT 1")
    .bind(link.owner, phone).all<StoredRow>();
  if (existing.results?.length) {
    const row = existing.results[0];
    const cur = JSON.parse(row.data);
    const next: any = { ...cur };
    if (address && !cur.address) next.address = address;
    if (note && !cur.note) next.note = note;
    if (!cur.register_source) next.register_source = link.source;
    next.registered_via = 'qr';
    next.registered_at = new Date().toISOString();
    const res = await db().prepare('UPDATE records SET data=? WHERE id=? AND owner=? AND data=?')
      .bind(JSON.stringify(next), row.id, link.owner, row.data).run();
    if (Number(res.meta?.changes ?? 0) !== 1) throw new RegisterLinkError('资料已变化，请重新提交', 409);
    return { merged: true, id: row.id, customer_no: cur.customer_no || '' };
  }

  // 新建客户档案（复用系统编号生成与权限校验）
  const created: any = await execute(link.owner, 'create_project', { project_type: 'customer', name, customer, phone, address, note });
  // 补记来源渠道（execute 的 schema 会过滤未知字段，这里单独写入）
  const snap = await db().prepare("SELECT data FROM records WHERE id=? AND owner=? AND kind='project'").bind(created.id, link.owner).all<StoredRow>();
  if (snap.results?.[0]) {
    const cur = JSON.parse(snap.results[0].data);
    const next = { ...cur, register_source: link.source || '', registered_via: 'qr', registered_at: new Date().toISOString() };
    await db().prepare('UPDATE records SET data=? WHERE id=? AND owner=? AND data=?')
      .bind(JSON.stringify(next), created.id, link.owner, snap.results[0].data).run();
  }
  return { merged: false, id: created.id, customer_no: created.customer_no || '' };
}
