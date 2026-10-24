import { requireMember } from '@/server/auth/session';
import { readShare } from '@/server/core';
import { dataResponse, errorResponse } from '@/server/http';

export const dynamic = 'force-dynamic';
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const member = await requireMember();
    return dataResponse(await readShare(member.id, (await params).token));
  } catch (error) { return errorResponse(error); }
}
