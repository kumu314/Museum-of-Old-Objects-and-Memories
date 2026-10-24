import { loginInputSchema } from '@/contracts/session';
import { loginUser, requireSameOrigin } from '@/server/auth/session';
import { dataResponse, errorResponse, readJsonRequest } from '@/server/http';

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    return dataResponse(await loginUser(loginInputSchema.parse(await readJsonRequest(request))));
  } catch (error) { return errorResponse(error); }
}
