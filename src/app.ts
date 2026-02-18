import Fastify, { FastifyInstance } from "fastify";
import { projectRoutes } from "./routes/projects";
import { competitorRoutes } from "./routes/competitors";
import { monitoringRoutes } from "./routes/monitoring";

let _app: FastifyInstance | null = null;

export async function buildApp(): Promise<FastifyInstance> {
  if (_app) return _app;

  const app = Fastify({ logger: true });

  // Root + health check
  app.get("/", async () => ({
    name: "Competitor Monitor API",
    version: "0.1.0",
    endpoints: [
      "GET  /health",
      "POST /projects",
      "GET  /projects",
      "GET  /projects/:id",
      "GET  /projects/:id/competitors/pending",
      "POST /projects/:id/competitors/:competitorId/approve",
      "POST /projects/:id/competitors/bulk-approve",
      "POST /monitoring/run",
      "GET  /projects/:id/snapshots",
      "GET  /projects/:id/alerts",
    ],
  }));
  app.get("/health", async () => ({ status: "ok" }));

  // Register route modules
  await app.register(projectRoutes);
  await app.register(competitorRoutes);
  await app.register(monitoringRoutes);

  await app.ready();
  _app = app;
  return app;
}
