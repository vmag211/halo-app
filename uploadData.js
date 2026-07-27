// 1. Tell dotenv exactly which file to look at for your keys
require('dotenv').config({ path: '.env.local' }); 

const fs = require('fs');
const readline = require('readline');
const path = require('path');
const os = require('os');
const { createClient } = require('@supabase/supabase-js');

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

const utilitiesMap = {};

const rl = readline.createInterface({
  input: fs.createReadStream(inputFile),
  crlfDelay: Infinity
});

let isHeader = true;
let cols = {};

console.log('📖 Reading file and grouping data...');

rl.on('line', (line) => {
  const columns = line.split('\t');

  if (isHeader) {
    cols.pwsid = columns.indexOf('PWSID');
    cols.pwsName = columns.indexOf('PWSName');
    cols.sign = columns.indexOf('AnalyticalResultsSign');
    cols.contaminant = columns.indexOf('Contaminant');
    cols.value = columns.indexOf('AnalyticalResultValue');
    cols.date = columns.indexOf('CollectionDate');
    isHeader = false;
  } else {
    const pwsid = columns[cols.pwsid];
    const pwsName = columns[cols.pwsName];
    const sign = columns[cols.sign];

    if (!utilitiesMap[pwsid]) {
      utilitiesMap[pwsid] = {
        pwsid: pwsid,
        pws_name: pwsName,
        status: 'measured',
        contaminants: {} 
      };
    }

    if (sign === '=') {
      const contaminantName = columns[cols.contaminant];
      const date = columns[cols.date];
      const value_ppt = parseFloat(columns[cols.value]) * 1000;

      if (!utilitiesMap[pwsid].contaminants[contaminantName]) {
        utilitiesMap[pwsid].contaminants[contaminantName] = []; 
      }

      utilitiesMap[pwsid].contaminants[contaminantName].push({
        date: date,
        value_ppt: Number(value_ppt.toFixed(2)) 
      });
    }
  }
});

// 4. THIS is the part that was uncommented to fire the data into Supabase
rl.on('close', async () => {
  console.log('✅ File read complete. Preparing to upload to Supabase...');

  const uploadArray = Object.values(utilitiesMap);
  
  console.log(`Found ${uploadArray.length} total utilities. Uploading now...`);

  const { data, error } = await supabase
    .from('ucmr5_utilities')
    .insert(uploadArray);

  if (error) {
    console.error('❌ Error uploading to Supabase:', error.message);
  } else {
    console.log(`🎉 Success! Uploaded all ${uploadArray.length} records to the ucmr5_utilities table.`);
  }
});