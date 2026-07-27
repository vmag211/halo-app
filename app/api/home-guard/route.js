import { NextResponse } from 'next/server';
import { ncRadonZones } from '@/lib/radonData';

export async function GET(request) {
  try {
    // 1. Extract query parameters from the incoming URL
    const { searchParams } = new URL(request.url);
    const county = searchParams.get('county');

    // 2. Check if the 'county' parameter was provided
    if (!county) {
      return NextResponse.json(
        { error: 'The county query parameter is required (e.g., ?county=Cabarrus County).' },
        { status: 400 }
      );
    }

    // 3. Look up the radon zone number from our dataset
    const zoneNumber = ncRadonZones[county];

    // 4. Handle cases where the county is not found in our NC lookup object
    if (!zoneNumber) {
      return NextResponse.json(
        { error: `County '${county}' not found in North Carolina radon dataset.` },
        { status: 404 }
      );
    }

    // 5. Map the numeric zone value to a human-readable risk label
    let riskLevel = 'Low';
    if (zoneNumber === 1) {
      riskLevel = 'High';
    } else if (zoneNumber === 2) {
      riskLevel = 'Moderate';
    } else if (zoneNumber === 3) {
      riskLevel = 'Low';
    }

    // 6. Send back the clean JSON response
    return NextResponse.json({
      county: county,
      zone: zoneNumber,
      risk_level: riskLevel
    });

  } catch (error) {
    // 7. Catch-all safety net for unexpected crashes
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}