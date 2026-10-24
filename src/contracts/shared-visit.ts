import { z } from 'zod';
import { sharedContributionSchema } from './contributors';
import { publicMuseumSchema } from './museum';

/** 展品范围来自同一份发布快照，讲述仍按作者当前公开意愿读取。 */
export const sharedVisitSchema = z.strictObject({
  museum: publicMuseumSchema,
  contributions: z.array(sharedContributionSchema),
});
export type SharedVisit = z.infer<typeof sharedVisitSchema>;
