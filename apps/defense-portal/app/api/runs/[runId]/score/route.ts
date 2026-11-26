import { NextRequest, NextResponse } from 'next/server';
import { acceptKill } from '../../../../../lib/run-store';
import { errorResponse, isSameOrigin, playerFor, readBody } from '../../../../../lib/route-utils';

export const runtime = 'nodejs';
export async function POST(request: NextRequest, context: { params: Promise<{ runId: string }> }) {
  if (!isSameOrigin(request)) return errorResponse('Origin is not allowed.', 403);
  const player = playerFor(request);
  if (!player) return errorResponse('Sign in to the test portal first.', 401);
  try {
    const { runId } = await context.params;
    const body = await readBody(request);
    return NextResponse.json(acceptKill(player.id, runId, body.enemyId));
  } catch (error) { return errorResponse(error instanceof Error ? error.message : 'Could not record score.'); }
}
