import { Worker } from "bullmq";
import { getEnv } from "./config/env";
import { QUEUE_NAMES } from "./lib/queue";
import {
  DISCOVERY_JOB_NAME,
  handleDiscoveryJob,
} from "./jobs/discovery.job";
import {
  MONITOR_PAGE_JOB,
  MONITOR_ALL_JOB,
  handleMonitorPageJob,
  handleMonitorAllJob,
} from "./jobs/monitoring.job";

const connection = { url: getEnv().REDIS_URL };

// Discovery worker
const discoveryWorker = new Worker(
  QUEUE_NAMES.DISCOVERY,
  async (job) => {
    if (job.name === DISCOVERY_JOB_NAME) {
      await handleDiscoveryJob(job);
    }
  },
  { connection, concurrency: 2 }
);

// Monitoring worker
const monitoringWorker = new Worker(
  QUEUE_NAMES.MONITORING,
  async (job) => {
    switch (job.name) {
      case MONITOR_PAGE_JOB:
        await handleMonitorPageJob(job);
        break;
      case MONITOR_ALL_JOB:
        await handleMonitorAllJob(job);
        break;
    }
  },
  { connection, concurrency: 5 }
);

// Graceful shutdown
async function shutdown() {
  console.log("[worker] Shutting down...");
  await discoveryWorker.close();
  await monitoringWorker.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("[worker] Workers started. Waiting for jobs...");
