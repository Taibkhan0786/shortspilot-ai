/**
 * Seed: plans (PRD §6.18) + admin user.
 * Run: bun prisma/seed.ts
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/password";

const db = new PrismaClient();

const PLANS = [
  {
    id: "free_trial",
    name: "Free Trial",
    price: 0,
    priceInr: 0,
    shortsLimit: 3,
    channelsLimit: 1,
    watermark: true,
    order: 0,
    features: JSON.stringify([
      "3 generated Shorts",
      "1 channel",
      "Watermarked previews",
      "AI Studio access",
    ]),
  },
  {
    id: "starter",
    name: "Starter",
    price: 9,
    priceInr: 749,
    shortsLimit: 30,
    channelsLimit: 1,
    watermark: false,
    order: 1,
    features: JSON.stringify([
      "30 Shorts / month",
      "1 channel",
      "No watermark",
      "Scheduled publishing",
      "Email support",
    ]),
  },
  {
    id: "pro",
    name: "Pro",
    price: 24,
    priceInr: 1999,
    shortsLimit: 100,
    channelsLimit: 3,
    watermark: false,
    order: 2,
    features: JSON.stringify([
      "100 Shorts / month",
      "3 channels",
      "No watermark",
      "Full automation mode",
      "Analytics dashboard",
      "Priority support",
    ]),
  },
  {
    id: "agency",
    name: "Agency",
    price: 59,
    priceInr: 4999,
    shortsLimit: 300,
    channelsLimit: 10,
    watermark: false,
    order: 3,
    features: JSON.stringify([
      "300 Shorts / month",
      "10 channels",
      "No watermark",
      "Agency workspaces",
      "Usage & cost reporting",
      "Dedicated support",
    ]),
  },
];

async function main() {
  for (const p of PLANS) {
    await db.plan.upsert({
      where: { id: p.id },
      update: p,
      create: p,
    });
  }
  console.log("✓ Plans seeded");

  const adminEmail = "admin@shortspilot.ai";
  const existing = await db.user.findUnique({ where: { email: adminEmail } });
  if (!existing) {
    const admin = await db.user.create({
      data: {
        email: adminEmail,
        name: "SaaS Admin",
        role: "ADMIN",
        passwordHash: hashPassword("admin12345"),
      },
    });
    await db.userProfile.create({
      data: { userId: admin.id, onboarded: true, displayName: "SaaS Admin", monthlyLimit: 1000000 },
    });
    const trial = await db.plan.findUnique({ where: { id: "agency" } });
    await db.subscription.create({
      data: {
        userId: admin.id,
        planId: "agency",
        status: "ACTIVE",
        periodEnd: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      },
    });
    await db.creditLedger.create({
      data: {
        userId: admin.id,
        type: "GRANT",
        amount: 1000,
        balance: 1000,
        description: "Admin welcome credits",
      },
    });
    console.log("✓ Admin user created:", adminEmail, "/ admin12345");
  } else {
    console.log("• Admin already exists");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
