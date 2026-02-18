import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { runDiscovery } from "../services/discovery";

const createProjectSchema = z.object({
  name: z.string().min(1),
  ownerEmail: z.string().email(),
  companyDomain: z.string().min(1),
  keywords: z.array(z.string()).optional(),
});

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  // Create a new project + kick off discovery
  app.post("/projects", async (req, reply) => {
    const body = createProjectSchema.parse(req.body);

    const project = await prisma.project.create({
      data: {
        name: body.name,
        ownerEmail: body.ownerEmail,
        companyDomain: body.companyDomain,
        status: "discovery_pending",
      },
    });

    // Run competitor discovery inline (works in both standalone and serverless)
    await runDiscovery({
      projectId: project.id,
      companyDomain: body.companyDomain,
      keywords: body.keywords,
    });

    return reply.status(201).send(project);
  });

  // Get a project with competitors and their pages
  app.get<{ Params: { id: string } }>(
    "/projects/:id",
    async (req, reply) => {
      const project = await prisma.project.findUnique({
        where: { id: req.params.id },
        include: {
          competitors: {
            include: {
              sources: true,
              pages: true,
            },
          },
        },
      });

      if (!project) {
        return reply.status(404).send({ error: "Project not found" });
      }

      return project;
    }
  );

  // List all projects
  app.get("/projects", async () => {
    return prisma.project.findMany({
      orderBy: { createdAt: "desc" },
    });
  });
}
