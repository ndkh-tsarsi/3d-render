import { NextRequest, NextResponse } from 'next/server';
import { createRun } from '../../../lib/run-store';
import { errorResponse, isSameOrigin, playerFor, readBody } from '../../../lib/route-utils';

export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return errorResponse('Origin is not allowed.', 403);
  const player = playerFor(request);
  if (!player) return errorResponse('Sign in to the test portal first.', 401);
  try {
    const body = await readBody(request);
    const rules = body.rules && typeof body.rules === 'object' && !Array.isArray(body.rules) ? body.rules as Record<string, unknown> : {};
    return NextResponse.json(createRun(player.id, rules));
  } catch (error) { return errorResponse(error instanceof Error ? error.message : 'Could not create a run.'); }
}
