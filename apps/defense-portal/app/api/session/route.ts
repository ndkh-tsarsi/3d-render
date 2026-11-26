import { NextRequest, NextResponse } from 'next/server';
import { checkTestPasscode, createTestSession, SESSION_COOKIE, SESSION_TTL_SECONDS } from '../../../lib/demo-auth';
import { errorResponse, isSameOrigin, playerFor, readBody } from '../../../lib/route-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const player = playerFor(request);
  return NextResponse.json({ player, mode: 'test', requiresPasscode: true }, { headers: { 'Cache-Control': 'no-store' } });
}
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return errorResponse('Origin is not allowed.', 403);
  try {
    const body = await readBody(request);
    if (!checkTestPasscode(body.passcode)) return errorResponse('Test access code is incorrect.', 401);
    const { token, player } = createTestSession(body.displayName);
    const response = NextResponse.json({ player, mode: 'test' });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true, sameSite: 'strict', secure: request.nextUrl.protocol === 'https:',
      path: '/', maxAge: SESSION_TTL_SECONDS,
    });
    return response;
  } catch (error) { return errorResponse(error instanceof Error ? error.message : 'Could not sign in.'); }
}
export async function DELETE(request: NextRequest) {
  if (!isSameOrigin(request)) return errorResponse('Origin is not allowed.', 403);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'strict', path: '/', maxAge: 0 });
  return response;
}
