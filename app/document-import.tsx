'use client';

import {useEffect,useId,useRef,useState,type KeyboardEvent} from 'react';
import {createPortal} from 'react-dom';
import {QUOTE_CATEGORIES,type QuoteCategory} from '../lib/quotes';
import {documentImportNumber,documentImportRowIssues,validateDocumentImportRows,mapDocumentTable,type DocumentImportRow,type DocumentImportPreview,type DocumentImportTable,type DocumentImportField} from '../lib/document-import';
import {readDocumentFiles} from '../lib/document-scan';
import {catalogPriceCents,purchaseItemAmount} from '../lib/catalog-types';
import ManagedTable from './managed-table';
import './document-import.css';
import './table-editor-dialog.css';

export type DocumentImportProps={mode:'quote'|'purchase';defaultCategory:QuoteCategory;disabled?:boolean;requestOpen?:number;maxItems:number;currentItemCount:number;onApply:(rows:DocumentImportRow[])=>void;onBusyChange?:(busy:boolean)=>void};
const ACCEPT='.jpg,.jpeg,.png,.webp,.pdf,.xlsx,.xls,.csv,.txt,.tsv,.docx';
const EXTENSIONS=new Set(ACCEPT.split(',').map(value=>value.slice(1)));
const FILE_LIMIT=10*1024*1024,TOTAL_LIMIT=25*1024*1024;
type Session={mode:'quote'|'purchase';defaultCategory:QuoteCategory};
const CORE_MAPPING:[DocumentImportField,string][]=[['name','名称'],['model','规格'],['quantity','数量'],['unit','单位'],['price','单价（可留空）']];
const OTHER_MAPPING:[DocumentImportField,string][]=[['brand','品牌'],['code','编码'],['attribute','属性'],['batch','批次'],['category','费用类别'],['sourceAmount','识别原金额'],['note','备注']];
const IMPORT_VALIDATION={allowMissingPrice:true};
function tableStart(table:DocumentImportTable){return String((table.headerRow??-1)+2);}
function columnCaption(table:DocumentImportTable,index:number){const header=table.headerRow===null?'':table.cells[table.headerRow]?.[index]?.trim(),sample=header||table.cells.slice(0,3).map(cells=>cells[index]||'').filter(Boolean).join(' / ');return '第 '+(index+1)+' 列'+(sample?' · '+sample.slice(0,75):'');}
function fileIssues(files:File[]){
 if(!files.length)throw new Error('请先选择需要识别的文件。');
 if(files.length>5)throw new Error('每次最多识别5个文件，请减少文件后重试。');
 for(const file of files){if(!EXTENSIONS.has(file.name.split('.').pop()?.toLowerCase()||''))throw new Error('不支持“'+file.name+'”。请选择图片、PDF、Excel、CSV、TXT、TSV或Word DOCX文件。');if(file.size<=0)throw new Error('“'+file.name+'”为空文件，请重新选择。');if(file.size>FILE_LIMIT)throw new Error('“'+file.name+'”超过10MB，请缩小文件后重试。');}
 if(files.reduce((total,file)=>total+file.size,0)>TOTAL_LIMIT)throw new Error('所选文件合计超过25MB，请分批识别。');
}
function calculatedAmount(row:DocumentImportRow,mode:Session['mode']){const quantity=documentImportNumber(row.quantity),price=documentImportNumber(row.price,true);if(quantity===null||price===null)return null;if(mode==='purchase'){try{return purchaseItemAmount(quantity,catalogPriceCents(price));}catch{return null;}}const amount=Math.round(quantity*Math.round(price*100));return Number.isSafeInteger(amount)&&amount>=0?amount:null;}
function money(cents:number){return '¥'+(cents/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});}
function userError(reason:unknown,fallback:string){const message=reason instanceof Error?reason.message.split(/\r?\n/)[0].replace(/^Error:\s*/,'').trim():'';return /[\u3400-\u9fff]/.test(message)?message.slice(0,600):fallback;}

/** Recognition and edits stay in this preview. Only the explicit copy action returns selected draft rows. */
export default function DocumentImport({mode,defaultCategory,disabled=false,requestOpen=0,maxItems,currentItemCount,onApply,onBusyChange}:DocumentImportProps){
 const [open,setOpen]=useState(false),[phase,setPhase]=useState<'idle'|'reading'|'preview'|'error'>('idle');
 const [preview,setPreview]=useState<DocumentImportPreview|null>(null),[rows,setRows]=useState<DocumentImportRow[]>([]),[error,setError]=useState('');
 const [progress,setProgress]=useState(0),[progressMessage,setProgressMessage]=useState(''),[costConsent,setCostConsent]=useState(false);
 const [activeSession,setActiveSession]=useState<Session|null>(null),[sourceNames,setSourceNames]=useState<string[]>([]);
 const [mappingOpen,setMappingOpen]=useState(false),[activeTableId,setActiveTableId]=useState(''),[columnMapping,setColumnMapping]=useState<DocumentImportTable['mapping']>({}),[dataStartRow,setDataStartRow]=useState('1'),[mappingNotice,setMappingNotice]=useState('');
 const [mappingDirty,setMappingDirty]=useState(false);
 const inputRef=useRef<HTMLInputElement>(null),buttonRef=useRef<HTMLButtonElement>(null),dialogRef=useRef<HTMLDivElement>(null);
 const controllerRef=useRef<AbortController|null>(null),runRef=useRef(0),filesRef=useRef<File[]>([]),busyCallback=useRef(onBusyChange);
 const handledOpenRequest=useRef(0);
 const id=useId(),titleId=id+'-title',descriptionId=id+'-description';
 const session=activeSession||{mode,defaultCategory},purchase=session.mode==='purchase',reading=phase==='reading';
 const categories:readonly QuoteCategory[]=purchase?['材料费用','五金费用']:QUOTE_CATEGORIES;
 const selected=rows.filter(row=>row.selected),rowIssues=rows.map(row=>documentImportRowIssues(row,session.mode,IMPORT_VALIDATION));
 const validation=preview?validateDocumentImportRows(rows,session.mode,IMPORT_VALIDATION):[];
 const available=Math.max(0,maxItems-currentItemCount),limitError=selected.length>available?'当前列表已有'+currentItemCount+'条，本次选择'+selected.length+'条，合计超过'+maxItems+'条。请取消部分勾选后再复制。':'';
 const needsCostConsent=!purchase&&selected.some(row=>row.price.trim())&&(preview?.priceKind==='cost'||Boolean(preview?.tables?.some(table=>table.priceKind==='cost'&&selected.some(row=>row.tableId===table.id&&row.price.trim()))));
 const missingPrices=selected.filter(row=>!row.price.trim()).length;
 const tables=preview?.tables||[],activeTable=tables.find(table=>table.id===activeTableId)||tables[0];
 const columnCount=activeTable?Math.max(0,...activeTable.cells.map(cells=>cells.length)):0;
 const duplicateKeys=new Map<string,number[]>();rows.forEach((row,index)=>{const key=JSON.stringify([row.category,row.name.trim(),row.model.trim(),row.unit.trim(),row.quantity,row.price,row.brand,row.code,row.attribute,row.batch]);const indexes=duplicateKeys.get(key)||[];indexes.push(index);duplicateKeys.set(key,indexes);});
 const duplicateIndexes=new Set([...duplicateKeys.values()].filter(indexes=>indexes.length>1).flat());
 const differences=rows.flatMap((row,index)=>{const amount=calculatedAmount(row,session.mode),source=documentImportNumber(row.sourceAmount,true);return row.selected&&amount!==null&&source!==null&&Math.round(source*100)!==amount?['第'+(index+1)+'行：识别原金额'+money(Math.round(source*100))+'，当前数量×单价为'+money(amount)+'，请核对差异。']:[];});
 const canApply=!!preview&&!disabled&&!reading&&!mappingDirty&&!validation.length&&!limitError&&selected.length>0&&(!needsCostConsent||costConsent);

 function close(){controllerRef.current?.abort();controllerRef.current=null;runRef.current++;filesRef.current=[];setActiveSession(null);setSourceNames([]);setOpen(false);setPhase('idle');setPreview(null);setRows([]);setError('');setCostConsent(false);setMappingNotice('');setMappingOpen(false);setMappingDirty(false);}
 useEffect(()=>{if(requestOpen<=0||handledOpenRequest.current===requestOpen||disabled||open)return;handledOpenRequest.current=requestOpen;buttonRef.current?.focus();inputRef.current?.click();},[requestOpen,disabled,open]);
 useEffect(()=>{busyCallback.current=onBusyChange;},[onBusyChange]);
 useEffect(()=>{if(!open)return;busyCallback.current?.(true);const overflow=document.body.style.overflow,launch=buttonRef.current;document.body.style.overflow='hidden';dialogRef.current?.focus();return()=>{busyCallback.current?.(false);document.body.style.overflow=overflow;launch?.focus();};},[open]);
 useEffect(()=>()=>{controllerRef.current?.abort();runRef.current++;},[]);
 function trapFocus(event:KeyboardEvent<HTMLDivElement>){
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}
  if(event.key!=='Tab')return;
  const dialog=dialogRef.current;if(!dialog)return;
  const focusable=[...dialog.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])')].filter(element=>!element.hidden&&element.getAttribute('aria-hidden')!=='true');
  const first=focusable[0],last=focusable.at(-1),active=document.activeElement;
  if(!first){event.preventDefault();dialog.focus();return;}
  if(event.shiftKey&&(active===first||active===dialog||!dialog.contains(active))){event.preventDefault();last?.focus();}else if(!event.shiftKey&&(active===last||!dialog.contains(active))){event.preventDefault();first.focus();}
 }
 async function begin(files:File[]){
  if(!open&&disabled)return;
  controllerRef.current?.abort();const controller=new AbortController(),run=++runRef.current;controllerRef.current=controller;filesRef.current=files;
  const captured=activeSession||{mode,defaultCategory};setActiveSession(captured);setSourceNames(files.map(file=>file.name));
  setOpen(true);setPhase('reading');setError('');setPreview(null);setRows([]);setCostConsent(false);setMappingOpen(false);setMappingNotice('');setMappingDirty(false);setProgress(0);setProgressMessage('准备读取文件…');
  try{
   fileIssues(files);
   const result=await readDocumentFiles(files,{mode:captured.mode,defaultCategory:captured.defaultCategory,signal:controller.signal,onProgress:(message,value)=>{if(runRef.current===run&&!controller.signal.aborted){setProgressMessage(message);setProgress(Number.isFinite(value)?Math.min(100,Math.max(0,value)):0);}}});
   if(runRef.current!==run||controller.signal.aborted)return;
   setPreview(result);setRows(result.rows.map(row=>({...row})));const first=result.tables?.[0];setActiveTableId(first?.id||'');setColumnMapping({...first?.mapping});setDataStartRow(first?tableStart(first):'1');setMappingOpen(Boolean(first&&(['name','model','quantity','unit'] as DocumentImportField[]).some(field=>first.mapping[field]===undefined)));setPhase('preview');setProgress(100);
  }catch(reason){if(runRef.current!==run||controller.signal.aborted)return;setError(userError(reason,'文件识别失败，请检查文件是否损坏，或改用更清晰的图片后重试。'));setPhase('error');}
  finally{if(runRef.current===run)controllerRef.current=null;}
 }
 function update(index:number,change:Partial<DocumentImportRow>){setRows(current=>current.map((row,rowIndex)=>rowIndex===index?{...row,...change}:row));setError('');}
 function chooseTable(id:string){const table=tables.find(value=>value.id===id);if(!table)return;setActiveTableId(id);setColumnMapping({...table.mapping});setDataStartRow(tableStart(table));setMappingNotice('');setMappingDirty(false);setError('');}
 function changeMapping(field:DocumentImportField,value:string){setColumnMapping(current=>{const next={...current};if(value==='')delete next[field];else next[field]=Number(value);return next;});setMappingNotice('');setMappingDirty(true);setError('');}
 function applyMapping(){
  if(!activeTable||!preview||disabled||reading)return;
  try{
   const result=mapDocumentTable(activeTable,columnMapping,Number(dataStartRow)-1,{mode:session.mode,defaultCategory:session.defaultCategory,source:activeTable.source});
   const firstIndex=rows.findIndex(row=>row.tableId===activeTable.id),retained=rows.filter(row=>row.tableId!==activeTable.id),insertAt=firstIndex<0?retained.length:rows.slice(0,firstIndex).filter(row=>row.tableId!==activeTable.id).length;
   const nextRows=[...retained.slice(0,insertAt),...result.rows.map(row=>({...row})),...retained.slice(insertAt)],updatedTable=result.tables?.[0]||{...activeTable,mapping:{...columnMapping}},nextTables=tables.map(table=>table.id===activeTable.id?updatedTable:table),kinds=new Set(nextTables.map(table=>table.priceKind));
   setRows(nextRows);setPreview({...preview,rows:nextRows,tables:nextTables,priceKind:kinds.has('cost')?'cost':kinds.size===1?nextTables[0].priceKind:'unknown',warnings:[...new Set([...preview.warnings,...result.warnings])]});setColumnMapping({...updatedTable.mapping});setCostConsent(false);setMappingDirty(false);setError('');setMappingNotice('已按栏目对应重新生成本表 '+result.rows.length+' 条预览明细，请在下方核对名称、规格、数量和单位。其他来源与原草稿保持完整。');
  }catch(reason){setError(userError(reason,'栏目对应失败，请核对原始列和起始行。'));}
 }
 function apply(){if(!canApply)return;try{onApply(selected.map(row=>({...row})));close();}catch(reason){setError(userError(reason,'复制失败，请重试。'));}}
 const picker=<><button ref={buttonRef} type="button" className="diUploadButton" title="识别图片或文件中的明细" disabled={disabled||open} onClick={()=>inputRef.current?.click()}>上传识别</button><input ref={inputRef} type="file" multiple accept={ACCEPT} className="diFileInput" disabled={disabled&&!open} aria-label="选择需要识别的明细文件" onChange={event=>{const files=Array.from(event.currentTarget.files||[]);event.currentTarget.value='';if(files.length)void begin(files);}}/></>;
 if(!open||typeof document==='undefined')return picker;
 const priceLabel=purchase?'采购单价':'销售单价';
 const dialog=<div className="diOverlay tableEditorOverlay"><div ref={dialogRef} className={'diDialog tableEditorDialog'+(purchase?' diPurchaseDialog':'')} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1} onKeyDown={trapFocus}>
  <div className="diHeader tableEditorHeader"><div><span>{purchase?'采购明细':'报价明细'}</span><h2 id={titleId}>{reading?'正在识别文件':'核对识别明细'}</h2></div><button type="button" aria-label="关闭文件识别预览" onClick={close}>×</button></div>
  <div className="diBody tableEditorBody"><p id={descriptionId} className="diDescription">文件在当前浏览器内识别。请核对明细，勾选后复制到下方列表。</p><p className="diFileLimits">图片 JPG/PNG/WebP、PDF、Excel、CSV、TXT、TSV、Word DOCX；最多5个文件，每个10MB，合计25MB；PDF累计最多10页。</p>
   <p className="diSources">{sourceNames.join(' · ')}</p>
   {reading?<div className="diProgress" role="status" aria-live="polite"><b>{progressMessage||'正在识别…'}</b><progress max={100} value={progress} aria-label="文件识别进度"/><span>{Math.round(progress)}%</span><p>识别过程中可以取消；原列表明细会保留。</p></div>:null}
   {error?<div className="diError" role="alert">{error}</div>:null}
   {phase==='error'?<div className="diRetry"><p>可重新选择文件，或重试本次识别。</p><button type="button" onClick={()=>inputRef.current?.click()}>重新选择文件</button><button type="button" onClick={()=>void begin(filesRef.current)}>重新识别</button></div>:null}
   {preview&&phase==='preview'?<>
    {tables.length>0&&<section className="diMapping"><div className="diMappingHeading"><button type="button" aria-expanded={mappingOpen} aria-controls={id+'-mapping'} onClick={()=>setMappingOpen(value=>!value)}>栏目对应</button><p>识别名称有错字，可直接修改下方名称；规格、数量或单位为空时，可在这里选择原文件对应列。</p></div>{mappingOpen&&activeTable&&<div id={id+'-mapping'} className="diMappingBody"><div className="diMappingSource"><label>选择来源表<select aria-label="栏目来源" value={activeTable.id} disabled={disabled||reading} onChange={event=>chooseTable(event.target.value)}>{tables.map((table,index)=><option key={table.id} value={table.id}>{index+1}. {table.source}</option>)}</select></label><label>数据起始行<input aria-label="数据起始行" type="number" min={1} max={activeTable.cells.length+1} step={1} value={dataStartRow} disabled={disabled||reading} onChange={event=>{setDataStartRow(event.target.value);setMappingNotice('');setMappingDirty(true);setError('');}}/></label></div><p className="diMappingHelp">先对照原文，再将原始列对应到软件栏位。起始行包含第一条明细，表头不作为明细复制。</p><div className="diRawTableScroll"><table className="diRawTable"><caption>原文件前 {Math.min(activeTable.cells.length,8)} 行</caption><thead><tr><th>原行号</th>{Array.from({length:columnCount},(_,index)=><th key={index}>第 {index+1} 列</th>)}</tr></thead><tbody>{activeTable.cells.slice(0,8).map((cells,index)=><tr key={index} className={index===activeTable.headerRow?'diRawHeader':''}><th>{index+1}{index===activeTable.headerRow?' · 表头':''}</th>{Array.from({length:columnCount},(_,column)=><td key={column}>{cells[column]||'—'}</td>)}</tr>)}</tbody></table></div><div className="diMappingGrid">{CORE_MAPPING.map(([field,caption])=><label key={field}>{caption}<select aria-label={'对应'+caption+'列'} value={columnMapping[field]??''} disabled={disabled||reading} onChange={event=>changeMapping(field,event.target.value)}><option value="">不对应</option>{Array.from({length:columnCount},(_,index)=><option key={index} value={index}>{columnCaption(activeTable,index)}</option>)}</select></label>)}</div><details className="diMappingOther"><summary>更多栏目（品牌、编码、备注等）</summary><div className="diMappingGrid">{OTHER_MAPPING.map(([field,caption])=><label key={field}>{caption}<select aria-label={'对应'+caption+'列'} value={columnMapping[field]??''} disabled={disabled||reading} onChange={event=>changeMapping(field,event.target.value)}><option value="">不对应</option>{Array.from({length:columnCount},(_,index)=><option key={index} value={index}>{columnCaption(activeTable,index)}</option>)}</select></label>)}</div></details><div className="diMappingActions"><span>应用后仅更新本来源的识别预览；其他文件和原列表内容保留。</span><button type="button" className="primary" disabled={disabled||reading} onClick={applyMapping}>应用栏目对应</button></div>{mappingNotice&&<p className="diMappingNotice" role="status">{mappingNotice}</p>}</div>}</section>}
    {mappingDirty?<p className="diWarning">栏目对应已调整，请先点击“应用栏目对应”更新下方预览，再复制。</p>:null}
    {missingPrices>0?<p className="diWarning">有 {missingPrices} 条未填写单价，可以先复制名称、规格、数量和单位到草稿，价格会保留空白，请在保存前补齐。</p>:null}
    {preview.priceKind==='unknown'?<p className="diWarning">未明确识别单价类型，请逐行核对{priceLabel}。</p>:purchase&&preview.priceKind==='sales'?<p className="diWarning">文件识别为销售单价，请核对是否适用于本次采购。</p>:null}
    {needsCostConsent?<div className="diCostWarning"><p>文件识别为采购或成本单价。复制到报价前，请确认这些价格可以作为销售单价。</p><label className="diCostConsent"><input type="checkbox" checked={costConsent} onChange={event=>setCostConsent(event.target.checked)}/>将识别的采购单价用作销售单价</label></div>:null}
    {preview.warnings.length?<details className="diWarnings" open><summary>识别提示（{preview.warnings.length}条）</summary><ul>{preview.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul></details>:null}
    {duplicateIndexes.size?<p className="diWarning">存在重复明细，已标出供核对；确认是真实重复项目时可以保留。</p>:null}
    {differences.length?<details className="diWarnings diCurrentDifferences" open><summary>当前金额差异（{differences.length}条）</summary><ul>{differences.map((warning,index)=><li key={index}>{warning}</li>)}</ul></details>:null}
    <div className="diSelection"><label><input type="checkbox" aria-label="选择全部识别明细" checked={rows.length>0&&rows.every(row=>row.selected)} disabled={!rows.length} onChange={event=>setRows(current=>current.map(row=>({...row,selected:event.target.checked})))}/>全选</label><span>识别{rows.length}条 · 已选{selected.length}条 · 当前列表{currentItemCount}条 · 可再加入{available}条</span></div>
    {!rows.length?<p className="diEmpty">未识别到可复制的明细。请尝试更清晰的图片或带有表头的文件。</p>:<div className="diTableScroll"><ManagedTable tableKey={'document-import/'+session.mode} preferenceScope={'recognition-preview'} disabled={disabled||reading} className={purchase?'diPreviewTable diPurchaseTable':'diPreviewTable'}><thead><tr><th data-column-key="document-selection" data-column-required data-column-fixed>选择</th><th>费用类别</th><th>名称</th><th>规格</th>{purchase?<><th>品牌</th><th>代码</th><th>属性</th><th>批次</th></>:null}<th>单位</th><th>数量</th><th>{priceLabel}（元）</th><th>识别原金额（元）</th><th>当前计算金额（元）</th><th>备注</th><th>来源 / 提示</th></tr></thead><tbody>{rows.map((row,index)=>{
     const label='第'+(index+1)+'行',issues=rowIssues[index],amount=calculatedAmount(row,session.mode),source=documentImportNumber(row.sourceAmount,true),difference=source!==null&&amount!==null&&Math.round(source*100)!==amount,issueId=id+'-row-'+index+'-issues';
     const field=(name:keyof DocumentImportRow,caption:string,inputMode?:'decimal',optional=false)=><input type="text" inputMode={inputMode} aria-label={label+' '+caption} aria-invalid={row.selected&&issues.length?true:undefined} aria-describedby={row.selected&&issues.length?issueId:undefined} value={String(row[name]??'')} placeholder={inputMode?(optional?'可留空':'待核对'):undefined} onChange={event=>update(index,{[name]:event.target.value})}/>;
     return <tr key={row.id+'-'+index} data-row-id={row.id+'-'+index} className={row.selected?'diRowSelected':'diRowUnselected'}><td><input type="checkbox" aria-label={'选择'+label+' '+row.name} checked={row.selected} onChange={event=>update(index,{selected:event.target.checked})}/><small>{index+1}</small></td><td><select aria-label={label+' 费用类别'} value={row.category} onChange={event=>update(index,{category:event.target.value as QuoteCategory})}>{categories.map(category=><option key={category} value={category}>{category}</option>)}</select></td><td>{field('name','名称')}</td><td>{field('model','规格')}</td>{purchase?<><td>{field('brand','品牌')}</td><td>{field('code','代码')}</td><td><select aria-label={label+' 属性'} value={row.attribute} onChange={event=>update(index,{attribute:event.target.value as DocumentImportRow['attribute']})}>{['主材','辅材','人工'].map(attribute=><option key={attribute}>{attribute}</option>)}</select></td><td>{field('batch','批次')}</td></>:null}<td>{field('unit','单位')}</td><td>{field('quantity','数量','decimal')}</td><td>{field('price',priceLabel,'decimal',true)}</td><td className="diAmount">{field('sourceAmount','识别原金额','decimal',true)}</td><td className={'diAmount'+(difference?' diDifference':'')}>{amount===null?'待核对':money(amount)}{difference?<small>与识别原金额不同</small>:null}</td><td>{field('note','备注')}</td><td className="diSourceCell"><span>{row.source}</span>{typeof row.confidence==='number'?<small>识别可信度{Math.round(row.confidence)}%</small>:null}{duplicateIndexes.has(index)?<small className="diDifference">重复明细，请核对</small>:null}{row.selected&&issues.length?<ul id={issueId} className="diRowIssues">{issues.map((issue,issueIndex)=><li key={issueIndex}>{issue}</li>)}</ul>:null}</td></tr>;
    })}</tbody></ManagedTable></div>}
    <p className="diCalculationNote">识别原金额仅供对照，复制后的金额按核对后的数量和单价计算。</p>
    {validation.length?<div className="diValidation" role="status"><b>请先补齐或取消勾选以下明细</b><ul>{validation.map((issue,index)=><li key={index}>{issue}</li>)}</ul></div>:null}
    {limitError?<p className="diError" role="alert">{limitError}</p>:null}
   </>:null}
  </div>
  <div className="diFooter tableEditorFooter"><span>{reading?'取消后停止本次识别':preview?'核对后仅复制到当前草稿列表':'识别失败不会改变原列表'}</span><div>{preview&&!reading?<button type="button" onClick={()=>inputRef.current?.click()}>重新选择文件</button>:null}<button type="button" onClick={close}>{reading?'取消识别':'取消导入'}</button>{preview&&!reading?<button type="button" className="primary diApply" disabled={!canApply} onClick={apply}>复制到下方列表</button>:null}</div></div>
 </div></div>;
 return <>{picker}{createPortal(dialog,document.body)}</>;
}
