export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  jwt: {
    secret: process.env.JWT_SECRET ?? 'dev-secret',
    expiry: process.env.JWT_EXPIRY ?? '1h',
  },
  hcm: {
    baseUrl: process.env.HCM_BASE_URL ?? 'http://localhost:4000',
    apiKey: process.env.HCM_API_KEY ?? '',
    webhookSecret: process.env.HCM_WEBHOOK_SECRET ?? '',
    maxRetries: parseInt(process.env.HCM_MAX_RETRIES ?? '5', 10),
    timeoutMs: parseInt(process.env.HCM_TIMEOUT_MS ?? '5000', 10),
  },
  database: {
    path: process.env.DATABASE_PATH ?? './data/timeoff.db',
  },
  sync: {
    verificationDelayMs: parseInt(process.env.SYNC_VERIFICATION_DELAY_MS ?? '300000', 10),
  },
});
 