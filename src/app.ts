import Fastify, { FastifyInstance } from "fastify";
import { projectRoutes } from "./routes/projects";
import { competitorRoutes } from "./routes/competitors";
import { monitoringRoutes } from "./routes/monitoring";

let _app: FastifyInstance | null = null;

export async function buildApp(): Promise<FastifyInstance> {
  if (_app) return _app;

  const app = Fastify({ logger: true });

  // Health check
  app.get("/health", async () => ({ status: "ok" }));

  // Register route modules
  await app.register(projectRoutes);
  await app.register(competitorRoutes);
  await app.register(monitoringRoutes);

  await app.ready();
  _app = app;
  return app;
}
