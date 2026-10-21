import {env} from './local-env';

type FileType = 'project' | 'payment';
type Row = {id: string; owner: string; kind: string; project: string; data: string; created: string};
type RecordValue = Omit<Row, 'data'> & {data: Record<string, any>; rawData: string};
type Dependencies = {database: () => D1Database | undefined; bucket: () => R2Bucket | undefined};
const KINDS = new Set(['project', 'quote', 'transaction', 'task', 'material', 'purchase_order','contract','contract_template','swatch']);
const PROJECT_SCOPED = new Set(['quote', 'transaction', 'task', 'purchase_order','contract']);
const CATEGORIES = new Set(['合同', '设计图', '项目资料']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Correlated guards use the target record's owner/project at the atomic write.
const CUSTOMER_SETTLEMENT="COALESCE((SELECT CASE WHEN json_extract(customer.data, '$.project_type') = 'customer' THEN COALESCE(json_extract(customer.data, '$.discount_amount'), 0) + COALESCE(json_extract(customer.data, '$.rounding_amount'), 0) ELSE 0 END FROM records AS customer WHERE customer.id = records.project AND customer.owner = records.owner AND customer.kind = 'project'), 0)";
const OTHER_ADOPTED_TOTAL="COALESCE((SELECT SUM(json_extract(other.data, '$.total')) FROM records AS other WHERE other.owner = records.owner AND other.project = records.project AND other.kind = 'quote' AND other.id <> records.id AND COALESCE(json_extract(other.data, '$.deleted'), 0) = 0 AND json_extract(other.data, '$.adopted') = 1), 0)";
const SAME_GROUP_ADOPTED="EXISTS (SELECT 1 FROM records AS other WHERE other.owner = records.owner AND other.project = records.project AND other.kind = 'quote' AND other.id <> records.id AND COALESCE(json_extract(other.data, '$.deleted'), 0) = 0 AND json_extract(other.data, '$.adopted') = 1 AND COALESCE(NULLIF(json_extract(other.data, '$.subproject_id'), ''), 'legacy') = COALESCE(NULLIF(json_extract(records.data, '$.subproject_id'), ''), 'legacy'))";

export class TrashError extends Error {
  constructor(message: string, public status = 400) {super(message);}
}
function identifier(value: unknown) {
  if (typeof value !== 'string' || !value || value.length > 1024 || /[\x00-\x1f\x7f]/.test(value)) throw new TrashError('记录编号无效');
  return value;
}
function projectIdentifier(value: unknown) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new TrashError('项目编号无效');
  return value;
}
function fileTypeFrom(value: unknown): FileType {
  if (value !== 'project' && value !== 'payment') throw new TrashError('文件分类无效');
  return value;
}
function deleted(record: RecordValue) {return record.data.deleted === true;}
function description(record: RecordValue) {
  return String(record.data.name || record.data.title || (record.kind === 'purchase_order' ? '采购单 ' + record.data.number : record.kind === 'transaction' ? record.data.type + ' · ' + record.data.category : '记录'));
}
function projectFor(all: RecordValue[], project: string, active = true) {
  const parent = all.find(row => row.id === project && row.kind === 'project');
  if (!parent || (active && deleted(parent))) throw new TrashError('项目不存在、已删除或无权访问', 404);
  return parent;
}
function paymentFor(all: RecordValue[], project: string, transaction: string) {
  const payment = all.find(row => row.id === transaction && row.project === project && row.kind === 'transaction' && row.data.type === '付款');
  if (!payment || deleted(payment)) throw new TrashError('付款记录不存在、已删除或无权访问', 404);
  // Voiding keeps historical invoices valid. It never authorizes adding a payment.
  return payment;
}
function activeFileProject(all: RecordValue[], project: string) {
  const value = projectFor(all, project);
  if (value.data.parent_id) projectFor(all, projectIdentifier(value.data.parent_id));
  return value;
}
/** R2 objects stay at the first project; only the current payment authorizes access. */
function voucherProject(all: RecordValue[], payment: RecordValue) {
  const origin = projectIdentifier(payment.data.voucher_project_id || payment.project);
  const current = activeFileProject(all, payment.project), original = projectFor(all, origin, false);
  if ((current.data.parent_id || current.id) !== (original.data.parent_id || original.id)) throw new TrashError('付款单据来源不属于当前合作项目', 403);
  return origin;
}
const ACTIVE_FILE_PROJECT = "EXISTS (SELECT 1 FROM records AS parent WHERE parent.id = ? AND parent.owner = ? AND parent.kind = 'project' AND COALESCE(json_extract(parent.data, '$.deleted'), 0) = 0 AND (COALESCE(json_extract(parent.data, '$.parent_id'), '') = '' OR EXISTS (SELECT 1 FROM records AS root WHERE root.id = json_extract(parent.data, '$.parent_id') AND root.owner = parent.owner AND root.kind = 'project' AND COALESCE(json_extract(root.data, '$.deleted'), 0) = 0)))";
const PAYMENT_FILE_SCOPE = "EXISTS (SELECT 1 FROM records AS payment WHERE payment.id = ? AND payment.owner = ? AND payment.project = ? AND payment.kind = 'transaction' AND json_extract(payment.data, '$.type') = '付款' AND COALESCE(json_extract(payment.data, '$.deleted'), 0) = 0 AND COALESCE(NULLIF(json_extract(payment.data, '$.voucher_project_id'), ''), payment.project) = ? AND payment.data = ?)";
function filePrefix(owner: string, project: string, fileType: FileType, transaction?: string) {
  const base = encodeURIComponent(owner) + '/' + encodeURIComponent(project) + '/';
  return fileType === 'project' ? base + 'files/' : base + 'payment-vouchers/' + encodeURIComponent(transaction!) + '/';
}
function validFileKey(owner: string, project: string, fileType: FileType, transaction: string | undefined, value: unknown) {
  const key = identifier(value), prefix = filePrefix(owner, project, fileType, transaction);
  if (!key.startsWith(prefix) || !UUID.test(key.slice(prefix.length))) throw new TrashError('无权操作此文件', 403);
  return key;
}
function validMetadata(object: R2Object, project: string, fileType: FileType, transaction?: string) {
  const metadata = object.customMetadata || {};
  if (fileType === 'project' ? !CATEGORIES.has(metadata.category) : metadata.project_id !== project || metadata.transaction_id !== transaction) {
    throw new TrashError('文件归属校验失败', 403);
  }
}
function rowResult(row: RecordValue) {return {...row.data, id: row.id, kind: row.kind, project: row.project, created: row.created};}

export function createTrashService(deps: Dependencies) {
  function database() {
    const database = deps.database();
    if (!database) throw new TrashError('数据库尚未就绪', 503);
    return database;
  }
  async function load(owner: string): Promise<RecordValue[]> {
    if (!owner) throw new TrashError('请先登录', 401);
    const result = await database().prepare('SELECT * FROM records WHERE owner = ? ORDER BY created DESC').bind(owner).all<Row>();
    return result.results.map(row => {
      let data: Record<string, any>;
      try {data = JSON.parse(row.data);} catch {throw new TrashError('记录读取失败，请稍后重试', 500);}
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new TrashError('记录读取失败，请稍后重试', 500);
      return {...row, data, rawData: row.data};
    });
  }
  async function commit(owner: string, row: {id: string; project: string}, action: string, mutation: D1PreparedStatement) {
    const now = new Date().toISOString();
    // SQLite changes() refers to the preceding guarded mutation in this atomic batch.
    // A failed compare-and-set never creates a misleading audit entry.
    const audit = database().prepare('INSERT INTO records(id,owner,kind,project,data,created) SELECT ?,?,?,?,?,? WHERE changes() > 0').bind(
      crypto.randomUUID(), owner, 'audit', row.project,
      JSON.stringify({action, detail: action.startsWith('delete') ? '移至回收站（可恢复）' : '从回收站恢复', record_id: row.id, actor: owner}), now,
    );
    const results = await database().batch([mutation, audit]);
    if (!results[0].meta.changes) throw new TrashError('记录在操作期间已变化，请刷新后重试', 409);
  }
  async function list(owner: string) {
    const all = await load(owner), records: any[] = [], files: any[] = [];
    for (const row of all) {
      if (!deleted(row)) continue;
      const parent = all.find(value => value.kind === 'project' && value.id === row.project);
      if (KINDS.has(row.kind)) records.push({...rowResult(row), name: description(row), parentName: (PROJECT_SCOPED.has(row.kind)&&!!row.project) ? parent?.data.name || '' : '', parentDeleted: (PROJECT_SCOPED.has(row.kind)&&!!row.project) && (!parent || deleted(parent))});
      if (row.kind === 'file_trash') {
        const transaction = row.data.transaction_id;
        const payment = transaction ? all.find(value => value.id === transaction && value.kind === 'transaction' && value.data.type === '付款' && (value.data.voucher_project_id || value.project) === row.project) : undefined;
        const currentProject = payment?.project || row.project, currentParent = all.find(value => value.kind === 'project' && value.id === currentProject), rootParent = currentParent?.data.parent_id ? all.find(value => value.kind === 'project' && value.id === currentParent.data.parent_id) : undefined;
        files.push({...row.data, id: row.id, project_id: currentProject, ...(transaction ? {voucher_project_id: row.project} : {}), parentName: currentParent?.data.name || '', parentDeleted: !currentParent || deleted(currentParent) || Boolean(currentParent.data.parent_id && (!rootParent || deleted(rootParent))), paymentDeleted: Boolean(transaction && (!payment || deleted(payment)))});
      }
    }
    records.sort((a, b) => String(b.deleted_at).localeCompare(String(a.deleted_at)));
    files.sort((a, b) => String(b.deleted_at).localeCompare(String(a.deleted_at)));
    return {ok: true, records, files};
  }
  async function recordChange(owner: string, action: 'delete_record' | 'restore_record', args: any) {
    const id = identifier(args.id), all = await load(owner);
    const row = all.find(value => value.id === id);
    if (!row) throw new TrashError('记录不存在或无权访问', 404);
    if (!KINDS.has(row.kind)) throw new TrashError('此记录不能删除或恢复', 403);
    const restore = action === 'restore_record';
    if(!restore&&row.kind==='contract'&&(row.data.status!=='draft'&&!(row.data.status==='failed'&&!row.data.signature?.flow_id)))throw new TrashError('签署中或已签合同不能删除',409);
    if(!restore&&row.kind==='project'&&all.some(value=>value.kind==='contract'&&value.project===row.id&&!deleted(value)&&['preparing','signing','uncertain'].includes(value.data.status)))throw new TrashError('此项目还有正在签署或结果待核对的合同，请先核对签署状态',409);
    if(!restore&&row.kind==='transaction'&&(row.data.payment_provider||row.data.wechat_transaction_id||row.data.payment_order_id))throw new TrashError('微信商户自动登记的收款对应真实到账，不能删除；如需退款请在微信商户平台办理',409);
    if (restore && (PROJECT_SCOPED.has(row.kind)&&!!row.project)) projectFor(all, row.project);
    if(restore&&row.kind==='project'&&row.data.parent_id)projectFor(all,row.data.parent_id);
    if(!restore&&row.kind==='project'&&all.some(child=>child.kind==='project'&&!deleted(child)&&child.data.parent_id===row.id))throw new TrashError('此合作项目还有独立项目，请先分别处理下属项目后再删除',409);
    if (deleted(row) !== restore) return {ok: true, reused: true, record: rowResult(row)};
    if(!restore&&row.kind==='quote'&&row.data.adopted){const parent=all.find(value=>value.kind==='project'&&value.id===row.project),discount=parent?.data.project_type==='customer'?(parent.data.discount_amount||0)+(parent.data.rounding_amount||0):0,remainingContract=all.filter(other=>other.kind==='quote'&&other.project===row.project&&other.id!==row.id&&!deleted(other)&&other.data.adopted).reduce((sum,other)=>sum+(other.data.total||0),0);if(discount>remainingContract)throw new TrashError('此客户还有优惠或抹零，请先调整或清零折让后再删除采纳报价',409);}
    if (restore && row.kind === 'material' && row.data.code && all.some(other => other.kind === 'material' && other.id !== row.id && !deleted(other) && other.data.code === row.data.code)) throw new TrashError('材料编码已被使用，请先在配置中修改当前材料的编码后再恢复', 409);
    if (restore && row.kind === 'purchase_order' && row.data.number && all.some(other => other.kind === 'purchase_order' && other.project === row.project && other.id !== row.id && !deleted(other) && other.data.number === row.data.number)) throw new TrashError('此采购单编号已被使用，请先修改当前采购单编号后再恢复', 409);
    if (restore && row.kind === 'contract' && row.data.number && all.some(other => other.kind === 'contract' && other.id !== row.id && !deleted(other) && other.data.number === row.data.number)) throw new TrashError('此合同编号已被使用，请先修改当前合同编号后再恢复', 409);
    const restoredReceipts = new Map<string, number>();
    if (restore && row.kind === 'contract') {
      for (const part of row.data.receipt_allocations || []) restoredReceipts.set(part.transaction_id, (restoredReceipts.get(part.transaction_id) || 0) + part.amount);
      for (const [transaction, amount] of restoredReceipts) {
        const receipt = all.find(value => value.id === transaction && value.kind === 'transaction' && value.project === row.project && !deleted(value) && !value.data.void && value.data.type === '收款');
        if (!receipt) continue;
        const used = all.filter(other => other.kind === 'contract' && other.project === row.project && other.id !== row.id && !deleted(other)).flatMap(other => other.data.receipt_allocations || []).filter(part => part.transaction_id === transaction).reduce((sum, part) => sum + part.amount, 0);
        if (used + amount > receipt.data.amount) throw new TrashError('原合同关联的收款已用于其他合同，请先解除其他合同的收款关联后再恢复', 409);
      }
    }
    const now = new Date().toISOString();
    let expression: string, bindings: any[];
    if (!restore) {
      expression = "json_set(data, '$.deleted', json('true'), '$.deleted_at', ?, '$.deleted_by', ?)";
      bindings = [now, owner];
    } else {
      expression = "json_set(data, '$.deleted', json('false'), '$.restored_at', ?, '$.restored_by', ?)";
      bindings = [now, owner];
      if (row.kind === 'quote') {
        // Test same-group competition and aggregate cents inside UPDATE so a
        // restore cannot create two winners or exceed exact-integer accounting.
        expression = `json_set(${expression}, '$.adopted', json(CASE WHEN EXISTS (SELECT 1 FROM records AS other WHERE other.owner = ? AND other.project = ? AND other.kind = 'quote' AND other.id <> ? AND COALESCE(NULLIF(json_extract(other.data, '$.subproject_id'), ''), 'legacy') = COALESCE(NULLIF(json_extract(records.data, '$.subproject_id'), ''), 'legacy') AND COALESCE(json_extract(other.data, '$.deleted'), 0) = 0 AND json_extract(other.data, '$.adopted') = 1) OR (COALESCE(json_extract(records.data, '$.total'), 0) + COALESCE((SELECT SUM(json_extract(other.data, '$.total')) FROM records AS other WHERE other.owner = ? AND other.project = ? AND other.kind = 'quote' AND COALESCE(json_extract(other.data, '$.deleted'), 0) = 0 AND json_extract(other.data, '$.adopted') = 1 AND COALESCE(NULLIF(json_extract(other.data, '$.subproject_id'), ''), 'legacy') <> COALESCE(NULLIF(json_extract(records.data, '$.subproject_id'), ''), 'legacy')), 0)) NOT BETWEEN 0 AND 9007199254740991 THEN 'false' ELSE CASE WHEN json_extract(data, '$.adopted') = 1 THEN 'true' ELSE 'false' END END))`;
        bindings.push(owner, row.project, row.id, owner, row.project);
      }
    }
    if(row.kind==='contract'||row.kind==='contract_template'){expression=`json_set(${expression}, '$.revision', ?)`;bindings.push(crypto.randomUUID());}
    let sql = `UPDATE records SET data = ${expression} WHERE id = ? AND owner = ? AND kind = ? AND data = ?`;
    bindings.push(row.id, owner, row.kind, row.rawData);
    if (restore && row.kind === 'contract') {
      sql += " AND NOT EXISTS (SELECT 1 FROM records AS other WHERE other.owner=records.owner AND other.kind='contract' AND other.id<>records.id AND COALESCE(json_extract(other.data,'$.deleted'),0)=0 AND json_extract(other.data,'$.number')=json_extract(records.data,'$.number'))";
      // A restored allocation may count again. Check receipt capacity in the
      // same transaction as the restore, including concurrent allocations.
      for (const [transaction, amount] of restoredReceipts) {
        sql += " AND NOT EXISTS (SELECT 1 FROM records AS receipt WHERE receipt.id=? AND receipt.owner=records.owner AND receipt.project=records.project AND receipt.kind='transaction' AND COALESCE(json_extract(receipt.data,'$.deleted'),0)=0 AND COALESCE(json_extract(receipt.data,'$.void'),0)=0 AND json_extract(receipt.data,'$.type')='收款' AND (? + COALESCE((SELECT SUM(json_extract(part.value,'$.amount')) FROM records AS c, json_each(c.data,'$.receipt_allocations') AS part WHERE c.owner=receipt.owner AND c.project=receipt.project AND c.kind='contract' AND c.id<>records.id AND COALESCE(json_extract(c.data,'$.deleted'),0)=0 AND json_extract(part.value,'$.transaction_id')=receipt.id),0)) > json_extract(receipt.data,'$.amount'))";
        bindings.push(transaction, amount);
      }
    }
    if(!restore&&row.kind==='contract')sql+=" AND (json_extract(data,'$.status')='draft' OR (json_extract(data,'$.status')='failed' AND COALESCE(json_extract(data,'$.signature.flow_id'),'')=''))";
    if(!restore&&row.kind==='project'){sql+=" AND NOT EXISTS (SELECT 1 FROM records AS signing WHERE signing.owner=? AND signing.project=? AND signing.kind='contract' AND COALESCE(json_extract(signing.data,'$.deleted'),0)=0 AND json_extract(signing.data,'$.status') IN ('preparing','signing','uncertain'))";bindings.push(owner,row.id);}
    if (restore && (PROJECT_SCOPED.has(row.kind)&&!!row.project)) {
      sql += " AND EXISTS (SELECT 1 FROM records AS parent WHERE parent.id = ? AND parent.owner = ? AND parent.kind = 'project' AND COALESCE(json_extract(parent.data, '$.deleted'), 0) = 0)";
      bindings.push(row.project, owner);
    }
    if(row.kind==='quote'){
      if(!restore)sql+=' AND (COALESCE(json_extract(records.data, \'$.adopted\'), 0) <> 1 OR '+CUSTOMER_SETTLEMENT+' <= '+OTHER_ADOPTED_TOTAL+')';
      // Restoring a former winner can return it as a draft. Only count its
      // total when the existing restore expression will keep it adopted.
      else sql+=' AND ('+CUSTOMER_SETTLEMENT+' <= '+OTHER_ADOPTED_TOTAL+" OR (json_extract(records.data, '$.adopted') = 1 AND NOT "+SAME_GROUP_ADOPTED+' AND ('+OTHER_ADOPTED_TOTAL+" + COALESCE(json_extract(records.data, '$.total'), 0)) BETWEEN "+CUSTOMER_SETTLEMENT+' AND 9007199254740991))';
    }
    if(restore&&row.kind==='project')sql+=" AND (COALESCE(json_extract(records.data, '$.project_type'), 'project') <> 'customer' OR COALESCE(json_extract(records.data, '$.discount_amount'), 0) + COALESCE(json_extract(records.data, '$.rounding_amount'), 0) <= COALESCE((SELECT SUM(json_extract(adopted.data, '$.total')) FROM records AS adopted WHERE adopted.owner = records.owner AND adopted.project = records.id AND adopted.kind = 'quote' AND COALESCE(json_extract(adopted.data, '$.deleted'), 0) = 0 AND json_extract(adopted.data, '$.adopted') = 1), 0))";
    if(!restore&&row.kind==='project'){sql+=" AND NOT EXISTS (SELECT 1 FROM records AS child WHERE child.owner = ? AND child.kind = 'project' AND json_extract(child.data, '$.parent_id') = ? AND COALESCE(json_extract(child.data, '$.deleted'), 0) = 0)";bindings.push(owner,row.id);}
    if(restore&&row.kind==='project'&&row.data.parent_id){sql+=" AND EXISTS (SELECT 1 FROM records AS root WHERE root.id = ? AND root.owner = ? AND root.kind = 'project' AND COALESCE(json_extract(root.data, '$.deleted'), 0) = 0)";bindings.push(row.data.parent_id,owner);}
    if (restore && row.kind === 'material' && row.data.code) {
      // A deleted code can be reused, but restoring must not create duplicates.
      sql += " AND NOT EXISTS (SELECT 1 FROM records AS other WHERE other.owner = ? AND other.kind = 'material' AND other.id <> ? AND COALESCE(json_extract(other.data, '$.deleted'), 0) = 0 AND json_extract(other.data, '$.code') = ?)";
      bindings.push(owner, row.id, row.data.code);
    }
    if (restore && row.kind === 'purchase_order' && row.data.number) {
      sql += " AND NOT EXISTS (SELECT 1 FROM records AS other WHERE other.owner = ? AND other.project = ? AND other.kind = 'purchase_order' AND other.id <> ? AND COALESCE(json_extract(other.data, '$.deleted'), 0) = 0 AND json_extract(other.data, '$.number') = ?)";
      bindings.push(owner, row.project, row.id, row.data.number);
    }
    await commit(owner, row, action, database().prepare(sql).bind(...bindings));
    const saved = (await load(owner)).find(value => value.id === id)!;
    return {ok: true, reused: false, record: rowResult(saved), restoredAsDraft: restore && row.kind === 'quote' && row.data.adopted === true && saved.data.adopted !== true};
  }
  async function validateFile(owner: string, all: RecordValue[], data: any) {
    const project = projectIdentifier(data.project_id), fileType = fileTypeFrom(data.file_type);
    const transaction = fileType === 'payment' ? identifier(data.transaction_id) : undefined;
    activeFileProject(all, project);
    const payment = transaction ? paymentFor(all, project, transaction) : undefined;
    const storageProject = payment ? voucherProject(all, payment) : project;
    const key = validFileKey(owner, storageProject, fileType, transaction, data.key);
    const bucket = deps.bucket();
    if (!bucket) throw new TrashError('文件存储尚未就绪', 503);
    const object = await bucket.head(key);
    if (!object) throw new TrashError('原文件不存在，无法处理', 404);
    validMetadata(object, storageProject, fileType, transaction);
    return {project, storageProject, payment, fileType, transaction, key, object};
  }
  async function fileChange(owner: string, action: 'delete_file' | 'restore_file', args: any) {
    const all = await load(owner), restore = action === 'restore_file';
    let old: RecordValue | undefined;
    if (restore) {
      old = all.find(value => value.id === identifier(args.id) && value.kind === 'file_trash');
      if (!old) throw new TrashError('回收站文件不存在或无权访问', 404);
    }
    let scopedArgs = old ? {...old.data, project_id: old.project} : args;
    if (old?.data.file_type === 'payment') {
      const payment = all.find(value => value.id === old!.data.transaction_id && value.kind === 'transaction' && value.data.type === '付款');
      if (!payment || deleted(payment)) throw new TrashError('付款记录不存在、已删除或无权访问', 404);
      if (voucherProject(all, payment) !== old.project) throw new TrashError('付款单据来源校验失败', 403);
      scopedArgs = {...old.data, project_id: payment.project};
    }
    const scoped = await validateFile(owner, all, scopedArgs);
    const {project, storageProject, payment, fileType, transaction, key, object} = scoped;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(owner + '\0' + key));
    const id = old?.id || 'file-trash:' + Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
    old ||= all.find(value => value.id === id && value.kind === 'file_trash');
    if (old && (old.project !== storageProject || old.data.key !== key || old.data.file_type !== fileType || (old.data.transaction_id || '') !== (transaction || ''))) throw new TrashError('回收站文件归属校验失败', 403);
    if (old && deleted(old) !== restore) return {ok: true, reused: true, file: rowResult(old)};
    const now = new Date().toISOString();
    let mutation: D1PreparedStatement;
    if (old) {
      let sql = "UPDATE records SET data = json_set(data, '$.deleted', json(?), '$." + (restore ? 'restored_at' : 'deleted_at') + "', ?, '$." + (restore ? 'restored_by' : 'deleted_by') + "', ?) WHERE id = ? AND owner = ? AND kind = 'file_trash' AND project = ? AND data = ?";
      const bindings: any[] = [restore ? 'false' : 'true', now, owner, id, owner, storageProject, old.rawData];
      // Parent validation also applies at the atomic write, not just at lookup.
      sql += ' AND ' + ACTIVE_FILE_PROJECT;
      bindings.push(project, owner);
      if (transaction) {
        sql += ' AND ' + PAYMENT_FILE_SCOPE;
        bindings.push(transaction, owner, project, storageProject, payment!.rawData);
      }
      mutation = database().prepare(sql).bind(...bindings);
    } else {
      const data = {key, project_id: storageProject, ...(transaction ? {transaction_id: transaction} : {}), file_type: fileType, name: object.customMetadata?.name || (fileType === 'payment' ? '付款单据' : '项目附件'), category: object.customMetadata?.category || '', size: object.size, file_created: object.customMetadata?.created || object.uploaded.toISOString(), deleted: true, deleted_at: now, deleted_by: owner};
      let sql = 'INSERT INTO records(id,owner,kind,project,data,created) SELECT ?,?,?,?,?,? WHERE ' + ACTIVE_FILE_PROJECT;
      const bindings: any[] = [id, owner, 'file_trash', storageProject, JSON.stringify(data), now, project, owner];
      if (transaction) {
        sql += ' AND ' + PAYMENT_FILE_SCOPE;
        bindings.push(transaction, owner, project, storageProject, payment!.rawData);
      }
      sql += ' ON CONFLICT(id) DO NOTHING';
      mutation = database().prepare(sql).bind(...bindings);
    }
    await commit(owner, {id, project}, action, mutation);
    return {ok: true, reused: false, file: rowResult((await load(owner)).find(value => value.id === id)!)};
  }
  async function purgeChange(owner: string, action: 'purge_record' | 'purge_file', args: any) {
    const id = identifier(args.id), all = await load(owner);
    const row = all.find(value => value.id === id);
    if (!row) throw new TrashError('记录不存在或无权访问', 404);
    if (!deleted(row)) throw new TrashError('只能删除回收站中的记录', 409);
    const now = new Date().toISOString();
    if (action === 'purge_record') {
      if (!KINDS.has(row.kind)) throw new TrashError('此记录不能删除', 403);
      if (row.kind === 'contract' && (row.data.status !== 'draft' && !(row.data.status === 'failed' && !row.data.signature?.flow_id))) throw new TrashError('签署中或已签合同不能删除', 409);
      if (row.kind === 'transaction' && (row.data.payment_provider || row.data.wechat_transaction_id || row.data.payment_order_id)) throw new TrashError('微信商户自动登记的收款对应真实到账，不能删除；如需退款请在微信商户平台办理', 409);
      if (row.kind === 'project') {
        if (all.some(value => value.kind === 'project' && value.id !== row.id && value.data.parent_id === row.id)) throw new TrashError('此合作项目还有下属项目，请先永久删除下属项目后再处理', 409);
        if (all.some(value => value.kind !== 'project' && value.kind !== 'audit' && value.project === row.id)) throw new TrashError('该项目下还有记录，请先删除或移动后再永久删除项目', 409);
      }
    } else if (row.kind !== 'file_trash') {
      throw new TrashError('此记录不能删除', 403);
    }
    const bucket = action === 'purge_file' ? deps.bucket() : undefined;
    if (action === 'purge_file' && !bucket) throw new TrashError('文件存储尚未就绪', 503);
    if (bucket) await bucket.delete(row.data.key).catch(() => {});
    const mutation = database().prepare('DELETE FROM records WHERE id = ? AND owner = ? AND kind = ? AND data = ?').bind(id, owner, row.kind, row.rawData);
    const audit = database().prepare('INSERT INTO records(id,owner,kind,project,data,created) SELECT ?,?,?,?,?,? WHERE changes() > 0').bind(
      crypto.randomUUID(), owner, 'audit', row.project,
      JSON.stringify({action, detail: '永久删除（不可恢复）', record_id: id, actor: owner}), now,
    );
    const results = await database().batch([mutation, audit]);
    if (!results[0].meta.changes) throw new TrashError('记录在操作期间已变化，请刷新后重试', 409);
    return {ok: true, purged: rowResult(row)};
  }
  async function execute(owner: string, action: string, args: any = {}) {
    if (!owner) throw new TrashError('请先登录', 401);
    if (action === 'list') return list(owner);
    if (action === 'delete_record' || action === 'restore_record') return recordChange(owner, action, args);
    if (action === 'delete_file' || action === 'restore_file') return fileChange(owner, action, args);
    if (action === 'purge_record' || action === 'purge_file') return purgeChange(owner, action, args);
    throw new TrashError('不支持的回收站操作');
  }
  async function deletedFileKeys(owner: string, project: string, fileType: FileType, transaction?: string) {
    const all = await load(owner);
    const storageProject = fileType === 'payment' ? voucherProject(all, paymentFor(all, project, identifier(transaction))) : project;
    return new Set(all.filter(row => row.kind === 'file_trash' && row.project === storageProject && deleted(row) && row.data.file_type === fileType && (fileType === 'project' || row.data.transaction_id === transaction)).map(row => String(row.data.key)));
  }
  return {execute, getDeletedFileKeys: deletedFileKeys};
}

const service = createTrashService({database: () => env.DB, bucket: () => env.BUCKET});
export const trashExecute = service.execute;
export const getDeletedFileKeys = service.getDeletedFileKeys;
