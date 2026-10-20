import {CustomerPaymentError} from './customer-payments';
export async function paymentInput(request:Request,limit:number){
 const reader=request.body?.getReader();if(!reader)throw new CustomerPaymentError('请求为空');
 const chunks:Uint8Array[]=[];let length=0;
 try{while(true){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>limit){await reader.cancel();throw new CustomerPaymentError('请求过长',413);}chunks.push(part.value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 try{const value=JSON.parse(new TextDecoder().decode(bytes));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch{throw new CustomerPaymentError('请求格式无效');}
}
