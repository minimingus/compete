import { prisma } from "../lib/prisma";

export interface AlertInput {
  trackedPageId: string;
  diffRecordId: string;
  changeScore: number;
  diffText: string;
  pageUrl: string;
  pageLabel: string;
}

/**
 * Create an alert record and attempt to send notification.
 */
export async function createAlert(input: AlertInput): Promise<string> {
  const severity = classifySeverity(input.changeScore);
  const changeType = inferChangeType(input.pageLabel);
  const summary = buildSummary(input);
  const businessImpact = buildImpactNote(input);

  const alert = await prisma.alert.create({
    data: {
      trackedPageId: input.trackedPageId,
      diffRecordId: input.diffRecordId,
      changeType,
      severity,
      summary,
      businessImpact,
      status: "pending",
    },
  });

  // Attempt to send notification
  await sendNotification(alert.id, input);

  return alert.id;
}

function classifySeverity(changeScore: number): string {
  if (changeScore > 0.5) return "high";
  if (changeScore > 0.15) return "medium";
  return "low";
}

function inferChangeType(pageLabel: string): string {
  const label = pageLabel.toLowerCase();
  if (label.includes("pricing")) return "pricing_change";
  if (label.includes("feature")) return "feature_update";
  if (label.includes("product")) return "product_update";
  if (label.includes("blog")) return "content_update";
  return "page_change";
}

function buildSummary(input: AlertInput): string {
  const pct = Math.round(input.changeScore * 100);
  return `${input.pageLabel} page at ${input.pageUrl} changed by ~${pct}%`;
}

function buildImpactNote(input: AlertInput): string {
  const label = input.pageLabel.toLowerCase();
  if (label.includes("pricing")) {
    return "Competitor may have updated their pricing — review for positioning impact.";
  }
  if (label.includes("feature")) {
    return "Competitor may have launched or updated features — review for competitive gaps.";
  }
  return "Competitor page content changed — review for strategic relevance.";
}

/**
 * Send alert notification. Stub for v1 — logs to console.
 * Replace with SES/SendGrid/Slack integration.
 */
async function sendNotification(
  alertId: string,
  input: AlertInput
): Promise<void> {
  // TODO: Wire up real email sending (SES/SendGrid)
  console.log(`[alert] Would send notification for alert ${alertId}:`);
  console.log(`  Page: ${input.pageUrl}`);
  console.log(`  Change score: ${(input.changeScore * 100).toFixed(1)}%`);

  await prisma.alert.update({
    where: { id: alertId },
    data: {
      sentVia: "console_stub",
      sentAt: new Date(),
      status: "sent",
    },
  });
}
