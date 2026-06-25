import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const user = await prisma.user.findUnique({ where: { email: '[EMAIL_ADDRESS]' } });
  console.log(user);
}
main().finally(() => prisma.$disconnect());
