// Seed script - for MVP, scenarios are served from contracts directly.
// This file can be run standalone to create the DB schema and insert test data.

import { SEED_SCENARIOS } from '../../../contracts/src/scenarios.js';
import { prisma } from './client.js';

async function seed() {
  console.log('Seeding database...');

  // Create a mock user for testing
  const testUser = await prisma.user.upsert({
    where: { openId: 'mock-openid-testuser' },
    update: {},
    create: {
      openId: 'mock-openid-testuser',
      language: 'en',
      level: 4,
      nickname: 'Test User',
    },
  });

  console.log(`Created test user: ${testUser.id}`);
  console.log(`Loaded ${SEED_SCENARIOS.length} scenarios from contracts`);
  console.log('Seed complete.');
}

seed()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
