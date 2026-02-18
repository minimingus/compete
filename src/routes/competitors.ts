import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma";

const approvalSchema = z.object({
  status: z.enum(["approved", "rejected"]),
});

const bulkApprovalSchema = z.object({
  decisions: z.array(
    z.object({
      competitorId: z.string(),
      status: z.enum(["approved", "rejected"]),
      activePageIds: z.array(z.string()).optional(),
    })
  ),
});

export async function competitorRoutes(app: FastifyInstance): Promise<void> {
  // Update a single competitor's status
  app.patch<{ Params: { id: string } }>(
    "/competitors/:id",
    async (req, reply) => {
      const { status } = approvalSchema.parse(req.body);

      const competitor = await prisma.competitor.update({
        where: { id: req.params.id },
        data: { status },
      });

      return competitor;
    }
  );

  // Bulk approve/reject competitors + activate pages
  app.post<{ Params: { projectId: string } }>(
    "/projects/:projectId/approve",
    async (req, reply) => {
      const { decisions } = bulkApprovalSchema.parse(req.body);

      for (const decision of decisions) {
        // Update competitor status
        await prisma.competitor.update({
          where: { id: decision.competitorId },
          data: { status: decision.status },
        });

        if (decision.status === "approved" && decision.activePageIds?.length) {
          // Activate selected pages
          await prisma.trackedPage.updateMany({
            where: {
              id: { in: decision.activePageIds },
              competitorId: decision.competitorId,
            },
            data: { isActive: true },
          });
        }

        if (decision.status === "rejected") {
          // Deactivate all pages for rejected competitors
          await prisma.trackedPage.updateMany({
            where: { competitorId: decision.competitorId },
            data: { isActive: false },
          });
        }
      }

      // Activate project if at least one competitor is approved
      const projectId = req.params.projectId;
      const approvedCount = await prisma.competitor.count({
        where: { projectId, status: "approved" },
      });

      if (approvedCount > 0) {
        await prisma.project.update({
          where: { id: projectId },
          data: { status: "active" },
        });
      }

      return { ok: true, approvedCompetitors: approvedCount };
    }
  );

  // Get competitors for a project
  app.get<{ Params: { projectId: string } }>(
    "/projects/:projectId/competitors",
    async (req) => {
      return prisma.competitor.findMany({
        where: { projectId: req.params.projectId },
        include: { sources: true, pages: true },
        orderBy: { confidence: "desc" },
      });
    }
  );
}
