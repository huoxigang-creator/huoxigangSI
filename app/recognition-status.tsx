'use client';
import {useEffect,useState} from 'react';
export default function RecognitionStatus({message,active,queued=0}:{message:string;active:boolean;queued?:number}){
 const [seconds,setSeconds]=useState(0);
 useEffect(()=>{setSeconds(0);if(!active)return;const start=Date.now();const timer=window.setInterval(()=>setSeconds(Math.floor((Date.now()-start)/1000)),1000);return ()=>window.clearInterval(timer);},[active]);
 return <div role="status" aria-live="polite" className="diRecognitionStatus"><span className={active?'diProgressSpinner':''} aria-hidden="true"/><div><strong>{message}</strong>{active&&<small aria-live="off">已等待 {seconds} 秒 · 正在处理，请勿重复上传</small>}{queued>0&&<small>还有{queued}张截图等待识别，已接收，无需重复截图。</small>}</div></div>;
}
