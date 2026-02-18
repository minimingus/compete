import { Job } from "bullmq";
import { runDiscovery, DiscoveryInput } from "../services/discovery";

export const DISCOVERY_JOB_NAME = "run-discovery";

export async function handleDiscoveryJob(
  job: Job<DiscoveryInput>
): Promise<void> {
  console.log(
    `[job:discovery] Running discovery for project ${job.data.projectId}`
  );
  await runDiscovery(job.data);
  console.log(
    `[job:discovery] Discovery complete for project ${job.data.projectId}`
  );
}
