import { prisma } from "../lib/prisma";
import { fetchPageContent } from "./crawler";
import { computeDiff } from "./differ";
import { createAlert } from "./alerter";
import { getEnv } from "../config/env";

/**
 * Monitor a single tracked page:
 * 1. Fetch current content
 * 2. Compare hash to last snapshot
 * 3. If changed: compute diff, score it, optionally create alert
 */
export async function monitorPage(trackedPageId: string): Promise<void> {
  const page = await prisma.trackedPage.findUniqueOrThrow({
    where: { id: trackedPageId },
    include: {
      snapshots: { orderBy: { fetchedAt: "desc" }, take: 1 },
    },
  });

  let statusCode: number | null = null;
  let textContent: string;
  let contentHash: string;
  let error: string | undefined;

  try {
    const result = await fetchPageContent(page.url);
    statusCode = result.statusCode;
    textContent = result.textContent;
    contentHash = result.contentHash;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    console.error(`[monitor] Failed to fetch ${page.url}: ${error}`);

    // Store error snapshot
    await prisma.snapshot.create({
      data: {
        trackedPageId,
        statusCode: null,
        error,
        contentHash: "",
        textContent: "",
      },
    });
    return;
  }

  // Save snapshot
  const newSnapshot = await prisma.snapshot.create({
    data: {
      trackedPageId,
      statusCode,
      contentHash,
      textContent,
    },
  });

  const lastSnapshot = page.snapshots[0];

  // First snapshot — nothing to compare
  if (!lastSnapshot) {
    console.log(`[monitor] First snapshot for ${page.url}`);
    return;
  }

  // No change
  if (lastSnapshot.contentHash === contentHash) {
    console.log(`[monitor] No change for ${page.url}`);
    return;
  }

  // Content changed — compute diff
  const { diffText, changeScore } = computeDiff(
    lastSnapshot.textContent,
    textContent
  );

  console.log(
    `[monitor] Change detected on ${page.url} — score: ${(changeScore * 100).toFixed(1)}%`
  );

  const diffRecord = await prisma.diffRecord.create({
    data: {
      trackedPageId,
      snapshotOldId: lastSnapshot.id,
      snapshotNewId: newSnapshot.id,
      diffText,
      changeScore,
    },
  });

  // Create alert if above threshold
  const threshold = getEnv().CHANGE_SCORE_THRESHOLD;
  if (changeScore >= threshold) {
    await createAlert({
      trackedPageId,
      diffRecordId: diffRecord.id,
      changeScore,
      diffText,
      pageUrl: page.url,
      pageLabel: page.label,
    });
  }
}

/**
 * Run monitoring for all active tracked pages.
 * Called by the daily cron job / BullMQ repeatable.
 */
export async function monitorAllActivePages(): Promise<void> {
  const activePages = await prisma.trackedPage.findMany({
    where: { isActive: true },
  });

  console.log(
    `[monitor] Starting monitoring run for ${activePages.length} active pages`
  );

  for (const page of activePages) {
    try {
      await monitorPage(page.id);
    } catch (err) {
      console.error(
        `[monitor] Unhandled error monitoring page ${page.id}:`,
        err
      );
    }
  }

  console.log("[monitor] Monitoring run complete");
}
