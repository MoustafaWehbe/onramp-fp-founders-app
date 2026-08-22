import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Prisma 7 dropped the schema-declared datasource URL; the runtime client now
// connects through an explicit driver adapter instead (prisma.config.ts
// carries the URL for the CLI's migrate/studio/db-pull commands only).
const adapter = new PrismaPg(process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/starter_kit");

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["query", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
