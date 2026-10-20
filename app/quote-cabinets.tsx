'use client';

import {useState,type FormEvent} from 'react';
import {Check,ChevronDown,Pencil,Plus,PanelsTopLeft,Trash2,X} from 'lucide-react';
import './quote-cabinets.css';

export type QuoteCabinet={id:string;room_id:string;name:string};
export const CABINET_PRESETS=['衣柜','鞋柜','酒柜','地柜','吊柜','电视柜','书柜','餐边柜','浴室柜','自定义'];
type CabinetLine={cabinet_id?:string;quantity:number|'';price:number|''};
const amount=(items:CabinetLine[])=>items.reduce((sum,item)=>sum+(Number.isFinite(item.quantity)&&Number.isFinite(item.price)?Math.round(Number(item.quantity)*Math.round(Number(item.price)*100)):0),0);
const money=(cents:number)=>new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY'}).format(cents/100);

export function QuoteCabinetButton({expanded,selectedName,count,disabled,onClick,panelId}:{expanded:boolean;selectedName?:string;count:number;disabled:boolean;onClick:()=>void;panelId:string}) {
  return <button type="button" className={'qwCabinetToggle '+(expanded?'expanded':'')} aria-expanded={expanded} aria-controls={panelId} disabled={disabled} onClick={onClick}><PanelsTopLeft size={14}/>柜体{selectedName&&<b>{selectedName}</b>}<span>{count}</span><ChevronDown size={13}/></button>;
}

export default function QuoteCabinets({id,roomName,cabinets,items,selected,onSelect,disabled=false,editable=false,onAdd,onRename,onRemove,onEdit,onClose}:{
  id:string;roomName:string;cabinets:QuoteCabinet[];items:CabinetLine[];selected:string;onSelect:(id:string)=>void;disabled?:boolean;editable?:boolean;
  onAdd?:(name:string)=>boolean;onRename?:(id:string,name:string)=>boolean;onRemove?:(id:string)=>void;onEdit?:()=>void;onClose:()=>void;
}) {
  const [adding,setAdding]=useState(false),[preset,setPreset]=useState(CABINET_PRESETS[0]),[custom,setCustom]=useState(''),[editing,setEditing]=useState(''),[name,setName]=useState(''),[error,setError]=useState('');
  const publicItems=items.filter(item=>!item.cabinet_id||!cabinets.some(cabinet=>cabinet.id===item.cabinet_id));
  function add(event:FormEvent){event.preventDefault();if(disabled)return;const value=(preset==='自定义'?custom:preset).trim();if(!value){setError('请填写柜体名称。');return;}if(onAdd?.(value)){setAdding(false);setCustom('');setError('');}else setError('当前房间已存在此柜体名称，请填写其他名称。');}
  function rename(event:FormEvent,id:string){event.preventDefault();if(disabled)return;if(!name.trim()){setError('请填写柜体名称。');return;}if(onRename?.(id,name.trim())){setEditing('');setError('');}else setError('当前房间已存在此柜体名称，请填写其他名称。');}
  return <section id={id} className="qwCabinetPanel" aria-label={roomName+'柜体'} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(editing)setEditing('');else if(adding)setAdding(false);else onClose();}}}>
    <header><div><h4>{roomName} · 柜体</h4><p>选择柜体后，分别填写人工、材料和五金费用。</p></div><div>{(editable||onEdit)&&<button type="button" disabled={disabled} onClick={()=>{if(editable){setAdding(true);setError('');}else onEdit?.();}}><Plus size={13}/>添加柜体</button>}<button type="button" aria-label="收起柜体列表" disabled={disabled} onClick={onClose}><X size={15}/></button></div></header>
    {editable&&adding&&<div className="qwCabinetAddForm" onKeyDown={event=>{if(event.key==='Enter'&&(event.target instanceof HTMLInputElement||event.target instanceof HTMLSelectElement))add(event);}}><label>柜体类型<select aria-label="选择柜体类型" disabled={disabled} value={preset} onChange={event=>setPreset(event.target.value)}>{CABINET_PRESETS.map(value=><option key={value}>{value}</option>)}</select></label>{preset==='自定义'&&<label>柜体名称<input aria-label="自定义柜体名称" disabled={disabled} maxLength={50} autoFocus value={custom} onChange={event=>setCustom(event.target.value)}/></label>}<div><button type="button" disabled={disabled} onClick={()=>{setAdding(false);setError('');}}>取消</button><button type="button" disabled={disabled} className="primary" onClick={event=>add(event)}>确认添加</button></div></div>}
    <div className="qwCabinetList" role="list" aria-label={roomName+'柜体列表'}>
      <div className={'qwCabinetCard qwCabinetPublic '+(!selected?'selected':'')} role="listitem"><button type="button" className="qwCabinetSelect" aria-current={!selected?'true':undefined} disabled={disabled} onClick={()=>{onSelect('');setEditing('');setError('');}}><strong>房间公共明细</strong><span>{publicItems.length} 条明细</span><b>{money(amount(publicItems))}</b></button></div>
      {cabinets.map(cabinet=>{const lines=items.filter(item=>item.cabinet_id===cabinet.id);return <div key={cabinet.id} role="listitem" className={'qwCabinetCard '+(selected===cabinet.id?'selected':'')}>{editing===cabinet.id?<div className="qwCabinetRename"><input aria-label={'重命名柜体 '+cabinet.name} disabled={disabled} autoFocus maxLength={50} value={name} onChange={event=>setName(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')rename(event,cabinet.id);}}/><button type="button" disabled={disabled} aria-label="保存柜体名称" onClick={event=>rename(event,cabinet.id)}><Check size={14}/></button><button type="button" disabled={disabled} aria-label="取消柜体重命名" onClick={()=>setEditing('')}><X size={14}/></button></div>:<><button type="button" className="qwCabinetSelect" aria-current={selected===cabinet.id?'true':undefined} disabled={disabled} onClick={()=>{onSelect(cabinet.id);setError('');}}><strong>{cabinet.name}</strong><span>{lines.length} 条明细</span><b>{money(amount(lines))}</b></button>{editable&&<div className="qwCabinetTools"><button type="button" disabled={disabled} aria-label={'重命名柜体 '+cabinet.name} onClick={()=>{setEditing(cabinet.id);setName(cabinet.name);setError('');}}><Pencil size={12}/></button><button type="button" disabled={disabled} aria-label={'删除柜体 '+cabinet.name} onClick={()=>onRemove?.(cabinet.id)}><Trash2 size={12}/></button></div>}</>}</div>;})}
    </div>
    {!cabinets.length&&<p className="qwCabinetHint">{editable?'可添加衣柜、鞋柜、酒柜、地柜、吊柜等柜体，或自定义名称。':'此房间暂未添加柜体，明细保留在“房间公共明细”中。'}</p>}
    {error&&<p className="qwCabinetError" role="alert">{error}</p>}
  </section>;
}
