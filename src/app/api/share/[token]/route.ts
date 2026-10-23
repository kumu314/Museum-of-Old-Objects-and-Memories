import { readShare } from '@/server/core';
import { dataResponse, errorResponse } from '@/server/http';

export const dynamic = 'force-dynamic';
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    return dataResponse(await readShare((await params).token));
  } catch (error) { return errorResponse(error); }
}
