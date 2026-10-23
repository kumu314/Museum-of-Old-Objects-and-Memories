import { idSchema } from '@/contracts';
import { HttpError } from '@/server/http';

export type MuseumContext = { params: Promise<{ museumId: string }> };
export type ExhibitContext = { params: Promise<{ museumId: string; exhibitId: string }> };
export function privateId(value: string): string {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) throw new HttpError({ code: 'NOT_FOUND', message: '未找到该内容。' });
  return parsed.data;
}
