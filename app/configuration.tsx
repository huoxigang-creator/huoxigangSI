'use client';

import {useCallback, useEffect, useRef, useState, type FormEvent} from 'react';
import {Building2, Copy, Package, Pencil, Plus, RefreshCw, Search, Trash2, X} from 'lucide-react';
import {trashRequest} from '../lib/trash-client';
import {runBulkActions} from '../lib/bulk-actions';
import {useListSelection, SelectionCheckbox, SelectionToolbar} from './list-selection';
import {materialExpenseCategory} from '../lib/catalog-types';
import type {CatalogData, MaterialRecord} from '../lib/catalog-types';
import {CABINET_NAMES,QUOTE_CATEGORIES, type QuoteCategory} from '../lib/quotes';
import './cabinet-configuration.css';
import ManagedTable from './managed-table';
import HardwareImport from './hardware-import';
import {useWorkspaceActive} from './workspace-active';

type Props = {onChanged: () => Promise<void>; expenseCategory?: QuoteCategory};
type DraftTextKey = 'name' | 'expense_category' | 'attribute' | 'category' | 'code' | 'brand' | 'style' | 'model' | 'unit' | 'origin' | 'package_name' | 'areas' | 'purchase_price' | 'sale_price' | 'market_price' | 'internal_price' | 'contract_price' | 'loss_rate' | 'conversion_factor' | 'special_code' | 'other_code' | 'note' | 'warehouse';
type MaterialDraft = Record<DraftTextKey, string> & {warehouse_enabled: boolean};
const PRICE_FIELDS = [['purchase_price', '采购价'], ['sale_price', '销售价'], ['market_price', '市场价'], ['internal_price', '内部价'], ['contract_price', '合同价']] as const;
const money = (value = 0) => <span className="moneyValue">{new Intl.NumberFormat('zh-CN', {style: 'currency', currency: 'CNY'}).format(value / 100)}</span>;
const newDraft = (expenseCategory: QuoteCategory = '材料费用'): MaterialDraft => ({name: '', expense_category: expenseCategory, attribute: expenseCategory === '人工费用' ? '人工' : expenseCategory === '五金费用' ? '辅材' : '主材', category: '', code: '', brand: '', style: '', model: '', unit: expenseCategory === '柜体' ? '㎡' : '个', origin: '', package_name: '', areas: '', purchase_price: '0', sale_price: '0', market_price: '0', internal_price: '0', contract_price: '0', loss_rate: '0', conversion_factor: '1', special_code: '', other_code: '', note: '', warehouse_enabled: false, warehouse: ''});
async function catalogRequest(action: string, args: Record<string, unknown> = {}) {
  const response = await fetch('/api/catalog', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({action, args})});
  const body = await response.json().catch(() => null) as {ok?: boolean; result?: any; error?: string} | null;
  if (!response.ok || !body?.ok) throw new Error(body?.error || '配置请求失败，请重试');
  return body.result;
}
function draftFor(material: MaterialRecord): MaterialDraft {
  const draft = newDraft();
  for (const key of Object.keys(draft)) {
    if (key === 'areas') draft.areas = (material.areas || []).join('、');
    else if (key === 'warehouse_enabled') draft.warehouse_enabled = Boolean(material.warehouse_enabled);
    else {const textKey = key as DraftTextKey; draft[textKey] = String((material as any)[key] ?? draft[textKey]);}
  }
  draft.expense_category = materialExpenseCategory(material);
  for (const [key] of PRICE_FIELDS) draft[key] = String((material[key] || 0) / 100);
  return draft;
}

export default function Configuration({onChanged, expenseCategory = '材料费用'}: Props) {
  const active=useWorkspaceActive();
  const [catalog, setCatalog] = useState<CatalogData | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [editor, setEditor] = useState<{material: MaterialRecord | null; draft: MaterialDraft; createId: string; mode?: 'copy'} | null>(null);
  const [formError, setFormError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await catalogRequest('get_catalog') as CatalogData;
      setCatalog(result); setCompanyName(result.company.name); setError('');
      return true;
    } catch (reason) {setError(reason instanceof Error ? reason.message : '配置加载失败'); return false;}
    finally {setLoading(false);}
  }, []);
  useEffect(() => {void load();}, [load]);
  useEffect(() => {
    if (!active || !editor) return;
    const keydown = (event: KeyboardEvent) => {if (event.key === 'Escape' && !lock.current) setEditor(null);};
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [active,editor]);
  function open(material: MaterialRecord | null) {setEditor({material, draft: material ? draftFor(material) : newDraft(expenseCategory), createId: crypto.randomUUID()}); setFormError('');}
  function openCabinetName(name:string) {setEditor({material:null,draft:{...newDraft('柜体'),name,unit:'㎡'},createId:crypto.randomUUID()});setFormError('');}
  function copy(material: MaterialRecord) {
    const draft = draftFor(material), suffix = '（副本）';
    draft.name = material.name.slice(0, 100 - suffix.length).replace(/[\uD800-\uDBFF]$/, '') + suffix;
    draft.code = '';
    setEditor({material: null, draft, createId: crypto.randomUUID(), mode: 'copy'}); setFormError('');
  }
  function change(key: string, value: string | boolean) {setEditor(current => current ? {...current, draft: {...current.draft, [key]: value}} : current);}
  async function refreshParent() {
    try {await onChanged();} catch {setError('设置已保存，工作空间刷新失败，请刷新页面。');}
  }
  async function saveCompany(event: FormEvent) {
    event.preventDefault(); if (lock.current) return;
    if (!companyName.trim()) {setError('请输入公司名称'); return;}
    lock.current = true; setBusy(true); setError(''); setMessage('');
    try {
      await catalogRequest('save_company', {name: companyName.trim(), ...(catalog?.company.revision ? {revision: catalog.company.revision} : {})});
      await load(); await refreshParent(); setMessage('公司名称已保存。');
    } catch (reason) {setError(reason instanceof Error ? reason.message : '公司名称保存失败');}
    finally {lock.current = false; setBusy(false);}
  }
  async function saveMaterial(event: FormEvent) {
    event.preventDefault(); if (!editor || lock.current) return;
    const {draft, material} = editor;
    const args: Record<string, unknown> = {...draft, id: editor.createId, areas: [...new Set(draft.areas.split(/[、,，;；\n]/).map(value => value.trim()).filter(Boolean))]};
    for (const [key] of PRICE_FIELDS) args[key] = Number(draft[key]);
    args.loss_rate = Number(draft.loss_rate); args.conversion_factor = Number(draft.conversion_factor);
    if (material) {args.id = material.id; args.revision = material.revision;}
    lock.current = true; setBusy(true); setFormError(''); setMessage('');
    try {
      await catalogRequest(material ? 'update_material' : 'create_material', args);
      setEditor(null); const refreshed = await load(); await refreshParent();
      setMessage(refreshed ? entryName+'已保存。' : entryName+'已保存，列表未刷新，请点击刷新。');
    } catch (reason) {setFormError(reason instanceof Error ? reason.message : '材料保存失败，请保留表单重试');}
    finally {lock.current = false; setBusy(false);}
  }
  async function removeSelected() {
    const rows = selection.selectedRows;
    if (lock.current || !rows.length || !window.confirm('删除选中的 ' + rows.length + ' 项材料并移入回收站？可在回收站恢复，已保存采购单的材料快照保留。')) return;
    lock.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const result = await runBulkActions(rows, material => trashRequest('delete_record', {id: material.id}), {concurrency: 3});
      const refreshed = await load();
      selection.retain(result.failedIds);
      const issues = result.failures.map(failure => failure.row.name + '：' + failure.error);
      if (!refreshed) issues.push('列表刷新失败，请点击刷新核实。');
      try {await onChanged();} catch {issues.push('工作空间刷新失败，请刷新页面。');}
      setMessage('已删除 ' + result.successIds.length + ' 项材料，失败 ' + result.failedIds.length + ' 项。成功项可在回收站恢复。');
      setError(issues.join('；'));
    } catch (reason) {setError(reason instanceof Error ? reason.message : '批量删除失败，选择已保留，请重试');}
    finally {lock.current = false; setBusy(false);}
  }
  const materials = (catalog?.materials || []).filter(material => materialExpenseCategory(material) === expenseCategory).filter(material => [material.name, material.brand, material.model, material.code, material.category, material.style].join(' ').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const selection = useListSelection(materials, 'configuration-materials:' + expenseCategory);
  const entryName = expenseCategory === '柜体' ? '柜体' : expenseCategory === '人工费用' ? '人工' : expenseCategory === '五金费用' ? '五金' : '材料';
  function field(key: DraftTextKey, label: string, props: {required?: boolean; maxLength?: number; type?: string; min?: number; max?: number; step?: string} = {}) {
    return <label key={key}>{label}<input name={key} aria-label={label} value={editor!.draft[key]} onChange={event => change(key, event.target.value)} {...props}/></label>;
  }
  return <div className="catalogConfiguration">
    <section className="panel catalogCompany"><div className="panelHead"><h2><Building2 size={17}/>公司信息</h2></div><form onSubmit={saveCompany}><label>公司名称<input aria-label="公司名称" maxLength={100} required value={companyName} disabled={busy || loading} onChange={event => setCompanyName(event.target.value)}/></label><button className="primary" type="submit" disabled={busy || loading}>保存公司名称</button></form></section>
    <section className="panel catalogMaterials"><div className="panelHead"><h2>{expenseCategory}数据 <span className="count">{(catalog?.materials || []).filter(material => materialExpenseCategory(material) === expenseCategory).length}</span></h2></div><SelectionToolbar selection={selection.selectedRows.length} count={materials.length} busy={busy || loading} onClear={selection.clear}><button className="primary" type="button" disabled={busy || loading || !catalog} onClick={() => open(null)}><Plus size={15}/>新增{entryName}</button>{expenseCategory === '五金费用' && <HardwareImport materials={catalog?.materials || []} disabled={busy || loading || !catalog} onChanged={async () => {await load(); await refreshParent();}}/>}<button type="button" disabled={busy || loading} onClick={() => void load()}><RefreshCw size={15}/>刷新</button><button type="button" disabled={busy || loading || selection.selectedRows.length !== 1} onClick={() => copy(selection.selectedRows[0])}><Copy size={15}/>复制</button><button type="button" disabled={busy || loading || selection.selectedRows.length !== 1} onClick={() => open(selection.selectedRows[0])}><Pencil size={15}/>编辑</button><button type="button" className="dangerLink" disabled={busy || loading || !selection.selectedRows.length} onClick={() => void removeSelected()}><Trash2 size={15}/>删除所选</button></SelectionToolbar>
      {expenseCategory === '柜体'&&<div className="cabinetNameDefaults"><p>衣柜、鞋柜、酒柜等常用名称可直接在报价中选择。可选择名称建立配置，也可点击‘新增柜体’添加自定义名称；保存后会出现在柜体报价的名称下拉框。</p><div>{CABINET_NAMES.map(name=><button type="button" key={name} disabled={busy||loading||!catalog} onClick={()=>openCabinetName(name)}>{name}</button>)}</div></div>}
      <div className="filters"><label className="search"><Search size={16}/><input aria-label="搜索材料" disabled={busy || loading} placeholder="搜索名称、品牌、型号或代码" value={search} onChange={event => setSearch(event.target.value)}/></label><span className="muted">价格单位：元 · 删除后可在回收站恢复</span></div>
      {error && <p className="catalogError" role="alert">{error}</p>}{message && <p className="catalogMessage" role="status">{message}</p>}
      {loading ? <p className="catalogMessage" role="status">正在读取{entryName}数据…</p> : !materials.length ? <div className="empty"><Package size={32}/><h3>{search ? '没有匹配的' + entryName : '暂无' + entryName}</h3><p>{search ? '调整搜索词查看资料。' : '点击新增' + entryName + '，建立对应费用资料。'}</p></div> : <div className="tableWrap catalogMaterialTable"><ManagedTable tableKey="materials/common" allRowOrder={catalog?.materials.map(material => material.id) || []} disabled={busy || loading}><thead><tr><th><SelectionCheckbox checked={selection.allSelected} mixed={selection.partiallySelected} label="全选当前材料" disabled={busy || loading || !materials.length} onChange={selection.toggleAll}/></th><th>{entryName}名称</th><th>费用类型</th><th>属性 / 分类</th><th>代码</th><th>品牌</th><th>款式 / 型号</th><th>单位</th><th>产地</th><th>套餐 / 使用区域</th>{PRICE_FIELDS.map(([key, label]) => <th key={key}>{label}</th>)}<th>损耗率</th><th>换算系数</th><th>特价码 / 其他码</th><th>仓库</th><th>备注</th><th>操作</th></tr></thead><tbody>{materials.map(material => <tr key={material.id} data-row-id={material.id}><td><SelectionCheckbox checked={selection.selectedRows.some(row => row.id === material.id)} label={"选择材料 " + material.name} disabled={busy || loading} onChange={() => selection.toggle(material.id)}/></td><td className="catalogEditableName" title="单击名称编辑" onClick={() => {if (!busy && !loading && !lock.current) open(material);}}><b>{material.name}</b></td><td>{materialExpenseCategory(material)}</td><td>{material.attribute}<small className="block muted">{material.category || '—'}</small></td><td>{material.code || '—'}</td><td>{material.brand || '—'}</td><td>{material.style || '—'}<small className="block muted">{material.model || '—'}</small></td><td>{material.unit}</td><td>{material.origin || '—'}</td><td>{material.package_name || '—'}<small className="block muted">{material.areas.join('、') || '—'}</small></td>{PRICE_FIELDS.map(([key]) => <td className="catalogMoney" key={key}>{money(material[key])}</td>)}<td>{material.loss_rate}%</td><td>{material.conversion_factor}</td><td>{material.special_code || '—'}<small className="block muted">{material.other_code || '—'}</small></td><td>{material.warehouse_enabled ? material.warehouse || '仓库材料' : '普通材料'}</td><td className="catalogNoteCell">{material.note || '—'}</td><td className="catalogActions"><button className="link" disabled={busy || loading} onClick={() => open(material)}><Pencil size={13}/>编辑</button></td></tr>)}</tbody></ManagedTable></div>}
    </section>
    {editor && <div className="overlay catalogOverlay"><section className="modal catalogMaterialModal" role="dialog" aria-modal="true" aria-labelledby="material-editor-title"><form onSubmit={saveMaterial}><div className="modalHead"><h2 id="material-editor-title">{editor.mode === 'copy' ? '复制' + entryName : editor.material ? '编辑' + entryName : '新增' + entryName}</h2><div className="catalogHeadActions">{editor.material && <button type="button" className="catalogHeadCopy" aria-label={'复制' + entryName + '为新材料'} disabled={busy} onClick={() => copy(editor.material!)}><Copy size={15}/>复制</button>}<button type="button" aria-label="关闭材料表单" disabled={busy} onClick={() => setEditor(null)}><X size={20}/></button></div></div><fieldset className="catalogFields" disabled={busy}><div className="formBody">{editor.mode === 'copy' && <p className="note" style={{marginBottom: 18}}>材料代码已留空，可填写新代码后保存。</p>}<h3>基本信息</h3><div className="catalogFormGrid">{field('name', entryName + '名称', {required: true, maxLength: 100})}<label>费用类型<select aria-label="费用类型" value={editor.draft.expense_category} onChange={event => change('expense_category', event.target.value)}>{QUOTE_CATEGORIES.map(category => <option key={category}>{category}</option>)}</select></label><label>材料属性<select aria-label="材料属性" value={editor.draft.attribute} onChange={event => change('attribute', event.target.value)}><option>主材</option><option>辅材</option><option>人工</option></select></label>{field('category', '材料分类', {maxLength: 100})}{field('code', '材料代码', {maxLength: 100})}{field('brand', '品牌', {maxLength: 100})}{field('style', '款式', {maxLength: 100})}{field('model', '型号', {maxLength: 100})}{field('unit', '单位', {required: true, maxLength: 30})}{field('origin', '产地', {maxLength: 100})}{field('package_name', '套餐名称', {maxLength: 100})}<label className="catalogSpan2">使用区域<input aria-label="使用区域" maxLength={1000} placeholder="多个区域用逗号或顿号分隔" value={editor.draft.areas} onChange={event => change('areas', event.target.value)}/></label></div><h3>价格与换算</h3><div className="catalogFormGrid">{PRICE_FIELDS.map(([key, label]) => field(key, label + '（元）', {type: 'number', required: true, min: 0, max: 100000000, step: '0.01'}))}{field('loss_rate', '损耗率（%）', {type: 'number', required: true, min: 0, max: 100, step: '0.0001'})}{field('conversion_factor', '换算系数', {type: 'number', required: true, min: 0.000001, step: 'any'})}{field('special_code', '特价码', {maxLength: 100})}{field('other_code', '其他代码', {maxLength: 100})}</div><h3>仓库属性与备注</h3><div className="catalogFormGrid"><label className="catalogCheckbox"><input type="checkbox" checked={Boolean(editor.draft.warehouse_enabled)} onChange={event => change('warehouse_enabled', event.target.checked)}/>仓库材料</label>{field('warehouse', '仓库名称', {maxLength: 100})}<label className="catalogSpan3">备注<textarea aria-label="材料备注" maxLength={2000} value={editor.draft.note} onChange={event => change('note', event.target.value)}/></label></div>{formError && <p className="catalogError" role="alert">{formError}</p>}</div></fieldset><div className="modalFoot"><button type="button" disabled={busy} onClick={() => setEditor(null)}>取消</button><button className="primary" type="submit" disabled={busy}>{busy ? '保存中…' : '保存' + entryName}</button></div></form></section></div>}
  </div>;
}
