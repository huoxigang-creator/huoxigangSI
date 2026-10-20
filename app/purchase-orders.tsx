'use client';

import {useCallback, useEffect, useRef, useState, type FormEvent} from 'react';
import {ClipboardList, Pencil, Plus, RefreshCw, Trash2, X} from 'lucide-react';
import {trashRequest} from '../lib/trash-client';
import {runBulkActions} from '../lib/bulk-actions';
import {useListSelection, SelectionCheckbox, SelectionToolbar} from './list-selection';
import {materialExpenseCategory,catalogPriceCents, purchaseItemAmount, purchaseTotal} from '../lib/catalog-types';
import type {CatalogData, MaterialRecord, PurchaseOrderRecord} from '../lib/catalog-types';
import CatalogSearch from './catalog-search';
import ManagedTable from './managed-table';
import {mergeVisibleOrder} from '../lib/table-preferences';
import {groupQuotes, type QuoteRecord} from '../lib/quotes';
import DocumentImport from './document-import';
import {documentImportNumber,type DocumentImportRow} from '../lib/document-import';
import {useWorkspaceActive,visibleWorkspaceDialogs} from './workspace-active';
import './table-editor-dialog.css';

type Props = {projectOptions?:{id:string;name:string}[];onSavedProject?:(id:string)=>void;projectId: string; projectName: string; companyName: string; quotes?: QuoteRecord[]; onChanged: () => Promise<void>};
type PurchaseCategory='材料费用'|'五金费用';
type ItemDraft = {expense_category?:PurchaseCategory;autoEmpty?:boolean;rowId: string; material_id: string; name: string; brand: string; model: string; code: string; attribute: '主材' | '辅材' | '人工'; unit: string; quantity: string; price: string; batch: string};
type OrderDraft = {number: string; source_quote_id: string; supplier: string; date: string; note: string; items: ItemDraft[]};
const money = (value = 0) => <span className="moneyValue">{new Intl.NumberFormat('zh-CN', {style: 'currency', currency: 'CNY'}).format(value / 100)}</span>;
const today = () => new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
const newItem = (expense_category:PurchaseCategory='材料费用',autoEmpty=false): ItemDraft => ({expense_category,autoEmpty,rowId: crypto.randomUUID(), material_id: '', name: '', brand: '', model: '', code: '', attribute: '主材', unit: '个', quantity: autoEmpty?'':'1', price: '0', batch: ''});
const newOrder = (createId: string): OrderDraft => {const date = today(); return {number: 'CG-' + date.replaceAll('-', '') + '-' + createId, source_quote_id: '', supplier: '', date, note: '', items: [newItem()]};};

async function catalogRequest(action: string, args: Record<string, unknown> = {}) {
  const response = await fetch('/api/catalog', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({action, args})});
  const result = await response.json().catch(() => null) as {ok?: boolean; result?: any; error?: string} | null;
  if (!response.ok || !result?.ok) throw new Error(result?.error || '采购单请求失败，请重试');
  return result.result;
}
// Half-filled inputs remain editable; server-shared validation returns a dash
// during typing, while save requires every line and the total to be valid.
export function purchaseDraftAmount(quantity: string, price: string): number | null {
  if (!quantity.trim() || !price.trim()) return null;
  try {return purchaseItemAmount(Number(quantity), catalogPriceCents(Number(price)));}
  catch {return null;}
}
function draftTotal(amounts: Array<number | null>): number | null {
  if (amounts.some(amount => amount === null)) return null;
  try {return purchaseTotal(amounts.map(amount => ({amount: amount!})));} catch {return null;}
}
function orderDraft(order: PurchaseOrderRecord): OrderDraft {
  return {number: order.number, source_quote_id: order.source_quote_id || '', supplier: order.supplier, date: order.date, note: order.note, items: order.items.map(item => ({...(item.expense_category?{expense_category:item.expense_category}:{}),rowId: crypto.randomUUID(), material_id: item.material_id || '', name: item.name, brand: item.brand, model: item.model, code: item.code, attribute: item.attribute, unit: item.unit, quantity: String(item.quantity), price: String(item.price / 100), batch: item.batch}))};
}

export default function PurchaseOrders({projectId, projectName, companyName, quotes = [], onChanged,projectOptions,onSavedProject}: Props) {
  const active=useWorkspaceActive(),editorPanel=useRef<HTMLElement>(null);
  const [catalog, setCatalog] = useState<CatalogData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [docImportBusy,setDocImportBusy]=useState(false),[docImportNotice,setDocImportNotice]=useState('');
  const docImportTarget=useRef<{projectId:string;createId:string;targetProjectId:string;sourceQuoteId:string;category:PurchaseCategory}|null>(null);
  const editorDisabled=busy||docImportBusy;
  const lock = useRef(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [editor, setEditor] = useState<{order: PurchaseOrderRecord | null; draft: OrderDraft; createId: string;targetProjectId:string} | null>(null);
  const editorOpen=Boolean(editor);
  const [purchaseCategory,setPurchaseCategory]=useState<PurchaseCategory>('材料费用');
  const [materialPicker,setMaterialPicker]=useState<{rowId:string;top:number;left:number;width:number}|null>(null);
  const [formError, setFormError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    try {setCatalog(await catalogRequest('get_catalog') as CatalogData); setError(''); return true;}
    catch (reason) {setError(reason instanceof Error ? reason.message : '采购单加载失败'); return false;}
    finally {setLoading(false);}
  }, []);
  useEffect(() => {docImportTarget.current=null;setDocImportBusy(false);setDocImportNotice('');setCatalog(null); setEditor(null); setMessage(''); void load();}, [projectId, load]);
  useEffect(() => {
    if(!active||!editorOpen)return;
    const previous=document.body.style.overflow;
    document.body.style.overflow='hidden';
    return()=>{document.body.style.overflow=previous;};
  }, [active,editorOpen]);
  useEffect(() => {
    if (!active || !editor) return;
    const keydown = (event: KeyboardEvent) => {
      if(event.key!=='Escape')return;
      const dialogs=visibleWorkspaceDialogs();
      if(dialogs.length&&dialogs[dialogs.length-1]!==editorPanel.current)return;
      if(!lock.current&&!docImportTarget.current){event.stopImmediatePropagation();setEditor(null);}
    };
    window.addEventListener('keydown', keydown, true); return () => window.removeEventListener('keydown', keydown, true);
  }, [active,editor]);
  useEffect(() => {
    if (!materialPicker) return;
    const close = () => setMaterialPicker(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close);};
  }, [materialPicker !== null]);
  const materials = catalog?.materials || [];
  const orders = (catalog?.purchase_orders || []).filter(order => order.project_id === projectId || (projectOptions || []).some(option => option.id === order.project_id));
  const subprojects = groupQuotes(quotes.filter(quote => quote.project === (editor?editor.targetProjectId:projectId))).flatMap(group => {
    const source = group.adopted?.id ? group.adopted : group.quotes.find(quote => quote.id);
    return source?.id ? [{id: source.id, name: group.name}] : [];
  });
  const selection = useListSelection(orders, 'project-purchase-orders:' + projectId);
  function itemCategory(item:ItemDraft):PurchaseCategory{return item.expense_category||(materials.find(material=>material.id===item.material_id)&&materialExpenseCategory(materials.find(material=>material.id===item.material_id)!)==='五金费用'?'五金费用':'材料费用');}
  function blankItem(item:ItemDraft){return !item.material_id&&![item.name,item.brand,item.model,item.code,item.batch].some(value=>value.trim())&&item.unit==='个'&&item.attribute==='主材'&&Number(item.price)===0;}
  function switchCategory(category:PurchaseCategory){setMaterialPicker(null);setPurchaseCategory(category);setEditor(current=>{if(!current)return current;const items=current.draft.items.filter(item=>!(blankItem(item)&&(item.quantity==='1'||(item.autoEmpty&&item.quantity===''))));if(!items.some(item=>itemCategory(item)===category)&&items.length<200)items.push(newItem(category));return {...current,draft:{...current.draft,items}};});}
  function nextEmptyRow(rowId:string){setEditor(current=>{if(!current||editorDisabled||current.draft.items.length>=200)return current;const item=current.draft.items.find(row=>row.rowId===rowId);if(!item||!item.quantity.trim()||!Number.isFinite(Number(item.quantity))||Number(item.quantity)<=0)return current;const category=itemCategory(item),visible=current.draft.items.filter(row=>itemCategory(row)===category);if(visible.at(-1)?.rowId!==rowId)return current;return {...current,draft:{...current.draft,items:[...current.draft.items,newItem(category,true)]}};});}
  function open(order: PurchaseOrderRecord | null) {if(editorDisabled||docImportTarget.current)return;setDocImportNotice('');setPurchaseCategory(order?.items[0]?.expense_category||'材料费用');const createId = crypto.randomUUID(); setEditor({order,targetProjectId:order?.project_id||(projectOptions&&!projectOptions.some(p=>p.id===projectId)?'':projectId), draft: order ? orderDraft(order) : newOrder(createId), createId}); setFormError('');}
  function documentImportBusyChange(value:boolean){
    if(value){if(!editor||busy)return;docImportTarget.current={projectId,createId:editor.createId,targetProjectId:editor.targetProjectId,sourceQuoteId:editor.draft.source_quote_id,category:purchaseCategory};setDocImportNotice('');}
    else docImportTarget.current=null;
    setDocImportBusy(value);
  }
  function importPlaceholder(item:ItemDraft){return blankItem(item)&&(item.quantity==='1'||Boolean(item.autoEmpty&&item.quantity===''));}
  const docItemCount=editor?editor.draft.items.length-(editor.draft.items.some(importPlaceholder)?1:0):0;
  function applyDocumentImport(rows:DocumentImportRow[]){
    const target=docImportTarget.current;
    if(!editor||!target||target.projectId!==projectId||target.createId!==editor.createId||target.targetProjectId!==editor.targetProjectId||target.sourceQuoteId!==editor.draft.source_quote_id||busy)return;
    const selected=rows.filter(row=>row.selected);if(!selected.length)return;
    const parsed=selected.map(row=>({row,quantity:documentImportNumber(row.quantity),price:row.price.trim()===''?'' as const:documentImportNumber(row.price,true)}));
    if(parsed.some(({row,quantity,price})=>(row.category!=='材料费用'&&row.category!=='五金费用')||!row.name.trim()||!row.unit.trim()||quantity===null||quantity<=0||price!==''&&(price===null||price<0))){setFormError('请在识别预览中核对材料或五金分类、名称、单位、数量和已填写的单价。');return;}
    const importNotes=selected.filter(row=>row.note.trim()).map(row=>row.name.trim()+'：'+row.note.trim());
    const note=importNotes.length?editor.draft.note+(editor.draft.note?'\n':'')+importNotes.join('\n'):editor.draft.note;
    if(note.length>2000){setFormError('识别明细备注加上现有采购备注将超过 2000 字，请减少所选备注或修改采购备注后再复制。原草稿已保留。');return;}
    const imported:ItemDraft[]=parsed.map(({row,quantity,price})=>({rowId:crypto.randomUUID(),material_id:'',expense_category:row.category as PurchaseCategory,name:row.name.trim(),brand:row.brand,model:row.model,code:row.code,attribute:row.attribute,unit:row.unit.trim(),quantity:String(quantity),price:price===''?'':String(price),batch:row.batch}));
    const placeholder=editor.draft.items.find(importPlaceholder);
    if(editor.draft.items.length-(placeholder?1:0)+imported.length>200){setFormError('复制后将超过每张采购单 200 条明细，请减少选择。');return;}
    setEditor({...editor,draft:{...editor.draft,note,items:[...editor.draft.items.filter(item=>item.rowId!==placeholder?.rowId),...imported]}});
    const categories=(['材料费用','五金费用'] as PurchaseCategory[]).filter(value=>imported.some(item=>item.expense_category===value));
    setPurchaseCategory(categories.includes(target.category)?target.category:imported[0].expense_category!);
    setFormError('');setDocImportNotice(`已复制 ${imported.length} 条到当前采购草稿${categories.length>1?'，分布在'+categories.join('、')+'，可切换分类核对':''}。${importNotes.length?'明细备注已追加到采购备注。':''}请核对后保存。`);
  }
  function change(key: 'source_quote_id' | 'supplier' | 'date' | 'note', value: string) {setEditor(current => current ? {...current, draft: {...current.draft, [key]: value}} : current);}
  function itemChange(rowId: string, key: keyof ItemDraft, value: string) {setEditor(current => current ? {...current, draft: {...current.draft, items: current.draft.items.map(item => item.rowId === rowId ? {...item, [key]: value, ...(item.material_id && !materials.some(material => material.id === item.material_id) ? {material_id: ''} : {})} : item)}} : current);}
  function reorderItems(ids: string[]) {
    setEditor(current => {
      if (!current || editorDisabled) return current;
      const byId = new Map(current.draft.items.map(item => [item.rowId, item]));
      if (ids.length !== byId.size || new Set(ids).size !== ids.length || ids.some(id => !byId.has(id))) return current;
      return {...current, draft: {...current.draft, items: ids.map(id => byId.get(id)!)}};
    });
  }
  function chooseMaterial(rowId: string, id: string) {
    const material = materials.find(value => value.id === id);
    setEditor(current => current ? {...current, draft: {...current.draft, items: current.draft.items.map(item => item.rowId !== rowId ? item : material ? {...item, expense_category:purchaseCategory,material_id: material.id, name: material.name, brand: material.brand, model: material.model, code: material.code, attribute: material.attribute, unit: material.unit, price: String(material.purchase_price / 100)} : {...item, material_id: ''})}} : current);
  }
  function openMaterialPicker(rowId: string, target: EventTarget | null) {
    const element = target as HTMLInputElement | null;
    const rect = element && typeof element.getBoundingClientRect === 'function' ? element.getBoundingClientRect() : null;
    setMaterialPicker({rowId, top: rect ? rect.bottom + 2 : 0, left: rect ? rect.left : 0, width: rect ? Math.max(rect.width, 260) : 260});
  }
  function pickerMatches(material: MaterialRecord, query: string) {
    const tokens = query.normalize('NFKC').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return tokens.every(token => [material.name, material.brand, material.model, material.code].join(' ').normalize('NFKC').toLocaleLowerCase().includes(token));
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!editor || lock.current || docImportTarget.current || editorDisabled) return;
    const {order,draft:rawDraft}=editor;const draft={...rawDraft,items:rawDraft.items.filter(item=>!(item.autoEmpty&&blankItem(item)&&item.quantity===''))};
    const incomplete=draft.items.find(item=>!item.name.trim()||!item.unit.trim()||!item.quantity.trim());if(incomplete){setPurchaseCategory(itemCategory(incomplete));setFormError('请补齐'+itemCategory(incomplete)+'中的名称、数量和单位。');return;}
    if(!draft.items.length){setFormError('至少填写一项明细。');return;}
    if(draft.items.length>200){setFormError('每张采购单最多 200 条明细，请拆分采购单。');return;}
    if(!editor.targetProjectId||(!order&&projectOptions&&!projectOptions.some(p=>p.id===editor.targetProjectId))){setFormError('请选择项目名称。');return;}
    const sourceChanged = draft.source_quote_id !== (order?.source_quote_id || '');
    if (!projectOptions && !order && !draft.source_quote_id) {setFormError('请选择报价里的小项目名称；暂无小项目时，请先到报价页面新建。'); return;}
    if (draft.source_quote_id && (!order || sourceChanged) && !subprojects.some(subproject => subproject.id === draft.source_quote_id)) {setFormError('所选报价小项目已不可用，请重新选择。'); return;}
    const amounts = draft.items.map(item => purchaseDraftAmount(item.quantity, item.price));
    if (draftTotal(amounts) === null) {setFormError('请检查数量和单价：数量需大于0、最多4位小数，单价、行金额和合计不得超过支持范围。'); return;}
    const args = {id: editor.createId, project_id: editor.targetProjectId, number: draft.number, ...(!order || sourceChanged ? draft.source_quote_id?{source_quote_id: draft.source_quote_id}:{} : {}), supplier: draft.supplier, date: draft.date, note: draft.note, items: draft.items.map(({rowId: _rowId,autoEmpty:_autoEmpty, ...item}) => ({...item, quantity: Number(item.quantity), price: Number(item.price)})), ...(order ? {id: order.id, revision: order.revision} : {})};
    lock.current = true; setBusy(true); setFormError(''); setMessage('');
    try {
      await catalogRequest(order ? 'update_purchase_order' : 'create_purchase_order', args);
      setEditor(null); const refreshed = await load();
      try {await onChanged();} catch {setError('采购单已保存，项目概况刷新失败，请刷新项目。');}
      onSavedProject?.(editor.targetProjectId);setMessage(refreshed ? '采购单已保存。' : '采购单已保存，列表未刷新，请点击刷新。');
    } catch (reason) {setFormError(reason instanceof Error ? reason.message : '采购单保存失败，请保留表单重试');}
    finally {lock.current = false; setBusy(false);}
  }
  async function removeSelected() {
    const rows = selection.selectedRows;
    if (lock.current || !rows.length || !window.confirm('删除选中的 ' + rows.length + ' 张采购单并移入回收站？可在回收站恢复。')) return;
    lock.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const result = await runBulkActions(rows, order => trashRequest('delete_record', {id: order.id}), {concurrency: 3});
      const refreshed = await load();
      selection.retain(result.failedIds);
      const issues = result.failures.map(failure => (failure.row.subproject_name || '未关联报价小项目') + '：' + failure.error);
      if (!refreshed) issues.push('列表刷新失败，请点击刷新核实。');
      try {await onChanged();} catch {issues.push('项目概况刷新失败，请刷新项目。');}
      setMessage('已删除 ' + result.successIds.length + ' 张采购单，失败 ' + result.failedIds.length + ' 张。成功项可在回收站恢复。');
      setError(issues.join('；'));
    } catch (reason) {setError(reason instanceof Error ? reason.message : '批量删除失败，选择已保留，请重试');}
    finally {lock.current = false; setBusy(false);}
  }
  const totals = editor?.draft.items.filter(item=>!(item.autoEmpty&&blankItem(item)&&item.quantity==='')).map(item => purchaseDraftAmount(item.quantity, item.price)) || [];
  const total = draftTotal(totals);
  return <div className="purchaseOrders">
    <div className="panelHead"><h2>项目采购单 <span className="count">{orders.length}</span></h2></div><SelectionToolbar selection={selection.selectedRows.length} count={orders.length} busy={editorDisabled || loading} onClear={selection.clear}><button className="primary" type="button" disabled={busy || loading || !catalog} onClick={() => open(null)}><Plus size={15}/>新增采购单</button><button type="button" disabled={editorDisabled || loading} onClick={() => void load()}><RefreshCw size={15}/>刷新</button><button type="button" disabled={busy || loading || selection.selectedRows.length !== 1} onClick={() => open(selection.selectedRows[0])}><Pencil size={15}/>编辑</button><button type="button" className="dangerLink" disabled={busy || loading || !selection.selectedRows.length} onClick={() => void removeSelected()}><Trash2 size={15}/>删除所选</button></SelectionToolbar>
    <p className="sectionNote">{companyName} · {projectName}。采购单关联报价里的小项目，采购数量会作为该小项目后续人工费用的计算数量，单位分别保留。</p>
    {error && <p className="catalogError" role="alert">{error}</p>}{message && <p className="catalogMessage" role="status">{message}</p>}
    {loading ? <p className="catalogMessage" role="status">正在读取采购单…</p> : !orders.length ? <div className="empty"><ClipboardList size={32}/><h3>暂无采购单</h3><p>从材料库选择材料，或直接填写采购明细。</p></div> : <div className="tableWrap purchaseOrderList"><ManagedTable tableKey="purchase/list" preferenceScope={projectId} disabled={editorDisabled || loading}><thead><tr><th><SelectionCheckbox checked={selection.allSelected} mixed={selection.partiallySelected} label="全选当前采购单" disabled={busy || loading || !orders.length} onChange={selection.toggleAll}/></th><th>采购日期</th><th>项目名称</th><th>供应商</th><th>材料明细</th><th>合计</th><th>备注</th><th>操作</th></tr></thead><tbody>{orders.map(order => <tr key={order.id} data-row-id={order.id}><td><SelectionCheckbox checked={selection.selectedRows.some(row => row.id === order.id)} label={"选择采购单 " + (order.subproject_name || "未关联报价小项目") + " " + order.date} disabled={editorDisabled || loading} onChange={() => selection.toggle(order.id)}/></td><td>{order.date}</td><td onClick={()=>{if(!busy&&!loading)open(order);}} title="单击编辑采购单"><b>{order.subproject_name || (projectOptions?(projectOptions.find(p=>p.id===order.project_id)?.name||projectName):'未关联报价小项目')}</b></td><td>{order.supplier || '—'}</td><td><details><summary>{order.items.length} 项材料</summary><div className="tableWrap purchaseSnapshot"><ManagedTable tableKey={"purchase/snapshot/" + order.id} preferenceScope={projectId} disabled={editorDisabled || loading}><thead><tr><th>材料名称</th><th>品牌 / 型号</th><th>代码</th><th>属性</th><th>数量</th><th>单位</th><th>单价</th><th>金额</th><th>批次</th></tr></thead><tbody>{order.items.map((item, index) => <tr key={index} data-row-id={"snapshot:" + index}><td>{item.name}</td><td>{item.brand || '—'} / {item.model || '—'}</td><td>{item.code || '—'}</td><td>{item.attribute}</td><td>{item.quantity}</td><td>{item.unit}</td><td>{money(item.price)}</td><td>{money(item.amount)}</td><td>{item.batch || '—'}</td></tr>)}</tbody></ManagedTable></div></details></td><td className="catalogMoney"><b>{money(order.total)}</b></td><td className="catalogNoteCell">{order.note || '—'}</td><td className="catalogActions"><button className="link" disabled={editorDisabled || loading} onClick={() => open(order)}><Pencil size={13}/>编辑</button></td></tr>)}</tbody></ManagedTable></div>}
    {editor && <div className="overlay catalogOverlay tableEditorOverlay"><section ref={editorPanel} className="modal purchaseOrderModal tableEditorDialog" role="dialog" aria-modal="true" aria-labelledby="purchase-order-title"><form onSubmit={save}><div className="modalHead tableEditorHeader"><div><h2 id="purchase-order-title">{editor.order ? '编辑采购单' : '新增采购单'}</h2><p>{companyName} · {projectName}</p></div><button type="button" aria-label="关闭采购单表单" disabled={editorDisabled} onClick={() => {if(!docImportTarget.current)setEditor(null);}}><X size={20}/></button></div><div className="catalogFields tableEditorBody"><div className="formBody"><fieldset className="catalogFields" disabled={editorDisabled}><div className="catalogFormGrid">{projectOptions&&<label>项目名称<select aria-label="采购独立项目名称" required value={editor.targetProjectId} disabled={!!editor.order} onChange={event=>setEditor({...editor,targetProjectId:event.target.value,draft:{...editor.draft,source_quote_id:''}})}><option value="" disabled>请选择项目</option>{projectOptions.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}<label>{projectOptions?'关联报价（可选）':'项目名称'}<select aria-label="采购项目名称" required={!projectOptions&&(!editor.order || Boolean(editor.order.source_quote_id))} value={editor.draft.source_quote_id} onChange={event => change('source_quote_id', event.target.value)}><option value="" disabled={Boolean(editor.order?.source_quote_id)}>{editor.order ? '未关联报价小项目' : '请选择报价里的小项目'}</option>{editor.order?.source_quote_id && !subprojects.some(subproject => subproject.id === editor.order!.source_quote_id) && <option value={editor.order.source_quote_id}>{editor.order.subproject_name || '已保存的小项目'}（保留原关联）</option>}{subprojects.map(subproject => <option key={subproject.id} value={subproject.id}>{subproject.name}</option>)}</select></label><label>供应商<input aria-label="采购供应商" maxLength={100} value={editor.draft.supplier} onChange={event => change('supplier', event.target.value)}/></label><label>采购日期<input aria-label="采购日期" required type="date" value={editor.draft.date} onChange={event => change('date', event.target.value)}/></label></div></fieldset>{!projectOptions&&!subprojects.length && <p className="note">暂无可选择的报价小项目，请先进入本项目的报价页面新建小项目。已保存的采购单可保留原关联。</p>}{editor.order && !editor.order.source_quote_id && !editor.draft.source_quote_id && <p className="note">此历史采购单尚未关联报价小项目，选择项目名称后可作为该小项目的人工数量依据。</p>}<div className="purchaseItemsHead"><div className="purchaseCategoryImportBar"><div className="purchaseCategoryTabs" role="tablist" aria-label="采购费用分类">{(['材料费用','五金费用'] as PurchaseCategory[]).map(category=><button type="button" key={category} role="tab" aria-selected={purchaseCategory===category} className={purchaseCategory===category?'selected':''} disabled={editorDisabled} onClick={()=>{switchCategory(category);}}>{category}</button>)}</div><DocumentImport key={editor.createId} mode="purchase" defaultCategory={purchaseCategory} disabled={busy||loading} maxItems={200} currentItemCount={docItemCount} onApply={applyDocumentImport} onBusyChange={documentImportBusyChange}/><button type="button" disabled={editorDisabled || editor.draft.items.length >= 200} onClick={() => setEditor(current => current ? {...current, draft: {...current.draft, items: [...current.draft.items, newItem(purchaseCategory)]}} : current)}><Plus size={14}/>添加明细</button></div></div>{docImportNotice&&<p className="purchaseDocumentImportNotice" role="status">{docImportNotice}</p>}<fieldset className="catalogFields" disabled={editorDisabled}><CatalogSearch key={purchaseCategory} materials={materials} category={purchaseCategory} disabled={editorDisabled} loading={loading} error={error} onSelect={material=>setEditor(current=>{if(!current)return current;const items=[...current.draft.items],index=items.findIndex(item=>itemCategory(item)===purchaseCategory&&blankItem(item));const base=index>=0?items[index]:newItem(purchaseCategory);const chosen={...base,autoEmpty:false,expense_category:purchaseCategory,material_id:material.id,name:material.name,brand:material.brand,model:material.model,code:material.code,attribute:material.attribute,unit:material.unit,quantity:base.quantity||'1',price:String(material.purchase_price/100)};if(index>=0)items[index]=chosen;else if(items.length<200)items.push(chosen);return {...current,draft:{...current.draft,items}};})}/><div className="tableWrap purchaseEditorTable"><ManagedTable tableKey={"purchase/editor/"+purchaseCategory} preferenceScope={projectId + "/" + (editor.order?.id || "new")} onRowsReorder={reorderItems} disabled={editorDisabled}><thead><tr><th>材料名称</th><th>品牌</th><th>型号</th><th>代码</th><th>属性</th><th>单位</th><th>数量</th><th>单价（元）</th><th>金额</th><th>批次</th><th>操作</th></tr></thead><tbody>{editor.draft.items.filter(item=>itemCategory(item)===purchaseCategory).map((item, index) => <tr key={item.rowId} data-row-id={item.rowId}><td className="materialPickerCell"><input aria-label={'材料名称' + (index + 1)} value={item.name} required={!(item.autoEmpty&&blankItem(item)&&item.quantity==='')} maxLength={100} onFocus={event => openMaterialPicker(item.rowId, event.currentTarget)} onClick={event => openMaterialPicker(item.rowId, event.currentTarget)} onKeyDown={event => {if(event.key==='Escape'&&materialPicker?.rowId===item.rowId){event.preventDefault();setMaterialPicker(null);}}} onBlur={() => setMaterialPicker(current => current?.rowId === item.rowId ? null : current)} onChange={event => itemChange(item.rowId, 'name', event.target.value)}/>{materialPicker?.rowId === item.rowId && !editorDisabled && (() => {const list = materials.filter(material => !material.deleted && materialExpenseCategory(material) === purchaseCategory && pickerMatches(material, item.name)); return <div className="materialPickerPanel" role="dialog" aria-modal="true" aria-label="材料库下拉选择" style={{top: materialPicker.top, left: materialPicker.left, minWidth: materialPicker.width}}>{list.length ? list.map(material => <button type="button" key={material.id} onPointerDown={event => event.preventDefault()} onClick={() => {chooseMaterial(item.rowId, material.id); setMaterialPicker(null);}}><b>{material.name}</b><span>{[material.brand, material.model, material.code, material.unit].filter(Boolean).join(' · ')}</span></button>) : <p>没有匹配的材料，可直接输入名称。</p>}</div>;})()}</td><td><input aria-label={'材料品牌' + (index + 1)} value={item.brand} maxLength={100} onChange={event => itemChange(item.rowId, 'brand', event.target.value)}/></td><td><input aria-label={'材料型号' + (index + 1)} value={item.model} maxLength={100} onChange={event => itemChange(item.rowId, 'model', event.target.value)}/></td><td><input aria-label={'材料代码' + (index + 1)} value={item.code} maxLength={100} onChange={event => itemChange(item.rowId, 'code', event.target.value)}/></td><td><select aria-label={'材料属性' + (index + 1)} value={item.attribute} onChange={event => itemChange(item.rowId, 'attribute', event.target.value)}><option>主材</option><option>辅材</option><option>人工</option></select></td><td><input aria-label={'材料单位' + (index + 1)} required={!(item.autoEmpty&&blankItem(item)&&item.quantity==='')} maxLength={30} value={item.unit} onChange={event => itemChange(item.rowId, 'unit', event.target.value)}/></td><td><input aria-label={'采购数量' + (index + 1)} required={!(item.autoEmpty&&blankItem(item)&&item.quantity==='')} type="number" min="0.0001" max="1000000" step="0.0001" value={item.quantity} onBlur={()=>nextEmptyRow(item.rowId)} onChange={event => itemChange(item.rowId, 'quantity', event.target.value)}/></td><td className="purchasePriceCell">{(() => {const linked = materials.find(material => material.id === item.material_id); return linked && linked.sale_price > 0 ? <span className="purchaseSalePrice" title="材料库销售价">销售 {money(linked.sale_price)}</span> : null;})()}<input aria-label={'采购单价' + (index + 1)} required type="number" min="0" max="100000000" step="0.01" value={item.price} onChange={event => itemChange(item.rowId, 'price', event.target.value)}/></td><td className="catalogMoney">{purchaseDraftAmount(item.quantity,item.price)===null?'—':money(purchaseDraftAmount(item.quantity,item.price)!)}</td><td><input aria-label={'采购批次' + (index + 1)} maxLength={100} value={item.batch} onChange={event => itemChange(item.rowId, 'batch', event.target.value)}/></td><td><button type="button" aria-label={'删除采购明细行' + (index + 1)} disabled={editor.draft.items.length === 1} onClick={() => setEditor(current => current ? {...current, draft: {...current.draft, items: current.draft.items.filter(value => value.rowId !== item.rowId)}} : current)}><Trash2 size={14}/></button></td></tr>)}</tbody></ManagedTable></div><p className="purchaseDraftTotal">采购合计 <b>{total === null || !Number.isSafeInteger(total) ? '—' : money(total)}</b></p><p className="note">点击材料名称可直接从材料库下拉选择（自动带入品牌、型号、代码、属性、单位和采购价），也可手动输入新名称；本单可单独调整，已保存的材料明细保留当时内容。采购数量供所选小项目后续计算人工费用，按每项的单位保留，不合并不同单位。</p><label>采购备注<textarea aria-label="采购备注" maxLength={2000} value={editor.draft.note} onChange={event => change('note', event.target.value)}/></label>{formError && <p className="catalogError" role="alert">{formError}</p>}</fieldset></div></div><div className="modalFoot tableEditorFooter"><button type="button" disabled={editorDisabled} onClick={() => {if(!docImportTarget.current)setEditor(null);}}>取消</button><button className="primary" type="submit" disabled={editorDisabled || (!projectOptions&&!editor.order && !subprojects.length)}>{busy ? '保存中…' : '保存采购单'}</button></div></form></section></div>}
  </div>;
}
