'use client';
import {useEffect,useState} from 'react';
export default function RecognitionStatus({message,active,queued=0}:{message:string;active:boolean;queued?:number}){
 const [seconds,setSeconds]=useState(0);
 useEffect(()=>{setSeconds(0);if(!active)return;const start=Date.now();const timer=window.setInterval(()=>setSeconds(Math.floor((Date.now()-start)/1000)),1000);return ()=>window.clearInterval(timer);},[active]);
 const label=/PDF|图形、尺寸和数量/.test(message)?'正在生成PDF…':/检查新截图/.test(message)?'正在检查截图…':/读取图片|读取截图/.test(message)?'正在读取截图…':/等待识别/.test(message)?'截图排队中…':/CAD/.test(message)?'正在解析CAD…':/准备上传|处理图片|准备重新上传/.test(message)?'正在准备图片…':'正在上传解析图片…';
 if(!active)return null;
 return <div role="status" aria-live="polite" className="diRecognitionStatus"><span className={active?'diProgressSpinner':''} aria-hidden="true"/><div><strong>{label}</strong>{active&&<small aria-live="off">已等待 {seconds} 秒</small>}{queued>0&&<small>另有{queued}张排队</small>}</div></div>;
}
