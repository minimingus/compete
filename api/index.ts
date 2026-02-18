import type { VercelRequest, VercelResponse } from "@vercel/node";
import { buildApp } from "../src/app";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  const app = await buildApp();
  await app.ready();
  app.server.emit("request", req, res);
}
