import { Job } from "bullmq";
import { monitorPage, monitorAllActivePages } from "../services/monitor";

export const MONITOR_PAGE_JOB = "monitor-page";
export const MONITOR_ALL_JOB = "monitor-all";

export async function handleMonitorPageJob(
  job: Job<{ trackedPageId: string }>
): Promise<void> {
  console.log(
    `[job:monitor] Monitoring page ${job.data.trackedPageId}`
  );
  await monitorPage(job.data.trackedPageId);
}

export async function handleMonitorAllJob(_job: Job): Promise<void> {
  console.log("[job:monitor] Running full monitoring sweep");
  await monitorAllActivePages();
}
