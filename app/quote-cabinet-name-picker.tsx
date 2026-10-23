'use client';

import {useId,useRef,useState} from 'react';
import {ChevronDown} from 'lucide-react';
import type {MaterialRecord} from '../lib/catalog-types';
import {isBuiltinCabinetOption} from '../lib/cabinet-catalog';

/** Cabinet names are quotation line options; choosing one never creates a group. */
export default function QuoteCabinetNamePicker({label,value,options,disabled,onChange,onSelect}:{
  label:string;value:string;options:MaterialRecord[];disabled:boolean;onChange:(name:string)=>void;onSelect:(option:MaterialRecord)=>void;
}) {
  const [open,setOpen]=useState(false),[search,setSearch]=useState(''),[focused,setFocused]=useState(0);
  const listId=useId(),input=useRef<HTMLInputElement>(null);
  const query=search.normalize('NFKC').trim().toLocaleLowerCase();
  const choices=options.filter(option=>!query||option.name.normalize('NFKC').toLocaleLowerCase().includes(query));
  function select(option:MaterialRecord){if(disabled)return;onSelect(option);setOpen(false);setSearch('');}
  return <div className="qwCabinetNamePicker"><div className="qwCabinetNameControl"><input ref={input} aria-label={label} value={value} maxLength={100} disabled={disabled} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={listId} aria-activedescendant={open&&choices.length?listId+'-'+Math.min(focused,choices.length-1):undefined} placeholder="请选择柜体名称" onFocus={()=>{setSearch('');}} onClick={()=>{}} onBlur={()=>setOpen(false)} onChange={event=>{onChange(event.target.value);setSearch(event.target.value);}} onKeyDown={event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setOpen(true);setFocused(previous=>Math.max(0,Math.min(choices.length-1,previous+(event.key==='ArrowDown'?1:-1))));}else if(event.key==='Enter'&&open){event.preventDefault();const chosen=choices[Math.min(focused,choices.length-1)];if(chosen)select(chosen);}else if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();setOpen(false);}}}/><button type="button" aria-label="展开柜体名称" disabled={disabled} onMouseDown={event=>event.preventDefault()} onClick={()=>{if(open)setOpen(false);else{input.current?.focus();setSearch('');setOpen(true);}}}><ChevronDown size={13}/></button></div>{open&&<div className="qwCabinetNameOptions" role="listbox" id={listId} aria-label="柜体名称选项">{choices.map((option,index)=><button id={listId+'-'+index} type="button" key={option.id} role="option" aria-selected={value===option.name} className={focused===index?'focused':''} onMouseDown={event=>event.preventDefault()} onMouseEnter={()=>setFocused(index)} onClick={()=>select(option)} disabled={disabled}><span>{option.name}</span>{!isBuiltinCabinetOption(option)&&<small>{option.model||'无型号'} · {option.unit} · {new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY'}).format(option.sale_price/100)}</small>}</button>)}{!choices.length&&<p>未找到柜体名称。</p>}<p className="qwCabinetConfigHint">自定义名称请在“配置 → 柜体”中新增。</p></div>}</div>;
}
