import {NextRequest,NextResponse} from 'next/server';
import {accountByPhone,consumeCode,normalizePhone} from '../../../../../lib/sms';
import {issueSession,SESSION_COOKIE} from '../../../../../lib/local-auth';
import {accountRecovery} from '../../../../../lib/account-recovery-service';
import {RecoveryError} from '../../../../../lib/account-recovery';
const headers={'Cache-Control':'no-store'};
export async function POST(r:NextRequest){try{
 const origin=r.headers.get('origin');if(r.headers.get('sec-fetch-site')==='cross-site'||origin&&origin!==r.nextUrl.origin)return NextResponse.json({error:'不允许跨站请求'},{status:403,headers});
 const body=await r.json() as Record<string,unknown>;
 if(!body.challenge){
  const phone=normalizePhone(body.phone),code=typeof body.code==='string'?body.code.trim():'';
  if(!phone||!/^\d{6}$/.test(code))return NextResponse.json({error:'手机号或验证码不正确'},{status:400,headers});
  if(!consumeCode(phone,'login',code))return NextResponse.json({error:'验证码错误或已过期'},{status:401,headers});
  const a=accountByPhone(phone);if(!a||a.active!==1)return NextResponse.json({error:'该手机号未绑定可用账号'},{status:404,headers});
  return NextResponse.json(accountRecovery.challenge(a.id,'login'),{headers});
 }
 const a=accountRecovery.consume(body.challenge,body.answer,'login');
 const response=NextResponse.json({ok:true,role:a.role},{headers});
 response.cookies.set(SESSION_COOKIE,issueSession(a),{httpOnly:true,secure:process.env.GUGEMEI_SECURE_COOKIE==='true',sameSite:'lax',path:'/',maxAge:12*3600});return response;
 }catch(e){return NextResponse.json({error:e instanceof RecoveryError?e.message:'登录验证失败，请重新验证'},{status:e instanceof RecoveryError?e.status:400,headers});}}
