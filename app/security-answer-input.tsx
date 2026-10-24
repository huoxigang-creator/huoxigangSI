'use client';
import {useId,useState,type CSSProperties} from 'react';

/** New answers are visible while typing; stored answers are never read back. */
export default function SecurityAnswerInput({label,value,onChange,style,placeholder,minLength,required=false}:{label:string;value:string;onChange:(value:string)=>void;style:CSSProperties;placeholder?:string;minLength?:number;required?:boolean}){
 const id=useId(),[visible,setVisible]=useState(true);
 return <div style={{marginBottom:16}}><label htmlFor={id}>{label}</label><div style={{position:'relative'}}><input id={id} aria-label={label} type={visible?'text':'password'} value={value} onChange={e=>onChange(e.target.value)} required={required} minLength={minLength} maxLength={200} autoComplete="off" autoCapitalize="off" spellCheck={false} style={{...style,paddingRight:70}} placeholder={placeholder}/><button type="button" aria-label={(visible?'隐藏':'显示')+label} aria-pressed={visible} onClick={()=>setVisible(v=>!v)} style={{position:'absolute',right:8,top:'50%',transform:'translateY(-50%)',border:0,background:'transparent',color:'inherit',padding:'4px 8px',cursor:'pointer',fontSize:13}}>{visible?'隐藏':'显示'}</button></div></div>;
}
