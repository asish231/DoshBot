import { z } from 'zod';

export const askQuestionSchema = z
  .object({
    question: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .describe('The question to ask the user.'),
    options: z
      .array(z.string().trim().min(1).max(200))
      .min(2)
      .max(6)
      .describe('2 to 6 distinct options for the user to choose from.'),
    is_multi_select: z
      .boolean()
      .optional()
      .default(false)
      .describe('Whether the user can select multiple options.'),
    context: z
      .string()
      .trim()
      .max(1000)
      .optional()
      .describe('Brief context explaining why this decision is needed.'),
  })
  .strict();

export type AskQuestionArgs = z.infer<typeof askQuestionSchema>;

export const askQuestionTool = {
  name: 'ask_question',
  description:
    'Ask the user ONE multiple-choice question for a genuinely blocking decision: an irreversible or costly action, or a request that is impossible to interpret. Do NOT use this for open-ended requests — for those, pick sensible defaults, state assumptions, and deliver results. When you do use it, return their answer and proceed immediately.',
  parameters: z.toJSONSchema(askQuestionSchema),
};
