/**
 * Seed learn_content (English) from the code module into the DB.
 *
 * /api/learn already serves from lib/learnContent.js, so this is only needed to
 * populate the table for future DB-backed editing and to sit alongside the
 * human-reviewed Spanish rows. Run AFTER migration 0005 is applied:
 *   node scripts/seed-learn.mjs
 */
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import { LEARN_CONTENT } from "../lib/learnContent.js";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const rows = Object.entries(LEARN_CONTENT).map(([topic, c]) => ({
  topic,
  locale: "en",
  what_it_is: c.what_it_is,
  protect: c.protect,
  household: c.household,
  sources: c.sources,
  updated_at: new Date().toISOString(),
}));

const { error } = await admin.from("learn_content").upsert(rows, { onConflict: "topic,locale" });
if (error) {
  console.error("Seed failed (is migration 0005 applied?):", error.message);
  process.exit(1);
}
console.log(`Seeded ${rows.length} English Learn topics.`);
