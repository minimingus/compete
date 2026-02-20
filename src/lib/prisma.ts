import { neon } from "@neondatabase/serverless";
import { PrismaNeonHTTP } from "@prisma/adapter-neon";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  // HTTP adapter: each query is a fresh stateless HTTP request to Neon.
  // Avoids WebSocket idle-timeout drops that occur in long-running functions.
  const sql = neon(process.env.DATABASE_URL!);
  const adapter = new PrismaNeonHTTP(sql);
  return new PrismaClient({ adapter });
}

// Reuse client across hot-reloads in development / across Vercel invocations
export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
