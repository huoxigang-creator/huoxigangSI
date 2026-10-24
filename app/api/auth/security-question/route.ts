import {NextRequest,NextResponse} from 'next/server';
import {sessionAccount,verifyPassword,issueSession,SESSION_COOKIE} from '../../../../lib/local-auth';
import {accountRecovery} from '../../../../lib/account-recovery-service';
import {RecoveryError} from '../../../../lib/account-recovery';
const headers={'Cache-Control':'no-store'};
export async function GET(r:NextRequest){const a=sessionAccount(r.cookies.get(SESSION_COOKIE)?.value);return a?NextResponse.json(accountRecovery.view(a.id),{headers}):NextResponse.json({error:'请先登录'},{status:401,headers});}
export async function POST(r:NextRequest){try{
 if(r.headers.get('sec-fetch-site')==='cross-site'||r.headers.get('origin')&&r.headers.get('origin')!==r.nextUrl.origin)return NextResponse.json({error:'不允许跨站请求'},{status:403,headers});
 const a=sessionAccount(r.cookies.get(SESSION_COOKIE)?.value);if(!a)return NextResponse.json({error:'请先登录'},{status:401,headers});
 const body=await r.json() as Record<string,unknown>;
 if(typeof body.current_password!=='string'||verifyPassword(a.username,body.current_password)?.id!==a.id)return NextResponse.json({error:'当前密码不正确'},{status:401,headers});
 const result=accountRecovery.set(a.id,body.question,body.answer);
 const response=NextResponse.json({ok:true,configured:true,question:result.question},{headers});
 response.cookies.set(SESSION_COOKIE,issueSession(result.account),{httpOnly:true,secure:process.env.GUGEMEI_SECURE_COOKIE==='true',sameSite:'lax',path:'/',maxAge:12*3600});return response;
 }catch(e){return NextResponse.json({error:e instanceof RecoveryError?e.message:'安全问题保存失败'},{status:e instanceof RecoveryError?e.status:400,headers});}}
