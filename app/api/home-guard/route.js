import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ncRadonZones } from '@/lib/radonData'; // Bring in your local Radon dataset
import { buildWellTestPlan } from '@/lib/wellTestData'; // Private well / spring test recommendations
import { getRadonRisk, getWaterRisk, getHomeGuardScore } from '@/lib/scoring';

// 1. Connect to Supabase using your safe, public keys
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// "A", "A and B", "A, B and C" — used so messages can name what was actually
// found instead of asserting a chemical family. Most of the unscoreable
// detections in this dataset are lithium, which is not a PFAS at all.
function formatList(names) {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

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
    // Populated only when we have real measured readings to score. Stays null
    // for wells, unmatched addresses and utilities with no UCMR5 data yet, so
    // the composite excludes water rather than assuming it is safe.
    let waterRiskDetail = null;

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
        waterRiskDetail = getWaterRisk(data.contaminants);

        // A utility whose only detections have no limit at all scores 0 —
        // arithmetically correct, but "0" must never be presented as "clean".
        // Distinguish the cases explicitly so the frontend can say
        // "detected, no published limit" instead of implying safety.
        const unregulatedOnly = waterRiskDetail.coverage === 'unscoreable';
        const unnamed = waterRiskDetail.detected_unregulated;

        // Anything scored against published guidance rather than an enforceable
        // limit, and anything whose limit EPA has proposed rescinding. Both are
        // caveats on how solid the resulting number is.
        const guidanceScored = waterRiskDetail.scored.filter(
          (entry) => !entry.is_enforceable
        );
        const rescissionAffected = waterRiskDetail.scored.filter(
          (entry) => entry.proposed_for_rescission
        );

        let message = null;
        if (unregulatedOnly) {
          message = `${formatList(unnamed)} ${
            unnamed.length === 1 ? 'was' : 'were'
          } detected in this system. No enforceable federal limit or published health benchmark exists for ${
            unnamed.length === 1 ? 'it' : 'them'
          }, so ${
            unnamed.length === 1 ? 'it cannot' : 'they cannot'
          } be scored. Detected is not the same as safe.`;
        } else if (unnamed.length > 0) {
          message = `${formatList(
            unnamed
          )} could not be scored — no enforceable limit or published health benchmark exists for ${
            unnamed.length === 1 ? 'it' : 'them'
          }. The score below reflects only what could be evaluated.`;
        }

        waterData = {
          pws_name: data.pws_name,
          status: unregulatedOnly ? 'detected_unregulated' : data.status,
          contaminants: data.contaminants,
          is_measured: true,
          // Preserved so nothing is lost when we override `status` above.
          source_status: data.status,
          coverage: waterRiskDetail.coverage,
          scored_count: waterRiskDetail.scored_count,
          detected_count: waterRiskDetail.detected_count,
          detected_unregulated: unnamed,
          // Measured and shown, but deliberately not scored. Distinct from
          // detected_unregulated, which means no limit exists at all.
          excluded_from_score: waterRiskDetail.excluded_from_score,
          scored_contaminants: waterRiskDetail.scored,
          // True when any part of the score rests on non-binding guidance.
          includes_guidance: guidanceScored.length > 0,
          guidance_scored: guidanceScored.map((entry) => ({
            contaminant: entry.contaminant,
            limit_ppt: entry.limit_ppt,
            basis: entry.basis,
            source: entry.source
          })),
          ...(rescissionAffected.length > 0 && {
            regulatory_notice: `The federal limit for ${formatList(
              rescissionAffected.map((entry) => entry.contaminant)
            )} is currently the subject of a proposed EPA rescission. It remains enforceable today, but this score could change if that proposal is finalized.`
          }),
          ...(message && { message })
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
    // MODULE 3: COMPOSITE HOMEGUARD SCORE
    // ==========================================
    const radonRisk = getRadonRisk(zoneNumber);
    let scoreData;

    if (isPrivateSource) {
      // Nothing about this water has ever been measured, so there is no number
      // to give. A test plan is not a result, and scoring it as though it were
      // one would invent a reading the household does not have.
      scoreData = {
        risk: null,
        score: null,
        display_score: null,
        is_partial: true,
        is_measured: false,
        missing_inputs: ['water'],
        included_inputs: [],
        // Radon is known here, but deliberately not composited: with no water
        // measurement there is no combined score to put it in. Listing it keeps
        // the invariant that every input is accounted for in exactly one list,
        // rather than silently vanishing from the bookkeeping.
        unused_inputs: radonRisk === null ? [] : ['radon'],
        floored: false,
        radon_risk: radonRisk,
        water_risk: null,
        reason:
          'No score can be calculated for a private well or spring. Nobody has tested this water, so there is no measurement to score — complete the testing plan first.'
      };
    } else {
      const waterRisk = waterRiskDetail ? waterRiskDetail.risk : null;
      const waterCoverage = waterRiskDetail ? waterRiskDetail.coverage : null;
      const composite = getHomeGuardScore({
        waterRisk,
        radonRisk,
        waterCoverage
      });

      // Water scored 0 only because nothing detected had any published limit to
      // score against. Say so on the score itself, so a good-looking composite
      // is never mistaken for an all-clear.
      const waterUnscoreable = waterCoverage === 'unscoreable';
      const guidanceScored = waterRiskDetail
        ? waterRiskDetail.scored.filter((entry) => !entry.is_enforceable)
        : [];

      scoreData = {
        ...composite,
        // Derived from measurements and a static radon zone map, but not itself
        // a measurement of this specific home.
        is_measured: false,
        is_estimate: true,
        radon_risk: radonRisk,
        water_risk: waterRisk,
        // Severity counting only enforceable federal limits, so the effect of
        // folding in non-binding guidance stays visible.
        water_risk_enforceable_only: waterRiskDetail
          ? waterRiskDetail.risk_enforceable_only
          : null,
        includes_guidance: guidanceScored.length > 0,
        water_unscoreable: waterUnscoreable,
        ...(waterUnscoreable && {
          unscoreable_detections: waterRiskDetail.detected_unregulated,
          reason:
            'Water contributes 0 to this score only because none of the compounds detected has an enforceable limit or a published health benchmark. This score does not mean the water is clean, and it is capped for that reason.'
        }),
        ...(!waterUnscoreable &&
          waterCoverage === 'partial' && {
            unscoreable_detections: waterRiskDetail.detected_unregulated,
            reason:
              'Some compounds detected in this system could not be scored because no enforceable limit or published health benchmark exists for them. This score reflects only what could be evaluated, and is capped for that reason.'
          })
      };
    }

    // ==========================================
    // FINAL OUTPUT: THE COMBINED PAYLOAD
    // ==========================================
    return NextResponse.json({
      success: true,
      radon: radonData,
      water: waterData,
      score: scoreData
    });

  } catch (err) {
    console.error('HomeGuard API Error:', err);
    return NextResponse.json(
      { error: 'Internal Server Error while fetching HomeGuard data.' },
      { status: 500 }
    );
  }
}