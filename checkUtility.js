const fs = require('fs');
const readline = require('readline');
const path = require('path');
const os = require('os');

// 1. Automatically find the Downloads folder on your computer
const inputFile = path.join(os.homedir(), 'Downloads', 'ucmr5-occurrence-data', 'ucmr5_nc_only.txt');
const targetUtility = 'NC0160010'; // The specific PWSID we want to investigate

// 2. Set up the file reader (the "conveyor belt")
const rl = readline.createInterface({
  input: fs.createReadStream(inputFile),
  crlfDelay: Infinity 
});

let isHeader = true;

// Added 'date' to our column tracker
let cols = {
  pwsid: -1,
  sign: -1,
  contaminant: -1,
  value: -1,
  date: -1 // <-- NEW
};

console.log(`\n🔍 Scanning data for Water Utility: ${targetUtility}...`);
console.log(`------------------------------------------------------------------`);

// 3. Process every line one by one
rl.on('line', (line) => {
  const columns = line.split('\t'); // Split the row by the invisible Tab spaces

  if (isHeader) {
    // Find the exact positions of the columns we care about
    cols.pwsid = columns.indexOf('PWSID');
    cols.sign = columns.indexOf('AnalyticalResultsSign');
    cols.contaminant = columns.indexOf('Contaminant');
    cols.value = columns.indexOf('AnalyticalResultValue');
    cols.date = columns.indexOf('CollectionDate'); // <-- NEW
    
    isHeader = false; // Move on to the actual data
  } else {
    // 4. Extract the data from this specific row
    const rowPwsid = columns[cols.pwsid];
    const rowSign = columns[cols.sign];

    // 5. Check if it matches our utility AND was actually detected
    if (rowPwsid === targetUtility && rowSign === '=') {
      
      const contaminantName = columns[cols.contaminant];
      const collectionDate = columns[cols.date]; // <-- NEW
      
      // Convert the string number to a math decimal, then multiply by 1000 (µg/L to ng/L)
      const rawValue = parseFloat(columns[cols.value]);
      const convertedValue = rawValue * 1000;

      // 6. Print the result nicely to the terminal, now with the date!
      // .padStart(5) just keeps the decimal points perfectly aligned if a number is 1 digit vs 2 digits.
      console.log(`⚠️ DETECTED: ${contaminantName.padEnd(15)} | ${convertedValue.toFixed(2).padStart(5)} ng/L (ppt) | Date: ${collectionDate}`);
    }
  }
});

// 7. Tell us when it's done searching
rl.on('close', () => {
  console.log(`------------------------------------------------------------------`);
  console.log(`✅ Finished scanning utility data.\n`);
});