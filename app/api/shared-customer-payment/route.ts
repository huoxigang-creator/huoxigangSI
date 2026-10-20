import {paymentInput} from '../../../lib/customer-payment-input';
import {customerPaymentService as service} from '../../../lib/customer-payment-service';
import {CustomerPaymentError} from '../../../lib/customer-payments';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
function failure(e:unknown){return Response.json({error:e instanceof CustomerPaymentError?e.message:'付款单读取失败，请联系商家'},{status:e instanceof CustomerPaymentError?e.status:500,headers});}
export async function GET(r:Request){try{return Response.json({result:service.view(new URL(r.url).searchParams.get('token')||'')},{headers});}catch(e){return failure(e);}}
export async function POST(r:Request){try{if(r.headers.get('origin')&&r.headers.get('origin')!==new URL(r.url).origin||r.headers.get('sec-fetch-site')==='cross-site')throw new CustomerPaymentError('不允许跨站操作',403);if(Number(r.headers.get('content-length')||0)>2900000)throw new CustomerPaymentError('截图过大',413);const {token,note,proof}=await paymentInput(r,2900000);return Response.json({result:service.report(token,note||'',proof)},{headers});}catch(e){return failure(e);}}
