import { createHash } from "crypto";

/**
 * Fetch a URL and extract its stable text content.
 *
 * MVP implementation uses a simple fetch + regex-based HTML stripping.
 * For production, swap in Playwright for JS-rendered pages.
 */
export async function fetchPageContent(
  url: string
): Promise<{ statusCode: number; textContent: string; contentHash: string }> {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "CompetitorMonitor/0.1 (compatible; monitoring bot; +https://competitor-monitor.local)",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });

  const html = await response.text();
  const textContent = extractText(html);
  const contentHash = createHash("sha256").update(textContent).digest("hex");

  return {
    statusCode: response.status,
    textContent,
    contentHash,
  };
}

/**
 * Strip HTML tags and collapse whitespace to get stable text content.
 * This is intentionally simple — upgrade to a proper DOM parser
 * (cheerio/jsdom) or Playwright for better accuracy.
 */
function extractText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
