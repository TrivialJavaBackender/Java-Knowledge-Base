/**
 * Create a user in the database.
 * Usage:
 *   node_modules/.bin/tsx scripts/create-user.ts <username> <password>
 */

import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';

const [, , username, password] = process.argv;

if (!username || !password) {
  console.error('Usage: tsx scripts/create-user.ts <username> <password>');
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await hash(password, 12);
  await prisma.user.upsert({
    where: { username },
    create: { username, passwordHash },
    update: { passwordHash },
  });
  console.log(`User "${username}" created/updated.`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
