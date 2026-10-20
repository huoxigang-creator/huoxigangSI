'use client';
import {useEffect, useRef, useState} from 'react';
import {Upload, X} from 'lucide-react';
import {hardwareImportInput, markHardwareDuplicates, parseHardwareFiles, type HardwareImportRow} from '../lib/hardware-import';
import type {MaterialRecord} from '../lib/catalog-types';
import {useWorkspaceActive} from './workspace-active';
import ManagedTable from './managed-table';
import './table-editor-dialog.css';

export default function HardwareImport({materials, onChanged, disabled}: {materials:MaterialRecord[];onChanged:()=>Promise<void>;disabled:boolean}) {
  const active=useWorkspaceActive();
  const [opened,setOpened] = useState(false), [rows,setRows] = useState<HardwareImportRow[]>([]), [busy,setBusy] = useState(false), [error,setError] = useState(''), [message,setMessage] = useState('');
  useEffect(()=>{
    if(!active||!opened)return;
    const previous=document.body.style.overflow;
    document.body.style.overflow='hidden';
    return()=>{document.body.style.overflow=previous;};
  },[active,opened]);
  const [priceKind,setPriceKind] = useState<'purchase_price'|'sale_price'>('purchase_price');
  const lock = useRef(false), frozen = useRef(false);
  const pending = rows.filter(row => row.selected && !row.saved && !row.duplicate);
  function update(id:string,key:string,value:string|boolean) {if(frozen.current) return;setRows(current=>current.map(row=>row.id===id?{...row,[key]:value,error:''}:row));}
  async function read(files:File[]) {
    if(lock.current || frozen.current || !files.length) return;
    lock.current=true;setBusy(true);setError('');setMessage('');
    try {setRows(markHardwareDuplicates(await parseHardwareFiles(files),materials));} catch(e) {setRows([]);setError(e instanceof Error?e.message:'读取失败');}
    finally {lock.current=false;setBusy(false);}
  }
  async function save() {
    if(lock.current || !pending.length) return;
    setError('');setMessage('');
    if(!frozen.current) {
      const checked = markHardwareDuplicates(pending,materials);
      if(checked.some(row=>row.duplicate)) {setRows(current=>current.map(row=>checked.find(item=>item.id===row.id)||row));setError('修改后的明细有重复项，已跳过，请核对后再次导入。');return;}
    }
    try {pending.forEach(row=>hardwareImportInput(row,priceKind));} catch(e) {setError(e instanceof Error?e.message:'请检查明细');return;}
    lock.current=true;frozen.current=true;setBusy(true);
    try {
      const response = await fetch('/api/hardware-import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:pending.map(row=>hardwareImportInput(row,priceKind))})});
      const body = await response.json() as {ok?:boolean;error?:string;results?:{id:string;ok:boolean;error?:string}[]};
      if(!response.ok || !body.ok || !body.results) throw Error(body.error||'导入失败，请重试');
      const results = body.results;
      setRows(current=>current.map(row=>{const result=results.find(item=>item.id===row.id);return result?{...row,saved:result.ok,error:result.error||''}:row;}));
      const success=results.filter(item=>item.ok).length, failed=results.length-success;
      setMessage(`本次已新增${success}条五金，失败${failed}条。${failed?'点击导入可重试失败项。':''}`);
    } catch(e) {setError((e instanceof Error?e.message:'导入失败')+'；保留原明细，可点击导入重试，已成功项不会重复新增。');}
    try {await onChanged();} catch {setError('导入结果已保留，列表刷新失败，请刷新页面核实。');}
    lock.current=false;setBusy(false);
  }
  return <><button type="button" disabled={disabled} onClick={()=>{setOpened(true);setRows([]);setError('');setMessage('');frozen.current=false;}}><Upload size={15}/>导入五金清单</button>{opened&&<div className="overlay catalogOverlay tableEditorOverlay"><section className="modal hardwareImportModal tableEditorDialog" role="dialog" aria-modal="true" aria-labelledby="hardware-import-title"><div className="modalHead tableEditorHeader"><h2 id="hardware-import-title">导入五金清单</h2><button type="button" aria-label="关闭五金导入" disabled={busy} onClick={()=>setOpened(false)}><X size={20}/></button></div><div className="formBody tableEditorBody"><p className="note">支持多选 Excel（xlsx、xls）或 CSV，每个文件最大10MB，每次最多500条。全部料单只读取成品五金、铝材和封边材料分段。名称、编码、规格、单位、品牌和备注直接填入新增五金；清单数量保存在备注中。</p><div className="hardwareImportControls"><label>选择清单文件<input aria-label="选择五金清单文件" type="file" multiple accept=".xlsx,.xls,.csv" disabled={busy||frozen.current} onChange={event=>{const files=Array.from(event.target.files||[]);event.target.value='';void read(files);}}/></label><label>文件单价导入到<select aria-label="五金导入价格用途" disabled={busy||frozen.current} value={priceKind} onChange={event=>setPriceKind(event.target.value as typeof priceKind)}><option value="purchase_price">采购价</option><option value="sale_price">销售价</option></select></label></div><p className="note">缺少价格的五金可以导入，价格字段暂为0，备注标记“价格待补充”。同编码或同名称、规格、单位的重复项自动跳过；如需新增不同五金，请修改编码或规格后重新导入。</p>{error&&<p className="catalogError" role="alert">{error}</p>}{message&&<p className="catalogMessage" role="status">{message}</p>}{busy&&<p role="status">正在处理，请稍候…</p>}{rows.length>0&&<><p>读取{rows.length}条 · 待导入{pending.length}条 · 重复{rows.filter(row=>row.duplicate).length}条</p><div className="tableWrap hardwareImportTable"><ManagedTable tableKey="hardware/import-editor" preferenceScope="hardware-catalog" allRowOrder={rows.map(row=>row.id)} disabled={busy||frozen.current} resizable><thead><tr><th data-column-key="hardware-import-selection" data-column-required data-column-fixed>导入</th><th>名称</th><th>编码</th><th>规格</th><th>单位</th><th>清单数量</th><th>单价（元）</th><th>状态 / 来源</th></tr></thead><tbody>{rows.map(row=><tr key={row.id} data-row-id={row.id}><td><input type="checkbox" aria-label={`导入${row.name}`} checked={row.selected&&!row.duplicate} disabled={busy||frozen.current||row.duplicate} onChange={event=>update(row.id,'selected',event.target.checked)}/></td>{(['name','code','model','unit'] as const).map(key=><td key={key}><input aria-label={`${row.source} ${key}`} value={row[key]} disabled={busy||frozen.current||row.duplicate} onChange={event=>update(row.id,key,event.target.value)}/></td>)}<td>{row.quantity||'—'}</td><td><input aria-label={`${row.name}导入单价`} placeholder="待补价" value={row.price} disabled={busy||frozen.current||row.duplicate} onChange={event=>update(row.id,'price',event.target.value)}/></td><td><strong>{row.saved?'已导入':row.duplicate?'重复，已跳过':row.error||'待导入'}</strong><small className="block muted">{row.source}</small></td></tr>)}</tbody></ManagedTable></div></>}</div><div className="modalFoot tableEditorFooter"><button type="button" disabled={busy} onClick={()=>setOpened(false)}>关闭</button><button type="button" className="primary" disabled={busy||!pending.length} onClick={()=>void save()}>{busy?'导入中…':`确认新增${pending.length}条五金`}</button></div></section></div>}</>;
}
