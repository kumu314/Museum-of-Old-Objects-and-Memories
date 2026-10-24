import { idSchema } from '@/contracts';
import { HttpError } from '@/server/http';

export type InvitationContext = { params: Promise<{ invitationId: string }> };
/** 非法 id 一律按"不存在"处理：400 会区分出"格式对但不存在"与"格式就不对"。 */
export function privateId(value: string): string {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) throw new HttpError({ code: 'NOT_FOUND', message: '未找到该内容。' });
  return parsed.data;
}
