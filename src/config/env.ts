import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string(),
  DIRECT_DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("0.0.0.0"),
  CRON_SECRET: z.string().optional(),
  CHANGE_SCORE_THRESHOLD: z.coerce.number().default(0.05),
  BRAVE_SEARCH_API_KEY: z.string().optional(),
  SERPER_API_KEY: z.string().optional(),
  // Email config (stub for v1)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  ALERT_FROM_EMAIL: z.string().default("alerts@competitor-monitor.local"),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (!_env) {
    _env = envSchema.parse(process.env);
  }
  return _env;
}
