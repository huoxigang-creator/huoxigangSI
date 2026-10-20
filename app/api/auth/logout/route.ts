import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '../../../../lib/local-auth';

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
