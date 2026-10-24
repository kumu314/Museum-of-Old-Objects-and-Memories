import { createMuseumInputSchema } from '@/contracts';
import { requireUser, requireSameOrigin } from '@/server/auth/session';
import { createMuseum, listMuseums } from '@/server/core';
import { dataResponse, errorResponse, readJsonRequest } from '@/server/http';

export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const user = await requireUser();
    return dataResponse(await listMuseums(user.id));
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const user = await requireUser();
    const input = createMuseumInputSchema.parse(await readJsonRequest(request));
    return dataResponse(await createMuseum(user.id, input), 201);
  } catch (error) { return errorResponse(error); }
}
