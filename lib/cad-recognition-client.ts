import type {DrawingRow} from './drawing-import';
export function validateCadFiles(files:File[]){
 if(!files.length||files.length>30)throw Error('请选择1至30个CAD文件');
 for(const file of files){
  if(!/\.(dxf|dwg)$/i.test(file.name)||!file.size)throw Error('请选择DXF或DWG格式的CAD文件');
  if(file.size>100*1024*1024)throw Error('CAD文件超过100MB，请简化图纸或分文件上传');
 }
}
/** 直接上传 CAD 文件（DXF/DWG）二进制，避免大文件base64编码膨胀，调用 CAD 识别接口，返回柜体行列表（一个CAD可含多个柜体）。 */
export async function requestCadRecognition(file:File,onProgress:(message:string)=>void=()=>{},signal?:AbortSignal):Promise<DrawingRow[]>{
 validateCadFiles([file]);
 onProgress(`正在上传并解析CAD文件 ${file.name}，提取柜体和尺寸…`);
 const response=await fetch('/api/cad-recognition',{method:'POST',signal,headers:{'Content-Type':'application/octet-stream','X-CAD-Source':encodeURIComponent(file.name.slice(0,240)),'X-CAD-DWG':/\.dwg$/i.test(file.name)?'1':'0'},body:file});
 const body=await response.text();
 let value:{error?:string;result?:DrawingRow[]};
 try{value=JSON.parse(body);}catch{
  if(response.status===413)throw Error('服务器上传大小限制拦截了CAD文件，请联系管理员调整上传限制（支持100MB以内CAD文件）。');
  if(response.status===401||response.redirected)throw Error('登录已失效，请刷新页面重新登录后上传CAD文件。');
  if([502,503,504].includes(response.status))throw Error('CAD识别服务暂时不可用，请稍后重试。');
  throw Error('CAD接口未返回有效识别结果（HTTP '+response.status+'），请稍后重试。');
 }
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('CAD接口返回格式无效，请稍后重试');
 if(!response.ok)throw Error(value.error||'CAD识别失败，请重试');
 if(!value.result||!value.result.length)throw Error('CAD中未识别到柜体');
 return value.result;
}
