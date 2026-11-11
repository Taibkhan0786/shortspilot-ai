#!/bin/sh
# Container start: create/upgrade the database automatically, seed plans + admin, start the app.
set -e
mkdir -p "$(dirname "${DATABASE_URL#file:}")" "${UPLOAD_DIR:-/data/uploads}"

echo "[entrypoint] creating/updating database schema…"
npx prisma db push --skip-generate

echo "[entrypoint] seeding plans + admin account (idempotent)…"
npx tsx prisma/seed.ts

echo "[entrypoint] starting ShortsPilot AI on port ${PORT:-3000}"
exec node .next/standalone/server.js
