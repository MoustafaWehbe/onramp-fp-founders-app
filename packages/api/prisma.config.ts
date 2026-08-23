import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma 7 no longer reads the connection URL from schema.prisma the CLI
// (migrate, studio, db pull, etc.) gets it from here, while the runtime
// PrismaClient gets its own connection via the adapter in src/db/prisma.ts.
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
});
