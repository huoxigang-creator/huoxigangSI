import {randomBytes,scryptSync} from 'node:crypto';
import {NextRequest,NextResponse} from 'next/server';
import {rawDatabase} from '../../../../lib/local-env';
import {accountByPhone,consumeCode,normalizePhone} from '../../../../lib/sms';
import {accountRecovery} from '../../../../lib/account-recovery-service';
import {RecoveryError} from '../../../../lib/account-recovery';
const headers={'Cache-Control':'no-store'};
export async function POST(r:NextRequest){try{
 const origin=r.headers.get('origin');if(r.headers.get('sec-fetch-site')==='cross-site'||origin&&origin!==r.nextUrl.origin)return NextResponse.json({error:'不允许跨站请求'},{status:403,headers});
 const body=await r.json() as Record<string,unknown>;
 if(!body.challenge){
  const phone=normalizePhone(body.phone),code=typeof body.code==='string'?body.code.trim():'';
  if(!phone||!/^\d{6}$/.test(code))return NextResponse.json({error:'手机号或验证码不正确'},{status:400,headers});
  if(!consumeCode(phone,'reset',code))return NextResponse.json({error:'验证码错误或已过期'},{status:401,headers});
  const a=accountByPhone(phone);if(!a||a.active!==1)return NextResponse.json({error:'该手机号未绑定可用账号'},{status:404,headers});
  return NextResponse.json(accountRecovery.challenge(a.id,'reset'),{headers});
 }
 const password=typeof body.password==='string'?body.password:'';
 if(password.length<12||password.length>1024)return NextResponse.json({error:'新密码至少12位，最多1024位'},{status:400,headers});
 const a=accountRecovery.consume(body.challenge,body.answer,'reset');
 const salt=randomBytes(32),hash=scryptSync(password,salt,64);
 rawDatabase.prepare('UPDATE accounts SET password_hash=?,salt=?,updated=? WHERE id=? AND active=1').run(hash.toString('hex'),salt.toString('hex'),new Date().toISOString(),a.id);
 return NextResponse.json({ok:true},{headers});
 }catch(e){return NextResponse.json({error:e instanceof RecoveryError?e.message:'找回密码请求无效，请重新验证'},{status:e instanceof RecoveryError?e.status:400,headers});}}
