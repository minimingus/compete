import { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma";
import { monitorAllActivePages } from "../services/monitor";
import { getEnv } from "../config/env";

export async function monitoringRoutes(app: FastifyInstance): Promise<void> {
  // Trigger monitoring for all active pages.
  // Supports both:
  //   - Vercel Cron (GET with Authorization: Bearer <CRON_SECRET>)
  //   - Manual trigger (POST)
  app.get("/monitoring/run", async (req, reply) => {
    const cronSecret = getEnv().CRON_SECRET;
    if (cronSecret) {
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${cronSecret}`) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
    }

    await monitorAllActivePages();
    return { ok: true, message: "Monitoring run complete" };
  });

  app.post("/monitoring/run", async (_req, reply) => {
    await monitorAllActivePages();
    return reply.status(200).send({ ok: true, message: "Monitoring run complete" });
  });

  // Trigger monitoring for a single page
  app.post<{ Params: { pageId: string } }>(
    "/monitoring/pages/:pageId/run",
    async (req, reply) => {
      const { monitorPage } = await import("../services/monitor");
      const page = await prisma.trackedPage.findUnique({
        where: { id: req.params.pageId },
      });

      if (!page) {
        return reply.status(404).send({ error: "Page not found" });
      }

      await monitorPage(page.id);
      return reply.status(200).send({ ok: true, message: "Page monitored" });
    }
  );

  // Get snapshots for a tracked page
  app.get<{ Params: { pageId: string } }>(
    "/pages/:pageId/snapshots",
    async (req) => {
      return prisma.snapshot.findMany({
        where: { trackedPageId: req.params.pageId },
        orderBy: { fetchedAt: "desc" },
        take: 50,
      });
    }
  );

  // Get alerts for a tracked page
  app.get<{ Params: { pageId: string } }>(
    "/pages/:pageId/alerts",
    async (req) => {
      return prisma.alert.findMany({
        where: { trackedPageId: req.params.pageId },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
    }
  );

  // Get all alerts for a project
  app.get<{ Params: { projectId: string } }>(
    "/projects/:projectId/alerts",
    async (req) => {
      return prisma.alert.findMany({
        where: {
          trackedPage: {
            competitor: { projectId: req.params.projectId },
          },
        },
        include: {
          trackedPage: {
            include: { competitor: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
    }
  );
}
