// 1. Tell dotenv exactly which file to look at for your keys
require('dotenv').config({ path: '.env.local' });

const fs = require('fs');
const readline = require('readline');
const path = require('path');
const os = require('os');
const { createClient } = require('@supabase/supabase-js');
// Detections ('=') and documented non-detects ('<', with their reporting limit),
// in the reading shape lib/scoring.js reads. See lib/ucmr5Import.cjs.
const { parseUcmr5Lines } = require('./lib/ucmr5Import.cjs');

// 2. Pull the secrets from .env.local
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Error: Could not find Supabase keys in .env.local');
  process.exit(1);
}

// 3. Connect to Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const inputFile = path.join(os.homedir(), 'Downloads', 'ucmr5-occurrence-data', 'ucmr5_nc_only.txt');

const rl = readline.createInterface({
  input: fs.createReadStream(inputFile),
  crlfDelay: Infinity
});

const lines = [];

console.log('📖 Reading file and grouping data...');

rl.on('line', (line) => {
  lines.push(line);
});

// 4. Group, then write. Upsert by PWSID so a reload replaces each utility's row
// (pwsid is the primary key, so a plain insert fails on a second load), and
// stamp created_at so the source page dates the reload, not the first load.
rl.on('close', async () => {
  const { utilities, stats } = parseUcmr5Lines(lines);
  console.log('✅ File read complete.', stats);

  const loadedAt = new Date().toISOString();
  const uploadArray = utilities.map((u) => ({ ...u, created_at: loadedAt }));

  console.log(`Found ${uploadArray.length} total utilities. Uploading now...`);

  const { error } = await supabase
    .from('ucmr5_utilities')
    .upsert(uploadArray, { onConflict: 'pwsid' });

  if (error) {
    console.error('❌ Error uploading to Supabase:', error.message);
  } else {
    console.log(`🎉 Success! Upserted all ${uploadArray.length} records to the ucmr5_utilities table.`);
  }
});
