import { z } from 'zod';

const nonEmpty = z.string().min(1);
const port = z.coerce.number().int().positive();

export const configSchema = z.object({
  DATABASE_URL: nonEmpty,
  PLATFORM_API_URL: nonEmpty,
  EXECUTION_TOKEN_SIGNING_KEY: z.string().min(32),
  PORT: port.default(3000),
});

export type DataDaemonConfig = z.infer<typeof configSchema>;
