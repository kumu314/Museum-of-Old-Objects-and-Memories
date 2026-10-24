import { registerInputSchema } from '@/contracts/session';
import { registerUser, requireSameOrigin } from '@/server/auth/session';
import { dataResponse, errorResponse, readJsonRequest } from '@/server/http';

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    return dataResponse(await registerUser(registerInputSchema.parse(await readJsonRequest(request))), 201);
  } catch (error) { return errorResponse(error); }
}
