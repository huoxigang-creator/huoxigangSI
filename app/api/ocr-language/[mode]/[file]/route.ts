import {readFileSync} from 'node:fs';
import {join} from 'node:path';
// Vinext treats .gz files as precompressed variants and omits standalone .gz
// files from its static index. Tesseract needs the original gzip bytes.
export async function GET(_request:Request,{params}:{params:Promise<{mode:string;file:string}>}){
 const {mode,file}=await params;
 if(!['fast','full'].includes(mode)||file!=='chi_sim.traineddata.gz')return new Response('Not found',{status:404});
 try{const bytes=readFileSync(join(process.cwd(),'public/assets/document-ocr/languages',mode,file));return new Response(new Uint8Array(bytes).buffer,{headers:{'Content-Type':'application/octet-stream','Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff'}});}catch{return new Response('OCR language unavailable',{status:503,headers:{'Cache-Control':'no-store'}});}
}
