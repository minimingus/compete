import { Queue } from "bullmq";
import { getEnv } from "../config/env";

export const QUEUE_NAMES = {
  DISCOVERY: "competitor-discovery",
  MONITORING: "page-monitoring",
} as const;

const queues = new Map<string, Queue>();

export function getQueue(name: string): Queue {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, { connection: { url: getEnv().REDIS_URL } });
    queues.set(name, queue);
  }
  return queue;
}
