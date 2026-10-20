'use client';

import {forwardRef,useEffect,useImperativeHandle,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import workerSource from 'pdfjs-dist/build/pdf.worker.min.mjs?raw';
import {useWorkspaceActive} from './workspace-active';
import './contract-pdf-viewer.css';

export type ContractPdfViewerHandle={print:()=>void};
let bundledWorkerUrl:string|undefined;
/** Render the actual server PDF, including its embedded Chinese font. */
const ContractPdfViewer=forwardRef<ContractPdfViewerHandle,{url:string;title:string;onReady:(ready:boolean)=>void}>(function ContractPdfViewer({url,title,onReady},ref){
 const active=useWorkspaceActive(),host=useRef<HTMLDivElement>(null),readyCallback=useRef(onReady),[loading,setLoading]=useState(true),[error,setError]=useState(''),[printPages,setPrintPages]=useState<string[]>([]);
 readyCallback.current=onReady;
 useImperativeHandle(ref,()=>({print:()=>{const pages=Array.from(host.current?.querySelectorAll('canvas')||[]);if(active&&pages.length&&!loading&&!error)setPrintPages(pages.map(page=>page.toDataURL('image/png')));}}),[active,loading,error]);
 useEffect(()=>{
  let stopped=false,task:import('pdfjs-dist').PDFDocumentLoadingTask|undefined,render:import('pdfjs-dist').RenderTask|undefined;const controller=new AbortController();
  readyCallback.current(false);setLoading(true);setError('');host.current?.replaceChildren();
  void(async()=>{try{
   const [pdfjs,response]=await Promise.all([import('pdfjs-dist'),fetch(url,{signal:controller.signal,credentials:'same-origin'})]);
   if(!response.ok||!response.headers.get('content-type')?.includes('application/pdf')){let message='合同PDF读取失败，请重新预览或下载。';try{const result=await response.json() as {error?:string};message=result.error||message;}catch{}throw new Error(message);}
   const bytes=new Uint8Array(await response.arrayBuffer());if(stopped)return;
   bundledWorkerUrl??=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'}));
   pdfjs.GlobalWorkerOptions.workerSrc=bundledWorkerUrl;
   task=pdfjs.getDocument({data:bytes,useSystemFonts:false,disableFontFace:true});
   const pdf=await task.promise;
   for(let number=1;number<=pdf.numPages;number++){
    if(stopped)return;const page=await pdf.getPage(number),viewport=page.getViewport({scale:2}),canvas=document.createElement('canvas');
    canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);canvas.setAttribute('role','img');canvas.setAttribute('aria-label',title+' 第'+number+'页，共'+pdf.numPages+'页');
    const wrapper=document.createElement('div');wrapper.className='contractRenderedPage';wrapper.appendChild(canvas);host.current?.appendChild(wrapper);
    render=page.render({canvas,viewport});await render.promise;page.cleanup();
   }
   if(!stopped){setLoading(false);readyCallback.current(true);}
  }catch(reason){if(!stopped){setLoading(false);setError(reason instanceof Error?reason.message:'合同PDF预览失败，请下载后查看。');readyCallback.current(false);}}})();
  return()=>{stopped=true;controller.abort();render?.cancel();void task?.destroy().catch(()=>{});};
 },[url,title]);
 useEffect(()=>{if(!active){if(printPages.length)setPrintPages([]);return;}if(!printPages.length)return;const done=()=>setPrintPages([]);window.addEventListener('afterprint',done);const timer=setTimeout(()=>window.print(),100);return()=>{clearTimeout(timer);window.removeEventListener('afterprint',done);};},[active,printPages]);
 return <><div className="contractRenderedPdf" aria-label="合同PDF内容">{loading&&<p role="status">正在生成合同预览…</p>}{error&&<p role="alert" className="contractError">{error}</p>}<div ref={host}/></div>{active&&!!printPages.length&&createPortal(<div className="contractPdfPrint" aria-label="合同打印内容">{printPages.map((page,index)=><img key={index} src={page} alt={title+' 第'+(index+1)+'页'}/>)}</div>,document.body)}</>;
});
export default ContractPdfViewer;
