import { memoirExportQuerySchema } from '@/contracts';
import { requireMember } from '@/server/auth/session';
import { exportMemoir, memoirExportMarkdown } from '@/server/core/memoir-queries';
import { errorResponse, privateHeaders } from '@/server/http';
import { privateId, type MemoirContext } from '../../_params';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: MemoirContext) {
  try {
    const actor = await requireMember(); const id = privateId((await params).memoirId);
    const { format } = memoirExportQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const document = await exportMemoir(actor.id, id);
    return new Response(format === 'json' ? JSON.stringify(document, null, 2) : memoirExportMarkdown(document), {
      headers: { ...privateHeaders, 'Content-Type': format === 'json' ? 'application/json; charset=utf-8' : 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="memoir-${id}.${format === 'json' ? 'json' : 'md'}"` },
    });
  } catch (error) { return errorResponse(error); }
}
