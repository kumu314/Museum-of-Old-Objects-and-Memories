import { createMemoirInputSchema } from '@/contracts';
import { requireMember, requireSameOrigin } from '@/server/auth/session';
import { createMemoir } from '@/server/core/memoirs';
import { listMemoirs } from '@/server/core/memoir-queries';
import { dataResponse, errorResponse, readJsonRequest } from '@/server/http';
import { memoirPageInput } from './_params';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try { return dataResponse(await listMemoirs((await requireMember()).id, memoirPageInput(request))); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try { requireSameOrigin(request); const actor = await requireMember();
    return dataResponse(await createMemoir(actor.id, createMemoirInputSchema.parse(await readJsonRequest(request))), 201);
  } catch (error) { return errorResponse(error); }
}
