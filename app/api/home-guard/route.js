import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ncRadonZones } from '@/lib/radonData'; // Bring in your local Radon dataset
import { buildWellTestPlan } from '@/lib/wellTestData'; // Private well / spring test recommendations

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
    // Optional. 'well' or 'spring' switches us off the utility lookup entirely,
    // because there is no utility to look up. Anything else (or missing) keeps
    // the original public-water behavior.
    const waterSource = searchParams.get('water_source');
    // Optional. Year the home was built. Only used to decide whether lead is
    // a likely risk. parseInt returns NaN for junk input, so we normalize to null.
    const rawHomeYear = parseInt(searchParams.get('home_year'), 10);
    const homeYear = Number.isNaN(rawHomeYear) ? null : rawHomeYear;

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

    // 4. PRIVATE WELL / SPRING SHORT-CIRCUIT
    // If the user told us during onboarding that they are on a well or a spring,
    // there is no utility and no PWSID to look up — the Safe Drinking Water Act
    // does not cover them, so no agency has ever tested this water. Skip the
    // database entirely and hand back a test plan instead of a measurement.
    const isPrivateSource = waterSource === 'well' || waterSource === 'spring';

    if (isPrivateSource) {
      const plan = buildWellTestPlan({
        radonZone: zoneNumber,
        homeYear: homeYear,
        waterSource: waterSource,
      });

      waterData = {
        status: 'private_well',
        source_type: waterSource,
        is_regulated: false,
        // Same honesty flag we use on the mold estimate: this is guidance,
        // not a reading. Nothing here was measured at this address.
        is_measured: false,
        message:
          waterSource === 'spring'
            ? 'Springs are not covered by the Safe Drinking Water Act, so no agency tests this water. Because a spring is fed by surface water, testing is more urgent here than for a drilled well.'
            : 'Private wells are not covered by the Safe Drinking Water Act, so no agency tests this water. You are the only person who can find out what is in it.',
        test_plan: plan,
      };
    } else if (pwsid && pwsid !== 'null' && pwsid !== 'undefined') {
      // 5. Check if we actually have a valid PWSID before querying the database
      // (We check for the strings 'null' and 'undefined' just in case the frontend sent them literally)
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
      // 6. The Graceful Fallback: No PWSID was provided and the user did not
      // tell us they are on a well. Falling outside every mapped utility
      // service area is itself a hint that this address may be on a well,
      // so we say so and tell the frontend what to ask.
      waterData = {
        status: 'no_pwsid_available',
        message:
          'No water utility could be matched for this address. Homes outside a mapped utility service area are often on a private well.',
        next_step: 'confirm_water_source',
        hint: 'Re-request this endpoint with water_source=well or water_source=spring to get a testing plan instead.'
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