import { requireUser } from '@/server/auth/session';
import { dataResponse, errorResponse } from '@/server/http';

export const dynamic = 'force-dynamic';
export async function GET() {
  try { return dataResponse(await requireUser()); }
  catch (error) { return errorResponse(error); }
}
