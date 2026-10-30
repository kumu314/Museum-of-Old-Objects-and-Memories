export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { loginInputSchema } from '@/contracts/session';
import { loginMember, requireSameOrigin } from '@/server/auth/session';
import { dataResponse, errorResponse, readJsonRequest } from '@/server/http';

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    return dataResponse(await loginMember(loginInputSchema.parse(await readJsonRequest(request))));
  } catch (error) { return errorResponse(error); }
}
