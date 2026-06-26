import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/utils/auth";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await hashPassword("Admin1234!");

  await prisma.user.upsert({
    where: { email: "admin@example.com" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      email: "admin@example.com",
      passwordHash,
      name: "Admin User",
      role: "admin",
      emailVerified: true,
    },
  });

  console.info("Seed complete: admin@example.com");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
