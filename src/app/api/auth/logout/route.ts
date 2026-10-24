import { logoutMember, requireSameOrigin } from '@/server/auth/session';
import { dataResponse, errorResponse } from '@/server/http';

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await logoutMember();
    return dataResponse({ ok: true });
  } catch (error) { return errorResponse(error); }
}
