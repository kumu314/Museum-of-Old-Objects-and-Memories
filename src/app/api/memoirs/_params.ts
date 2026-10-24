import { memoirPageInputSchema } from '@/contracts';
export { privateId } from '../museums/_params';
export type MemoirContext = { params: Promise<{ memoirId: string }> };
export type MemoirSessionContext = { params: Promise<{ memoirId: string; sessionId: string }> };
export type MemoirChapterContext = { params: Promise<{ memoirId: string; chapterId: string }> };
export function memoirPageInput(request: Request) {
  const params = new URL(request.url).searchParams;
  return memoirPageInputSchema.parse({ ...Object.fromEntries(params), cursor: params.get('cursor'),
    limit: params.has('limit') ? Number(params.get('limit')) : 50 });
}
// 20,000 escaped code points plus 1,600 UUID/range references and JSON syntax.
export const memoirChapterBodyLimit = 768 * 1024;
export const memoirAnswerBodyLimit = 128 * 1024;
