import {generateQuoteSharePdf} from '../../../lib/quote-share-pdf';
import {confirmationFile} from '../../../lib/quote-confirmation-files';
import {quoteShareService,QuoteShareError} from '../../../lib/quote-shares';
import {paymentCodeService,PaymentCodeError} from '../../../lib/payment-codes';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow, noarchive'};
export async function GET(request:Request){try{
 const url=new URL(request.url),token=url.searchParams.get('token')||'',share=await quoteShareService.read(token),mode=share.snapshot.payment_mode??'wechat',code=mode==='manual_code'?share.snapshot.payment_code:null,format=url.searchParams.get('format');
 const loadImage=async()=>{if(!code)throw new QuoteShareError('此报价没有收款码图片',404);const image=await paymentCodeService.image(share.owner,code.id);if(image.metadata.content_type!==code.content_type||image.metadata.width!==code.width||image.metadata.height!==code.height)throw new PaymentCodeError('收款码图片与分享快照不一致，请联系商家',503);return {bytes:image.bytes,contentType:code.content_type,label:code.label};};
 const recheck=async()=>{const current=await quoteShareService.read(token);if(current.id!==share.id||current.owner!==share.owner||current.snapshot.payment_code?.id!==share.snapshot.payment_code?.id)throw new QuoteShareError('报价分享已变化，请重新打开链接',410);};
 if(format==='payment-code'){const image=await loadImage();await recheck();return new Response(new Uint8Array(image.bytes).buffer,{headers:{...headers,'Content-Type':image.contentType,'Content-Disposition':'inline'}});}
 if(format==='pdf'&&share.snapshot.document_mode!=='excel_confirmation'&&(share.collection||code)){
  const options=code?{paymentCodeImage:await loadImage()}:undefined,bytes=await generateQuoteSharePdf(share.snapshot,options);await recheck();return new Response(new Uint8Array(bytes).buffer,{headers:{...headers,'Content-Type':'application/pdf','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(share.snapshot.title+'-客户报价.pdf')}});
 }
 if(['document','pdf','excel'].includes(format||'')){
  const file=await confirmationFile(share,format!);await recheck();
  return new Response(typeof file.bytes==='string'?file.bytes:new Uint8Array(file.bytes).buffer,{headers:{...headers,'Content-Type':file.mime,'Content-Disposition':format==='document'?'inline':"attachment; filename*=UTF-8''"+encodeURIComponent(share.snapshot.title+(share.signature?'-已签字确认':'-待确认')+'.'+file.extension),'Content-Security-Policy':"default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox"}});
 }

 const {payment_code:_privateCode,confirmation_sheet:_privateSheet,...snapshot}=share.snapshot;
 const payment_code=code?{label:code.label,content_type:code.content_type,width:code.width,height:code.height,image_url:'/api/shared-quote?token='+encodeURIComponent(token)+'&format=payment-code'}:null;
 return Response.json({ok:true,result:{...snapshot,payment_mode:mode,payment_code,payment_enabled:mode!=='manual_code'&&!!share.collection,signature:share.signature||null,signed_at:share.signed_at||null}},{headers});
 }catch(error){const known=error instanceof QuoteShareError||error instanceof PaymentCodeError;return Response.json({error:known?error.message:'报价暂时无法读取，请联系商家'},{status:known?error.status:500,headers});}}
export async function POST(request:Request){try{
 const url=new URL(request.url),token=url.searchParams.get('token')||'';
 if((request.headers.get('origin')&&request.headers.get('origin')!==url.origin)||request.headers.get('sec-fetch-site')==='cross-site')throw new QuoteShareError('不允许跨站操作',403);
 if(Number(request.headers.get('content-length'))>520000)throw new QuoteShareError('签字图片过大',413);
 const raw=await request.text();if(raw.length>520000)throw new QuoteShareError('签字图片过大',413);
 let body:{signature?:string};try{body=JSON.parse(raw);}catch{throw new QuoteShareError('签字数据无效',400);}
 if(!body||typeof body.signature!=='string')throw new QuoteShareError('签字数据无效',400);
 const result=await quoteShareService.saveSignature(token,body.signature);
 return Response.json({ok:true,result},{headers});
 }catch(error){const known=error instanceof QuoteShareError;return Response.json({error:known?error.message:'签字保存失败'},{status:known?error.status:500,headers});}}
