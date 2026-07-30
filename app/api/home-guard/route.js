import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ncRadonZones } from '@/lib/radonData'; // Bring in your local Radon dataset

// 1. Connect to Supabase using your safe, public keys
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function GET(request) {
  try {
    // 2. Extract parameters from the URL
    const { searchParams } = new URL(request.url);
    const county = searchParams.get('county');
    const pwsid = searchParams.get('pwsid');

    // 3. Safety check: ONLY require the county.
    if (!county) {
      return NextResponse.json(
        { error: 'The county query parameter is required.' },
        { status: 400 }
      );
    }

    // ==========================================
    // MODULE 1: RADON RISK LOOKUP (Local Data)
    // ==========================================
    let radonData = {};
    const zoneNumber = ncRadonZones[county];

    if (!zoneNumber) {
      radonData = { error: `County '${county}' not found in North Carolina radon dataset.` };
    } else {
      let riskLevel = 'Low';
      if (zoneNumber === 1) riskLevel = 'High';
      else if (zoneNumber === 2) riskLevel = 'Moderate';

      radonData = {
        county: county,
        zone: zoneNumber,
        risk_level: riskLevel
      };
    }

    // ==========================================
    // MODULE 2: PFAS WATER LOOKUP (Supabase)
    // ==========================================
    let waterData = {};

    // 4. Check if we actually have a valid PWSID before querying the database
    // (We check for the strings 'null' and 'undefined' just in case the frontend sent them literally)
    if (pwsid && pwsid !== 'null' && pwsid !== 'undefined') {
      const { data, error } = await supabase
        .from('ucmr5_utilities')
        .select('pws_name, status, contaminants')
        .eq('pwsid', pwsid)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          waterData = {
            status: 'no_data_yet',
            message: 'UCMR5 testing data is not yet available for this utility. The EPA updates this database quarterly.'
          };
        } else {
          throw error; // Real database crash
        }
      } else {
        waterData = {
          pws_name: data.pws_name,
          status: data.status,
          contaminants: data.contaminants
        };
      }
    } else {
      // 5. The Graceful Fallback: No PWSID was provided
      waterData = {
        status: 'no_pwsid_available',
        message: 'No water utility could be matched for this address.'
      };
    }

    // ==========================================
    // FINAL OUTPUT: THE COMBINED PAYLOAD
    // ==========================================
    return NextResponse.json({
      success: true,
      radon: radonData,
      water: waterData
    });

  } catch (err) {
    console.error('HomeGuard API Error:', err);
    return NextResponse.json(
      { error: 'Internal Server Error while fetching HomeGuard data.' },
      { status: 500 }
    );
  }
}