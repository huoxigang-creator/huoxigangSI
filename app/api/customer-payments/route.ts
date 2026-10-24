import {paymentInput} from '../../../lib/customer-payment-input';
import {customerPaymentService as service} from '../../../lib/customer-payment-service';
import {CustomerPaymentError} from '../../../lib/customer-payments';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
function failure(e:unknown){return Response.json({error:e instanceof CustomerPaymentError?e.message:'付款单操作失败，请核对后重试'},{status:e instanceof CustomerPaymentError?e.status:500,headers});}
function owner(r:Request){const id=r.headers.get('oai-authenticated-user-id');if(!id)throw new CustomerPaymentError('请先登录',401);return id;}
export async function GET(r:Request){try{const who=owner(r),url=new URL(r.url);return Response.json({result:url.searchParams.has('proof')?service.proof(who,url.searchParams.get('proof')||''):service.list(who,url.searchParams.get('project_id')||'')},{headers});}catch(e){return failure(e);}}
export async function POST(r:Request){try{const who=owner(r);if(r.headers.get('origin')&&r.headers.get('origin')!==new URL(r.url).origin)throw new CustomerPaymentError('不允许跨站操作',403);const {action,args}=await paymentInput(r,4000);const result=action==='create'?await service.create(who,args):action==='confirm'?await service.confirm(who,args?.id):action==='cancel_confirmation'?service.cancel(who,args?.id,args?.reason):null;if(!result)throw new CustomerPaymentError('操作无效');return Response.json({result},{headers});}catch(e){return failure(e);}}
