export async function trashRequest(action:string,args:Record<string,unknown>={}){
 const response=await fetch('/api/trash',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,args})});
 const body=await response.json().catch(()=>null) as {ok?:boolean;error?:string;records?:any[];files?:any[]}|null;
 if(!response.ok||!body?.ok)throw new Error(body?.error||'回收站操作失败，请重试');
 return body;
}
