import { NextRequest, NextResponse } from 'next/server';
import { readTestSession, SESSION_COOKIE } from './demo-auth';

export const errorResponse = (message: string, status = 400) => NextResponse.json({ error: message }, { status });
export const playerFor = (request: NextRequest) => readTestSession(request.cookies.get(SESSION_COOKIE)?.value);
export function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    // Next's dev server may normalize request.nextUrl to localhost even when
    // the browser uses 127.0.0.1. The incoming Host header is the public host.
    const url = new URL(origin);
    const host = request.headers.get('host');
    const protocol = request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(':', '');
    return url.host === host && url.protocol === `${protocol}:` && url.origin === origin;
  } catch { return false; }
}
export async function readBody(request: NextRequest): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 8192) throw new Error('Request is too large.');
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Expected a JSON object.');
  return data;
}
