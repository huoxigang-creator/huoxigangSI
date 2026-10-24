import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, sessionAccount } from './lib/local-auth';
import { MANAGEMENT_OWNER_ID } from './lib/management-access';

const publicPaths = new Set(['/login', '/api/auth/login', '/api/auth/sms/send', '/api/auth/sms/login', '/api/auth/forgot', '/api/shared-confirm', '/api/register-client', '/api/register-ocr', '/api/register-speech']);
const employeeApiPaths = new Set(['/api/drawing-recognition','/api/manage', '/api/catalog', '/api/auth/me', '/api/auth/me/update', '/api/auth/password', '/api/auth/security-question', '/api/project-sms', '/api/confirm', '/api/customer-ocr', '/api/customer-speech']);

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) {
    if (name.toLowerCase().startsWith('oai-authenticated-user-') || name.toLowerCase() === 'x-gugemei-role') headers.delete(name);
  }
  const next = () => NextResponse.next({ request: { headers } });
  const staticAsset = path.startsWith('/_next/') || path.startsWith('/assets/') || path === '/favicon.ico' || /\.(?:svg|png|jpg|jpeg|webp|ico|css|js|woff2?)$/.test(path);
  if ((request.method==='GET'&&/^\/api\/ocr-language\/(?:fast|full)\/chi_sim\.traineddata\.gz$/.test(path)) || (/^\/s\/m\/[a-f0-9]{64}\/?$/.test(path)&&request.method==='GET') || (path==='/api/shared-material-selections'&&['GET','POST'].includes(request.method)) || (/^\/s\/p\/[a-f0-9]{64}\/?$/.test(path)&&request.method==='GET') || (path==='/api/shared-customer-payment'&&['GET','POST'].includes(request.method)) || staticAsset || publicPaths.has(path) || path.startsWith('/s/c/') || (/^\/s\/q\/[a-f0-9]{64}\/?$/.test(path)&&request.method==='GET') || (path==='/api/shared-quote'&&['GET','POST'].includes(request.method)) || path.startsWith('/s/r/')) return next();

  const account = sessionAccount(request.cookies.get(SESSION_COOKIE)?.value);
  if (!account) {
    if (path.startsWith('/api/') || path === '/mcp') return NextResponse.json({ error: '请先登录' }, { status: 401 });
    const login = new URL('/login', request.url);
    login.searchParams.set('return_to', path.startsWith('/') && !path.startsWith('//') ? path : '/');
    return NextResponse.redirect(login);
  }

  if (account.role === 'employee' && (path === '/mcp' || path.startsWith('/api/') && !employeeApiPaths.has(path))) {
    return NextResponse.json({ error: '仅老板可访问此功能' }, { status: 403 });
  }
  const origin = request.headers.get('origin');
  if (origin && !['GET', 'HEAD', 'OPTIONS'].includes(request.method) && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: '不允许跨站请求' }, { status: 403 });
  }

  headers.set('oai-authenticated-user-id', MANAGEMENT_OWNER_ID);
  headers.set('oai-authenticated-user-email', account.username + '@gugemei.local');
  headers.set('oai-authenticated-user-full-name', encodeURIComponent(account.display_name));
  headers.set('oai-authenticated-user-full-name-encoding', 'percent-encoded-utf-8');
  headers.set('x-gugemei-role', account.role);
  headers.set('x-gugemei-account-id', account.id);
  return next();
}

export const config = {
  matcher: '/:path*',
};
