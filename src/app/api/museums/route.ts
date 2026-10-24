import { createMuseumInputSchema } from '@/contracts';
import { requireMember, requireSameOrigin } from '@/server/auth/session';
import { createMuseum, listMuseums } from '@/server/core';
import { dataResponse, errorResponse, readJsonRequest } from '@/server/http';

export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const member = await requireMember();
    return dataResponse(await listMuseums(member.id));
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const member = await requireMember();
    const input = createMuseumInputSchema.parse(await readJsonRequest(request));
    return dataResponse(await createMuseum(member.id, input), 201);
  } catch (error) { return errorResponse(error); }
}
