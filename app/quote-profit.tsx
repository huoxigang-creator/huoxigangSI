'use client';

import {useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';
import {Printer,X} from 'lucide-react';
import {QUOTE_CATEGORIES,type QuoteCategory,type QuoteRoom} from '../lib/quotes';
import type {MaterialRecord} from '../lib/catalog-types';
import {quoteCostDetails,summarizeQuoteCostLines,type QuoteCostLine,type QuoteCostSummary,type QuoteProfitRawItem} from '../lib/quote-profit';
import ManagedTable from './managed-table';
import {visibleWorkspaceDialogs} from './workspace-active';
import './quote-profit.css';

export type QuoteProfitProps={name:string;budget:number;items:QuoteProfitRawItem[];rooms:QuoteRoom[];catalog:MaterialRecord[]|null;loading:boolean;error?:string;retry:()=>void;close:()=>void;companyName?:string;draft?:boolean;basis?:string};
const money=(value:number|null)=>value===null?'—':new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY'}).format(value/100);
const rate=(value:number|null)=>value===null?'—':(value*100).toFixed(2)+'%';
const subscribeToMount=()=>()=>{};
const clientMounted=()=>true;
const serverMounted=()=>false;
const basisText='成本＝明细数量 × 当前配置采购价（人工使用配置成本价）。估算毛利＝原报价额－估算成本，未扣优惠和抹零；不影响实际收付款利润。缺少成本时显示“—”，不按零成本计算毛利。';

export function buildProfitRooms(rooms:QuoteRoom[],lines:QuoteCostLine[]){
 const unassigned=lines.filter(line=>!line.item.room_id||!rooms.some(room=>room.id===line.item.room_id));
 return [...rooms.map(room=>({...room,lines:lines.filter(line=>line.item.room_id===room.id)})),...(unassigned.length||!rooms.length?[{id:'unassigned',name:rooms.length?'未分配空间':'整体空间',lines:unassigned}]:[])];
}

function Summary({summary,label,available}:{summary:QuoteCostSummary;label:string;available:boolean}){
 return <dl className="qpSummary" aria-label={label}><div><dt>{label}报价额</dt><dd>{money(summary.sales)}</dd></div><div><dt>估算成本</dt><dd>{money(available?summary.cost:null)}</dd></div><div><dt>估算毛利</dt><dd>{money(available?summary.margin:null)}</dd></div><div><dt>毛利率</dt><dd>{rate(available?summary.marginRate:null)}</dd></div></dl>;
}

function DetailTable({lines,available,print=false,preferenceScope='',disabled=false}:{lines:QuoteCostLine[];available:boolean;print?:boolean;preferenceScope?:string;disabled?:boolean}){
 const content=<><thead><tr><th>序号</th><th>名称 / 规格</th><th>数量</th><th>单位</th><th>销售单价</th><th>报价额</th><th>成本单价</th><th>成本额</th><th>毛利</th><th>毛利率</th></tr></thead><tbody>{lines.map((line,index)=><tr key={line.index} data-row-id={'profit-line-'+line.index} data-profit-row={line.index}><td>{index+1}</td><td><strong>{line.item.name||'未填写名称'}</strong>{line.item.model&&<small>{line.item.model}</small>}{line.item.note&&<small>备注：{line.item.note}</small>}{line.saleIssue&&<small className="qpLineIssue">{line.saleIssue}</small>}{available&&line.costIssue&&<small className="qpLineIssue">{line.costIssue}</small>}</td><td>{Number.isFinite(line.item.quantity)?line.item.quantity:'—'}</td><td>{line.item.unit||'—'}</td><td>{money(line.salePrice)}</td><td className="qpSales">{money(line.saleAmount)}</td><td>{money(available?line.costPrice:null)}</td><td>{money(available?line.costAmount:null)}</td><td>{money(available?line.margin:null)}</td><td>{rate(available?line.marginRate:null)}</td></tr>)}{!lines.length&&<tr key="empty" data-row-id="profit-empty"><td colSpan={10} className="qpEmpty">暂无{print?'此类别':''}明细</td></tr>}</tbody></>;
 return <div className="qpTableWrap">{print?<table className="qpTable">{content}</table>:<ManagedTable className="qpTable" tableKey="quote-profit/details" preferenceScope={preferenceScope} disabled={disabled}>{content}</ManagedTable>}</div>;
}

export default function QuoteProfit({name,budget,items,rooms,catalog,loading,error,retry,close,companyName,draft,basis}:QuoteProfitProps){
 const mounted=useSyncExternalStore(subscribeToMount,clientMounted,serverMounted);
 const details=useMemo(()=>quoteCostDetails(items,catalog||[]),[items,catalog]);
 const spaces=useMemo(()=>buildProfitRooms(rooms,details.lines),[rooms,details.lines]);
 const [selectedRoom,setSelectedRoom]=useState('all');
 const [category,setCategory]=useState<QuoteCategory>('柜体');
 const [printError,setPrintError]=useState('');
 const screenRef=useRef<HTMLElement>(null),closeRef=useRef<HTMLButtonElement>(null),closeLatest=useRef(close);
 const printActions=useRef<{begin:()=>void;end:()=>void}|null>(null);
 useEffect(()=>{closeLatest.current=close;},[close]);
 const available=!loading&&catalog!==null;
 const activeSpace=spaces.find(room=>room.id===selectedRoom);
 const shownLines=activeSpace?.lines||details.lines,shownName=activeSpace?.name||'整户';
 const shownSummary=summarizeQuoteCostLines(shownLines);
 const integrity=Number.isSafeInteger(budget)&&budget>=0&&details.summary.sales===budget;
 const entireSummary:QuoteCostSummary={...details.summary,sales:Number.isSafeInteger(budget)&&budget>=0?budget:null,margin:integrity?details.summary.margin:null,marginRate:integrity?details.summary.marginRate:null};
 const integrityError=integrity?'':'原报价合计与明细金额不一致或明细未填写完整，请核对后使用利润结果。';
 const loadIssue=error||(!loading&&catalog===null?'成本目录尚未加载，成本与毛利暂无法计算。':'');
 const unknownMessage=available&&details.summary.unknownCostCount?`${details.summary.unknownCostCount} 条明细缺少有效成本，相关成本、毛利及汇总显示 —。` : '';

 useEffect(()=>{
  const previousFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
  const previousOverflow=document.body.style.overflow;
  document.body.style.overflow='hidden';
  closeRef.current?.focus();
  let priorPrintFlag:string|null=null,printing=false;
  const begin=()=>{if(printing)return;printing=true;priorPrintFlag=document.body.getAttribute('data-quote-profit-print');document.body.setAttribute('data-quote-profit-print','true');};
  const end=()=>{if(!printing)return;printing=false;if(priorPrintFlag===null)document.body.removeAttribute('data-quote-profit-print');else document.body.setAttribute('data-quote-profit-print',priorPrintFlag);closeRef.current?.focus();};
  printActions.current={begin,end};
  const beforePrint=()=>begin(),afterPrint=()=>end();
  const printMedia=window.matchMedia?.('print');
  const mediaChange=(event:MediaQueryListEvent)=>{if(event.matches)begin();else end();};
  const keyboard=(event:KeyboardEvent)=>{
   if(event.defaultPrevented)return;
   if(event.key!=='Escape'&&event.key!=='Tab')return;
   const dialogs=visibleWorkspaceDialogs();
   if(dialogs[dialogs.length-1]!==screenRef.current)return;
   if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeLatest.current();return;}
   const targets=Array.from(screenRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],[tabindex="0"]')||[]);
   const first=targets[0],last=targets[targets.length-1];
   if(!first){event.preventDefault();return;}
   if(event.shiftKey&&(document.activeElement===first||!screenRef.current?.contains(document.activeElement))){event.preventDefault();last.focus();}
   else if(!event.shiftKey&&(document.activeElement===last||!screenRef.current?.contains(document.activeElement))){event.preventDefault();first.focus();}
  };
  window.addEventListener('keydown',keyboard,true);
  window.addEventListener('beforeprint',beforePrint);
  window.addEventListener('afterprint',afterPrint);
  printMedia?.addEventListener?.('change',mediaChange);
  return ()=>{window.removeEventListener('keydown',keyboard,true);window.removeEventListener('beforeprint',beforePrint);window.removeEventListener('afterprint',afterPrint);printMedia?.removeEventListener?.('change',mediaChange);end();printActions.current=null;document.body.style.overflow=previousOverflow;if(previousFocus?.isConnected)previousFocus.focus();};
 },[]);

 const print=()=>{setPrintError('');printActions.current?.begin();try{window.print();}catch{printActions.current?.end();setPrintError('无法打开打印，请重试。');}};
 if(!mounted)return null;
 return createPortal(<><main className="qpScreen" ref={screenRef} role="dialog" aria-modal="true" aria-labelledby="quote-profit-title"><header className="qpHeader"><div><h1 id="quote-profit-title">{name} · 利润报告</h1><p>{companyName||'报价利润分析'}{draft?' · 未保存草稿快照':''}</p></div><div className="qpHeaderActions"><button type="button" onClick={print} disabled={loading}><Printer size={17}/>打印利润报告</button><button type="button" ref={closeRef} onClick={close} aria-label="关闭利润报告"><X size={19}/>关闭</button></div></header><div className="qpWorkspace"><aside className="qpRooms" aria-label="利润房间"><h2>空间 / 房间</h2><button type="button" className={selectedRoom==='all'?'selected':''} aria-pressed={selectedRoom==='all'} onClick={()=>setSelectedRoom('all')}><span>整户总览</span><b>{money(entireSummary.sales)}</b></button>{spaces.map(room=><button type="button" key={room.id} className={selectedRoom===room.id?'selected':''} aria-pressed={selectedRoom===room.id} onClick={()=>setSelectedRoom(room.id)}><span>{room.name}</span><b>{money(summarizeQuoteCostLines(room.lines).sales)}</b></button>)}</aside><section className="qpMain"><div className="qpMainHead"><h2>{shownName}利润明细</h2><Summary summary={selectedRoom==='all'?entireSummary:shownSummary} label={shownName} available={available}/><p className="qpBasis">{basisText}{basis&&basis!==basisText?<span> {basis}</span>:null}</p>{loading&&<p className="qpLoading" role="status">正在加载当前配置成本…</p>}{loadIssue&&<div className="qpNotice" role="alert"><span>{loadIssue}</span><button type="button" onClick={retry} disabled={loading}>重新加载成本</button></div>}{unknownMessage&&<p className="qpNotice">{unknownMessage}</p>}{integrityError&&<p className="qpNotice" role="alert">{integrityError}</p>}{printError&&<p className="qpNotice" role="alert">{printError}</p>}</div><div className="qpCategoryTabs" role="tablist" aria-label="利润明细类别">{QUOTE_CATEGORIES.map(value=><button type="button" key={value} role="tab" aria-selected={category===value} className={category===value?'selected':''} onClick={()=>setCategory(value)}>{value}<span>{shownLines.filter(line=>line.item.category===value).length}</span></button>)}</div><div className="qpDetails" role="tabpanel" aria-label={category}><DetailTable lines={shownLines.filter(line=>line.item.category===category)} available={available} preferenceScope={JSON.stringify([name,selectedRoom,category])} disabled={loading}/><Summary summary={summarizeQuoteCostLines(shownLines.filter(line=>line.item.category===category))} label={category} available={available}/></div><div className="qpAllTotal"><Summary summary={entireSummary} label="整户" available={available}/></div></section></div></main><article className="qpPrint" aria-hidden="true"><header><h1>{name} · 利润报告</h1><p>{companyName}{draft?' · 未保存草稿快照':''}</p></header><p className="qpBasis">{basisText}</p>{loading&&<p>当前成本目录加载中，成本与毛利显示 —。</p>}{loadIssue&&<p className="qpNotice">{loadIssue}</p>}{unknownMessage&&<p className="qpNotice">{unknownMessage}</p>}{integrityError&&<p className="qpNotice">{integrityError}</p>}{spaces.map(room=><section className="qpPrintRoom" key={room.id}><h2>{room.name}</h2><Summary summary={summarizeQuoteCostLines(room.lines)} label={room.name} available={available}/>{QUOTE_CATEGORIES.map(value=>{const lines=room.lines.filter(line=>line.item.category===value);return lines.length?<section className="qpPrintCategory" key={value}><h3>{value}</h3><DetailTable lines={lines} available={available} print/><Summary summary={summarizeQuoteCostLines(lines)} label={value} available={available}/></section>:null;})}{!room.lines.length&&<p>暂无报价明细</p>}</section>)}<Summary summary={entireSummary} label="整户" available={available}/></article></>,document.body);
}

