import type {DrawingRow} from './drawing-import';
/** 读取 CAD 文件（DXF/DWG）为 base64，调用 CAD 识别接口，返回柜体行列表（一个CAD可含多个柜体）。 */
export async function requestCadRecognition(file:File,onProgress:(message:string)=>void=()=>{},signal?:AbortSignal):Promise<DrawingRow[]>{
 if(!/\.(dxf|dwg)$/i.test(file.name)||!file.size)throw Error('请选择DXF或DWG格式的CAD文件');
 if(file.size>20*1024*1024)throw Error('CAD文件超过20MB，请简化图纸或分文件上传');
 const buffer=await file.arrayBuffer();
 const bytes=new Uint8Array(buffer);
 // 二进制转 base64（避免大文件 readAsDataURL 多次拷贝）
 let binary='';
 const chunk=0x8000;
 for(let i=0;i<bytes.length;i+=chunk){
  binary+=String.fromCharCode(...bytes.subarray(i,i+chunk));
 }
 const content=btoa(binary);
 const isDwg=/\.dwg$/i.test(file.name);
 onProgress(`正在解析CAD文件 ${file.name}，提取柜体和尺寸…`);
 const response=await fetch('/api/cad-recognition',{method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({content,source:file.name.slice(0,240),dwg:isDwg,encoding:'base64'})});
 const body=await response.text();
 let value:{error?:string;result?:DrawingRow[]};
 try{value=JSON.parse(body);}catch{
  if(response.status===413)throw Error('服务器上传大小限制拦截了CAD文件，请联系管理员调整上传限制（支持20MB以内CAD文件）。');
  if(response.status===401||response.redirected)throw Error('登录已失效，请刷新页面重新登录后上传CAD文件。');
  if([502,503,504].includes(response.status))throw Error('CAD识别服务暂时不可用，请稍后重试。');
  throw Error('CAD接口未返回有效识别结果（HTTP '+response.status+'），请稍后重试。');
 }
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('CAD接口返回格式无效，请稍后重试');
 if(!response.ok)throw Error(value.error||'CAD识别失败，请重试');
 if(!value.result||!value.result.length)throw Error('CAD中未识别到柜体');
 return value.result;
}
