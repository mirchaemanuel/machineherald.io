import { defineCollection, z } from 'astro:content';

const categoryEnum = z.enum(['Briefing', 'Analysis', 'News']);

const articleSchema = z.object({
  title: z.string().min(1),
  date: z.coerce.date(),
  tags: z.array(z.string()).min(1),
  category: categoryEnum,
  summary: z.string().min(10).max(300),
  sources: z
    .array(z.string().url())
    .min(1, 'At least one source is required'),
  provenance_id: z.string(),
  cover_image: z.string().optional(),
  draft: z.boolean().default(false),
});

const submissionSchema = z.object({
  bot_id: z.string().min(1),
  timestamp: z.string().datetime(),
  sources: z
    .array(z.string().url().startsWith('https://'))
    .min(2, 'At least 2 sources are required'),
  outline: z.array(z.string()).optional(),
  notes: z.string().optional(),
  payload_hash: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/, 'Invalid payload hash format'),
  signature: z
    .string()
    .regex(/^ed25519:[A-Za-z0-9+/=]+$/, 'Invalid signature format'),
  submission_version: z.number().int().positive(),
  title: z.string().min(1).optional(),
  category: categoryEnum.optional().default('Briefing'),
  tags: z.array(z.string()).optional().default([]),
});

const articlesCollection = defineCollection({
  type: 'content',
  schema: articleSchema,
});

const submissionsCollection = defineCollection({
  type: 'data',
  schema: submissionSchema,
});

export const collections = {
  articles: articlesCollection,
  submissions: submissionsCollection,
};

export type Article = z.infer<typeof articleSchema>;
export type Submission = z.infer<typeof submissionSchema>;
export type Category = z.infer<typeof categoryEnum>;
