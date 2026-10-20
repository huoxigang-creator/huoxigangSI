'use client';
import {useState} from 'react';
import {Search} from 'lucide-react';
import {materialExpenseCategory,type MaterialRecord} from '../lib/catalog-types';
export default function CatalogSearch({materials,category,disabled=false,loading=false,error='',onSelect}:{materials:MaterialRecord[];category:string;disabled?:boolean;loading?:boolean;error?:string;onSelect:(material:MaterialRecord)=>void}){
 const [query,setQuery]=useState(''),[searched,setSearched]=useState(false);
 const tokens=query.normalize('NFKC').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
 const results=materials.filter(row=>!row.deleted&&materialExpenseCategory(row)===category&&tokens.every(token=>[row.name,row.brand,row.model,row.code].join(' ').normalize('NFKC').toLocaleLowerCase().includes(token)));
 function search(){if(!disabled)setSearched(true);}
 return <div className="catalogSearchPanel"><div className="catalogSearchControls"><input type="search" aria-label={category+'搜索'} placeholder="搜索名称、品牌、型号、代码" value={query} disabled={disabled} onChange={event=>setQuery(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();search();}}}/><button type="button" aria-label={'搜索'+category} disabled={disabled} onClick={search}><Search size={16}/>搜索</button>{searched&&<button type="button" disabled={disabled} onClick={()=>{setQuery('');setSearched(false);}}>清除</button>}</div>{searched&&<div className="catalogSearchResults" role="region" aria-label={category+'搜索结果'}>{loading?<p role="status">正在读取配置…</p>:error?<p role="alert">{error}</p>:<><p role="status">找到 {results.length} 项{!results.length?'，请核对名称或切换费用分类。':'，点击结果加入明细。'}</p><div>{results.map(row=><button type="button" key={row.id} disabled={disabled} onClick={()=>onSelect(row)}><b>{row.name}</b><span>{[row.brand,row.model,row.code,row.unit].filter(Boolean).join(' · ')}</span></button>)}</div></>}</div>}</div>;
}
