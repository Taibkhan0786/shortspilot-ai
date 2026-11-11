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

  // Fresh-install defaults: premium voice engine + Flow-style cinematic motion.
  // (Existing values set by an Admin are never overwritten.)
  const defaultSettings: { key: string; value: string }[] = [
    { key: "voice_provider", value: "elevenlabs" }, // ElevenLabs speaks every voice first (falls back to Gemini/Edge free TTS without a key)
    { key: "veo_enabled", value: "true" }, // real AI character/scene motion (falls back to cinematic zoom automatically when unavailable)
    { key: "veo_engine", value: "veo3" }, // Flow-AI cinematic quality (Omni Flash = fast mode)
  ];
  for (const s of defaultSettings) {
    const existing = await db.appSetting.findUnique({ where: { key: s.key } });
    if (!existing) {
      await db.appSetting.create({ data: s });
    }
  }
  console.log("✓ Default settings seeded (voice_provider=elevenlabs, veo_enabled=true)");

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
