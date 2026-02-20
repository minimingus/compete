import Fastify, { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { projectRoutes } from "./routes/projects";
import { competitorRoutes } from "./routes/competitors";
import { monitoringRoutes } from "./routes/monitoring";

let _app: FastifyInstance | null = null;

export async function buildApp(): Promise<FastifyInstance> {
  if (_app) return _app;

  const app = Fastify({ logger: true });

  // Global error handler — turns Zod + Prisma errors into clean HTTP responses
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        issues: err.issues,
      });
    }
    app.log.error(err);
    return reply.status(err.statusCode ?? 500).send({
      statusCode: err.statusCode ?? 500,
      error: err.name ?? "Internal Server Error",
      message: err.message,
    });
  });

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
