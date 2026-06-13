import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2];
  
  if (!email) {
    console.error('❌ Please provide the email of the user you want to make an admin.');
    console.error('Usage: node scripts/makeAdmin.js <user-email>');
    process.exit(1);
  }

  const user = await prisma.user.findUnique({
    where: { email }
  });

  if (!user) {
    console.error(`❌ User with email ${email} not found!`);
    process.exit(1);
  }

  // Add the admin role (upsert to avoid errors if they are already an admin)
  await prisma.user_roles.upsert({
    where: { 
      user_id_role: { 
        user_id: user.id, 
        role: 'admin' 
      } 
    },
    create: { 
      user_id: user.id, 
      role: 'admin' 
    },
    update: {}
  });

  console.log(`✅ Successfully granted 'admin' role to ${email}!`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
