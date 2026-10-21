import {env} from './local-env';
import {z} from 'zod';
import {DEFAULT_COMPANY_NAME, catalogPriceCents, purchaseQuantity, purchaseItemAmount, purchaseTotal, materialExpenseCategory} from './catalog-types';
import type {CatalogData, CompanyProfile, MaterialRecord, PurchaseOrderRecord, PurchaseItem} from './catalog-types';
import type {PurchaseQuantityBasis} from './catalog-types';
import {QUOTE_CATEGORIES, groupQuotes, quoteGroupKey} from './quotes';

type Row = {id: string; owner: string; kind: string; project: string; data: string; created: string};
type RecordValue = Row & {value: Record<string, any>};
type Dependencies = {database: () => D1Database | undefined};
export class CatalogError extends Error {constructor(message: string, public status = 400) {super(message);}}
const text = (limit: number) => z.string().trim().max(limit, '文字长度不能超过' + limit + '个字符').default('');
const price = z.number().finite().min(0, '单价不能为负数').max(100000000, '单价不能超过100,000,000元').default(0);
const revision = z.string().uuid('修订编号不正确').optional();
const recordId = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/, '记录编号不合法');
const purchaseGroupId = z.union([z.string().uuid(), z.literal('legacy')]).transform(value => value.toLowerCase());
export const materialSchema = z.object({
  id: z.string().min(1).optional(), revision, name: z.string().trim().min(1, '请填写材料名称').max(100),
  attribute: z.enum(['主材', '辅材', '人工']).default('主材'), expense_category: z.enum(QUOTE_CATEGORIES).optional(), category: text(100), code: text(100), brand: text(100), style: text(100), model: text(100),
  unit: z.string().trim().min(1, '请填写单位').max(30).default('个'), origin: text(100), package_name: text(100),
  areas: z.array(z.string().trim().min(1).max(100)).max(100).default([]), purchase_price: price, sale_price: price, market_price: price, internal_price: price, contract_price: price,
  loss_rate: z.number().finite().min(0).max(100).default(0), conversion_factor: z.number().finite().positive().max(1000000).default(1),
  special_code: text(100), other_code: text(100), note: text(2000), warehouse_enabled: z.boolean().default(false), warehouse: text(100),
});
const purchaseItemSchema = z.object({
  expense_category:z.enum(['材料费用','五金费用']).optional(),
  material_id: text(128), name: z.string().trim().min(1, '请填写采购名称').max(100), brand: text(100), model: text(100), code: text(100),
  attribute: z.enum(['主材', '辅材', '人工']).default('主材'), unit: z.string().trim().min(1, '请填写采购单位').max(30),
  quantity: z.number().finite().positive().max(1000000).transform(value=>Number(value.toFixed(2))).refine(value => {try {purchaseQuantity(value); return true;} catch {return false;}}, '数量最多2位小数'), price,
  batch: text(100),
});
const orderSchema = z.object({
  id: z.string().min(1).optional(), revision, project_id: recordId, source_quote_id: recordId.optional(),
  number: text(100), supplier: text(200), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式不正确').refine(value => {const date = new Date(value + 'T00:00:00Z'); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;}, '日期不合法'),
  note: text(2000), items: z.array(purchaseItemSchema).min(1, '至少填写一项采购明细').max(200, '采购明细最多200项'),
});
const quantityBasisSchema = z.object({project_id: recordId, source_quote_id: recordId.optional(), subproject_id: purchaseGroupId.optional()}).refine(value => !!(value.source_quote_id || value.subproject_id), '请指定报价或小项目编号');
const ACTIVE = "COALESCE(json_extract(data, '$.deleted'), 0) = 0";
const PARENT = "EXISTS (SELECT 1 FROM records AS parent WHERE parent.id = ? AND parent.owner = ? AND parent.kind = 'project' AND COALESCE(json_extract(parent.data, '$.deleted'), 0) = 0)";
function display(row: RecordValue) {return {...row.value, id: row.id, kind: row.kind, project: row.project, created: row.created};}
function active(row: RecordValue) {return row.value.deleted !== true;}
function changed(result: any) {const number = Number(result?.meta?.changes ?? result?.changes); if (!Number.isSafeInteger(number) || number < 0) throw new CatalogError('无法确认保存结果，请刷新后核对', 503); return number;}
function sameItem(a: PurchaseItem, b: PurchaseItem) {return (a.expense_category||'材料费用')===(b.expense_category||'材料费用')&& ['material_id', 'name', 'brand', 'model', 'code', 'attribute', 'unit', 'quantity', 'price', 'batch', 'amount'].every(key => a[key as keyof PurchaseItem] === b[key as keyof PurchaseItem]);}
function sameInput(row: RecordValue, data: Record<string, any>) {return Object.keys(data).every(key => JSON.stringify(row.value[key]) === JSON.stringify(data[key]));}

export function createCatalogService(deps: Dependencies) {
  function database() {const db = deps.database(); if (!db) throw new CatalogError('数据库尚未就绪', 503); return db;}
  async function load(owner: string): Promise<RecordValue[]> {
    if (!owner) throw new CatalogError('请先登录', 401);
    const rows = await database().prepare('SELECT * FROM records WHERE owner = ? ORDER BY created DESC').bind(owner).all<Row>();
    return rows.results.map(row => ({...row, value: JSON.parse(row.data)}));
  }
  function get(all: RecordValue[], id: string | undefined, kind: string) {
    const row = all.find(value => value.id === id && value.kind === kind && active(value));
    if (!row) throw new CatalogError('记录不存在、已删除或无权访问', 404); return row;
  }
  function verifyRevision(row: RecordValue, supplied: string | undefined) {
    if (row.value.revision && row.value.revision !== supplied) throw new CatalogError('资料已被修改，请刷新后重新编辑', 409);
  }
  function duplicateMaterial(all: RecordValue[], code: string, except: string) {return code && all.some(row => row.kind === 'material' && row.id !== except && active(row) && row.value.code === code);}
  function duplicateOrder(all: RecordValue[], number: string, project: string, except: string) {return number && all.some(row => row.kind === 'purchase_order' && row.project === project && row.id !== except && active(row) && row.value.number === number);}
  function projectQuotes(all: RecordValue[], project: string) {return all.filter(row => row.kind === 'quote' && row.project === project).map(display);}
  async function execute(owner: string, action: string, args: any = {}) {
    const all = await load(owner);
    if (action === 'get_catalog') {
      const projects = new Set(all.filter(row => row.kind === 'project' && active(row)).map(row => row.id));
      const company = all.find(row => row.kind === 'company_profile' && active(row));
      return {company: company ? display(company) as CompanyProfile : {name: DEFAULT_COMPANY_NAME}, materials: all.filter(row => row.kind === 'material' && active(row)).map(display) as MaterialRecord[], purchase_orders: all.filter(row => row.kind === 'purchase_order' && active(row) && projects.has(row.project)).map(display) as PurchaseOrderRecord[]} satisfies CatalogData;
    }
    if (action === 'get_purchase_quantity_basis') {
      const input = quantityBasisSchema.parse(args); get(all, input.project_id, 'project');
      // A deleted quotation can identify a historical group, but can never authorize a new link.
      const source = input.source_quote_id ? all.find(row => row.id === input.source_quote_id && row.kind === 'quote' && row.project === input.project_id) : undefined;
      if (input.source_quote_id && !source) throw new CatalogError('报价不存在或不属于此项目', 404);
      const groupId = source ? quoteGroupKey(display(source)) : input.subproject_id!;
      if (input.subproject_id && input.subproject_id !== groupId) throw new CatalogError('报价与小项目编号不一致');
      const quotes = projectQuotes(all, input.project_id), group = groupQuotes(quotes).find(value => value.id === groupId);
      const projectOrders = all.filter(row => row.kind === 'purchase_order' && row.project === input.project_id && active(row));
      const orders = projectOrders.filter(row => !!row.value.source_quote_id && row.value.subproject_id === groupId);
      if (!source && !quotes.some(quote => quoteGroupKey(quote) === groupId) && !orders.length) throw new CatalogError('小项目不存在或无权访问', 404);
      return {
        project_id: input.project_id, subproject_id: groupId,
        subproject_name: group?.name || orders.find(row => row.value.subproject_name)?.value.subproject_name || source?.value.subproject_name || source?.value.title || '未命名小项目',
        source_quote_id: input.source_quote_id || group?.adopted?.id || group?.quotes[0]?.id || orders[0]?.value.source_quote_id || '',
        order_count: orders.length, unlinked_order_count: projectOrders.filter(row => !row.value.source_quote_id || !row.value.subproject_id).length,
        rows: orders.flatMap(row => (Array.isArray(row.value.items) ? row.value.items : []).map((item: PurchaseItem, index: number) => ({purchase_order_id: row.id, purchase_order_number: row.value.number || '', date: row.value.date || '', supplier: row.value.supplier || '', item_index: index + 1, material_id: item.material_id || '', name: item.name, model: item.model || '', attribute: item.attribute || '主材', quantity: item.quantity, unit: item.unit}))),
      } satisfies PurchaseQuantityBasis;
    }
    let id: string, kind: string, project = '', data: Record<string, any>, old: RecordValue | undefined, collision: RecordValue | undefined, detail: string;
    const conditions: string[] = [], bindings: any[] = [];
    if (action === 'save_company') {
      const input = z.object({name: z.string().trim().min(1, '请填写公司名称').max(100), revision}).parse(args);
      id = 'company:' + encodeURIComponent(owner); kind = 'company_profile';
      const collision = all.find(row => row.id === id);
      if (collision && (collision.kind !== kind || !active(collision))) throw new CatalogError('公司资料已删除或编号冲突，请刷新后处理', 409);
      old = collision; if (old) verifyRevision(old, input.revision);
      data = {name: input.name}; detail = '保存公司名称';
    } else if (action === 'create_material' || action === 'update_material') {
      const input = materialSchema.parse(args); kind = 'material'; id = input.id || crypto.randomUUID();
      if (action === 'update_material') {old = get(all, input.id, kind); verifyRevision(old, input.revision);}
      else {collision = all.find(row => row.id === id); if (collision && (collision.kind !== kind || collision.project !== '' || !active(collision))) throw new CatalogError('记录编号已存在或已删除，请刷新后处理', 409);}
      if (duplicateMaterial(all, input.code, id)) throw new CatalogError('材料编码已存在，请使用不同编码', 409);
      const {id: _id, revision: _revision, ...fields} = input;
      data = {...fields, expense_category: input.expense_category || materialExpenseCategory(old?.value || collision?.value || input), areas: [...new Set(fields.areas)]};
      for (const field of ['purchase_price', 'sale_price', 'market_price', 'internal_price', 'contract_price']) data[field] = catalogPriceCents(data[field]);
      if (input.code) {conditions.push("NOT EXISTS (SELECT 1 FROM records AS duplicate WHERE duplicate.owner = ? AND duplicate.kind = 'material' AND duplicate.id <> ? AND COALESCE(json_extract(duplicate.data, '$.deleted'), 0) = 0 AND json_extract(duplicate.data, '$.code') = ?)"); bindings.push(owner, id, input.code);}
      detail = old ? '修改材料资料' : '新建材料资料';
    } else if (action === 'create_purchase_order' || action === 'update_purchase_order') {
      const input = orderSchema.parse(args); kind = 'purchase_order'; project = input.project_id; id = input.id || crypto.randomUUID();
      get(all, project, 'project');
      if (action === 'update_purchase_order') {old = get(all, input.id, kind); if (old.project !== project) throw new CatalogError('采购单不能移至其他项目'); verifyRevision(old, input.revision);}
      else {collision = all.find(row => row.id === id); if (collision && (collision.kind !== kind || collision.project !== project || !active(collision))) throw new CatalogError('记录编号已存在或已删除，请刷新后处理', 409);}
      if (duplicateOrder(all, input.number, project, id)) throw new CatalogError('此项目采购单编号已存在，请使用不同编号', 409);
      let items: PurchaseItem[];
      try {items = input.items.map(item => {const price = catalogPriceCents(item.price); return {...item, price, amount: purchaseItemAmount(item.quantity, price)};});} catch (error) {throw new CatalogError(error instanceof Error ? error.message : '采购金额不合法');}
      const guarded = new Set<string>(), matched = new Set<number>();
      const historical = old || collision;
      const previousItems: PurchaseItem[] = Array.isArray(historical?.value.items) ? historical!.value.items : [];
      let association: Record<string, string> = {};
      if (historical?.value.source_quote_id && (!input.source_quote_id || input.source_quote_id === historical.value.source_quote_id)) {
        // Preserving a historical association also preserves its name snapshot after quote edits/deletion.
        association = {source_quote_id: historical.value.source_quote_id, subproject_id: historical.value.subproject_id, subproject_name: historical.value.subproject_name};
      } else if (input.source_quote_id) {
        const source = get(all, input.source_quote_id, 'quote');
        if (source.project !== project) throw new CatalogError('报价不属于此项目', 404);
        const groupId = quoteGroupKey(display(source)), group = groupQuotes(projectQuotes(all, project)).find(value => value.id === groupId);
        if (!group) throw new CatalogError('小项目已删除，请刷新后选择', 404);
        association = {source_quote_id: source.id, subproject_id: groupId, subproject_name: group.name};
        // The selected quotation must remain owned, active, and unchanged through the write.
        conditions.push("EXISTS (SELECT 1 FROM records AS quote WHERE quote.id = ? AND quote.owner = ? AND quote.kind = 'quote' AND quote.project = ? AND quote.data = ? AND COALESCE(json_extract(quote.data, '$.deleted'), 0) = 0)");
        bindings.push(source.id, owner, project, source.data);
      }
      for (const item of items) {
        if (!item.material_id) continue;
        // An unchanged historical row remains valid after its source material is removed.
        const previousIndex = previousItems.findIndex((previous, index) => !matched.has(index) && sameItem(item, previous));
        if (previousIndex >= 0) {matched.add(previousIndex); continue;}
        const material=get(all, item.material_id, 'material');
        if(materialExpenseCategory(material.value)==='柜体')throw new CatalogError('采购单不能关联柜体报价配置，柜体报价不自动进入采购');
        if (!guarded.has(item.material_id)) {
          conditions.push("EXISTS (SELECT 1 FROM records AS material WHERE material.id = ? AND material.owner = ? AND material.kind = 'material' AND COALESCE(json_extract(material.data, '$.deleted'), 0) = 0 AND COALESCE(json_extract(material.data, '$.expense_category'), '') <> '柜体')"); bindings.push(item.material_id, owner); guarded.add(item.material_id);
        }
      }
      let total: number; try {total = purchaseTotal(items);} catch (error) {throw new CatalogError(error instanceof Error ? error.message : '采购合计不合法');}
      data = {project_id: project, ...association, number: input.number, supplier: input.supplier, date: input.date, note: input.note, items, total};
      conditions.push(PARENT); bindings.push(project, owner);
      if (input.number) {conditions.push("NOT EXISTS (SELECT 1 FROM records AS duplicate WHERE duplicate.owner = ? AND duplicate.project = ? AND duplicate.kind = 'purchase_order' AND duplicate.id <> ? AND COALESCE(json_extract(duplicate.data, '$.deleted'), 0) = 0 AND json_extract(duplicate.data, '$.number') = ?)"); bindings.push(owner, project, id, input.number);}
      detail = old ? '修改采购单' : '新建采购单';
    } else throw new CatalogError('不支持的配置或采购操作');
    if (collision) {if (sameInput(collision, data)) return {...display(collision), reused: true}; throw new CatalogError('记录编号已用于不同内容，请刷新后处理', 409);}
    const requestedData = {...data};
    const now = new Date().toISOString(); data.updated = now; data.revision = crypto.randomUUID();
    const db = database(); let mutation: D1PreparedStatement;
    if (old) {
      mutation = db.prepare('UPDATE records SET data = ? WHERE id = ? AND owner = ? AND kind = ? AND project = ? AND data = ? AND ' + ACTIVE + (conditions.length ? ' AND ' + conditions.join(' AND ') : '')).bind(JSON.stringify(data), id, owner, kind, project, old.data, ...bindings);
    } else {
      const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
      mutation = db.prepare('INSERT INTO records(id,owner,kind,project,data,created) SELECT ?,?,?,?,?,?' + where + ' ON CONFLICT(id) DO NOTHING').bind(id, owner, kind, project, JSON.stringify(data), now, ...bindings);
    }
    const audit = db.prepare('INSERT INTO records(id,owner,kind,project,data,created) SELECT ?,?,?,?,?,? WHERE changes() > 0').bind(crypto.randomUUID(), owner, 'audit', project, JSON.stringify({action, detail, record_id: id, actor: owner}), now);
    const results = await db.batch([mutation, audit]);
    if (!changed(results[0])) {
      if (action === 'create_material' || action === 'create_purchase_order') {
        const existing = (await load(owner)).find(row => row.id === id && row.kind === kind && row.project === project);
        if (existing && active(existing) && sameInput(existing, requestedData)) return {...display(existing), reused: true};
      }
      throw new CatalogError('记录、材料编码、采购单编号、关联报价或项目已发生变化，请刷新后重试', 409);
    }
    return {...data, id, kind, project, created: old?.created || now};
  }
  return {execute};
}
const catalog = createCatalogService({database: () => env.DB});
export const catalogExecute = catalog.execute;
