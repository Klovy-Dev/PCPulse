/**
 * Générateur de clés de licence NexBoost Pro
 * Usage : node generate-keys.mjs [quantité] [durée_jours] [plan]
 * Ex    : node generate-keys.mjs 5 31 pro
 *         node generate-keys.mjs 1 365 pro
 */

import { createClient } from "@libsql/client";
import { readFileSync } from "fs";
import { randomBytes }  from "crypto";
import { fileURLToPath } from "url";
import { join, dirname } from "path";

// ── Charger .env ─────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath   = join(__dirname, ".env");
let TURSO_URL = "", TURSO_TOKEN = "";
try {
  const env = readFileSync(envPath, "utf8");
  for (const line of env.split("\n")) {
    const [k, ...v] = line.split("=");
    if (k?.trim() === "VITE_TURSO_URL")   TURSO_URL   = v.join("=").trim();
    if (k?.trim() === "VITE_TURSO_TOKEN")  TURSO_TOKEN = v.join("=").trim();
  }
} catch {
  console.error("❌ Impossible de lire le fichier .env");
  process.exit(1);
}

if (!TURSO_URL || !TURSO_TOKEN) {
  console.error("❌ VITE_TURSO_URL ou VITE_TURSO_TOKEN manquant dans .env");
  process.exit(1);
}

// ── Paramètres CLI ───────────────────────────────────────────
const count    = parseInt(process.argv[2] ?? "1",  10);
const duration = parseInt(process.argv[3] ?? "31", 10);
const plan     = process.argv[4] ?? "pro";

if (isNaN(count) || count < 1 || count > 100) {
  console.error("❌ Quantité invalide (1–100)");
  process.exit(1);
}

// ── Connexion Turso ───────────────────────────────────────────
const db = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });

// ── Générer les clés ──────────────────────────────────────────
function generateKey() {
  const hex = randomBytes(8).toString("hex").toUpperCase();
  return `${hex.slice(0,4)}-${hex.slice(4,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}`;
}

const keys = Array.from({ length: count }, generateKey);

// ── Insérer en base ───────────────────────────────────────────
console.log(`\n🔑 Génération de ${count} clé(s) Pro — ${duration} jours\n`);

for (const key of keys) {
  try {
    await db.execute({
      sql:  "INSERT INTO premium_keys (key_value, plan, duration_days) VALUES (?, ?, ?)",
      args: [key, plan, duration],
    });
    console.log(`  ✅  ${key}  [${plan} · ${duration}j]`);
  } catch (e) {
    console.error(`  ❌  ${key}  — ${e.message}`);
  }
}

console.log(`\n✔ ${keys.length} clé(s) insérée(s) dans premium_keys.\n`);
process.exit(0);
