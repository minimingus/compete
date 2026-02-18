import { getEnv } from "./config/env";
import { buildApp } from "./app";
import { getQueue, QUEUE_NAMES } from "./lib/queue";
import { MONITOR_ALL_JOB } from "./jobs/monitoring.job";

async function main() {
  const env = getEnv();
  const app = await buildApp();

  // Set up daily monitoring cron via BullMQ repeatable job
  const monitorQueue = getQueue(QUEUE_NAMES.MONITORING);
  await monitorQueue.add(
    MONITOR_ALL_JOB,
    {},
    {
      repeat: { pattern: "0 6 * * *" }, // daily at 06:00 UTC
      jobId: "daily-monitor",
    }
  );

  await app.listen({ port: env.PORT, host: env.HOST });
  console.log(`Server listening on ${env.HOST}:${env.PORT}`);
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
