import { z } from 'zod';

export const idSchema = z.uuid();
export const versionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const timestampSchema = z.iso.datetime({ offset: true });
export const slotIndexSchema = z.number().int().min(0).max(5);
export const modelKeySchema = z.enum(['camera-01', 'cassette', 'ticket', 'photo-plane']);

/** Count Unicode code points, so a supplementary character is not two words. */
export function textSchema(min: number, max: number) {
  return z.string().trim().refine((value) => {
    const length = Array.from(value).length;
    return length >= min && length <= max;
  }, `请输入 ${min} 至 ${max} 个字符。`);
}

export const exhibitNameSchema = textSchema(1, 80);
export const eraSchema = textSchema(1, 80);
export const captionSchema = textSchema(0, 120);
export const sourceIdSchema = textSchema(1, 80);

export type ModelKey = z.infer<typeof modelKeySchema>;
export type SlotIndex = z.infer<typeof slotIndexSchema>;
