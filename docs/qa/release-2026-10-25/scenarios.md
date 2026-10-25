# Release test: household scenarios and evidence edges (2026-10-25)

Live site https://halo-app-topaz.vercel.app (origin/main `d02141f`, #33 to #38 merged). Branch
`vmag211/release-scenarios`. Driven with Playwright 1.62.1 (Chromium 151, Firefox 153) from scripts kept
in the session scratch folder. Six anonymous test households, all named or labelled "QA release" where a
record takes a name:

| Id | ZIP | Household | Water | Built | Purpose |
| --- | --- | --- | --- | --- | --- |
| h1 | 27601 Raleigh | toddler, senior, pregnant, asthma | utility (NC0392010) | 1975 | overlapping categories, UCMR5 detections |
| h2 | 28025 Concord | toddler | private well | unknown | well plan, unknown build year |
| h3 | 98101 Seattle | senior | utility (WA) | 1960 | outside coverage |
| h4 | 28771 Robbinsville (Graham Co.) | pregnant, asthma | utility, no UCMR5 results | 1999 | rural NC, no published water |
| h5 | 28202 Charlotte | adult, asthma | utility | 2010 | Journal, Patterns, Season, Luna actions |
| h6 | 27943 Hatteras (Dare Co.) | child, teen | utility, all non-detects | 1940 | no AirNow monitor (modeled air) |

Graham County turned out not to be sparse (the Joanna Bald ozone monitor is in the county; HALO's 38 AQI
matched AirNow's public page exactly), so h6 on Hatteras Island, where AirNow's public lookup returns no
observation, is the sparse-coverage case.

## Results

| # | Check | How tested | Result | Evidence |
| --- | --- | --- | --- | --- |
| 1.1 | Overlapping household guidance (Today, Homeguard, factor pages, Luna) | h1: Today household guidance, all four Homeguard person pages, seven factor pages, two Luna questions | pass | Each person page leads with its own priority (toddler: lead then dry play spaces then PFAS filter; pregnancy: lead, PFAS report, radon test; older adults: filter upkeep, damp areas, radon). Factor "What it means for your household" lines are consistent with the person pages. Luna gave the same lead steps from EPA and declined to judge the PFAS result (no household context, decision 2), so nothing contradicts. |
| 1.2 | Single categories (toddler, senior, pregnancy, asthma, child, teen) | h2 to h6 | pass | Figures and guidance appear only for the selected categories. |
| 1.3 | Well water gets a testing plan, never a water score | h2 | fail-fixed | Plan, costs and "No score can be calculated for a private well" were right. But the PFAS factor named "EPA UCMR 5" as the source, said "PFAS results come from utility sampling", step 1 was "Ask your utility for its latest PFAS results", and the score legend listed Radon as "No data" although radon had Zone 3. Fixed: private source line, private detail sentence, well-specific first step, "Not tested" label, and the legend says "Not combined" for a reading with no combined score. |
| 1.4 | Unknown build year: lead says it does not know | h2 | fail-fixed | "We don't know when this home was built, so we can't estimate lead risk" is right, but the source line said "Home age provided during setup". Now "Home age not provided". |
| 1.5 | 98101 says outside coverage everywhere, never invalid | h3: reveal, Today, Homeguard, factor pages, Explore area | fail-fixed | Nothing said "invalid". But Homeguard said "Neither water nor radon data was available for this address", the PFAS and radon cards said "Reading unavailable", the factor pages said "There is no reading to explain yet", and the reveal said water and radon detail is "strongest in North Carolina". Fixed: "Outside coverage" on cards and legend, factor pages and the Homeguard notice name North Carolina-only coverage, reveal says the home is outside that coverage. Explore already says "Area lookup covers North Carolina for now". |
| 1.6 | Sparse rural NC: missing data labelled, never good | h4 (no UCMR5 results), h6 (no AirNow monitor) | pass, one wording fix | h4 water "No data", "Partial score. Missing inputs: water", reveal "No published water results yet". h6 air is labelled "modeled, Open-Meteo". The "why yours" line still claimed the nearest station is "more than 25 miles away", which is no longer what decides it after #35 (the ziplatlong service has no 25-mile radius); fixed to "no AirNow monitor reported a current reading for your area". |
| 2.1 | Stale readings carry their dates | Today, factor pages, PFAS sample dates | pass | "Showing stored readings with their original dates", per-card "Reading from Oct 25, 6:13 PM", PFAS "Sample collected Mar 19, 2024", "179 recorded readings. Apr 3, 2023 to Mar 19, 2024". Known gap kept: the time is HALO's fetch time, not AirNow's observation hour. |
| 2.2 | Provider gaps are not favourable | h3 pollen, h4 water, h2 PFAS | pass | "Reading unavailable" / "No data" with no severity colour; Patterns shows "Unavailable" and "Recorded from 2026-10-26". A `?fresh=1` refresh answered 429 after repeated refreshes; the stored readings stayed on screen. |
| 2.3 | Units and conversions | API and screens; EPA UCMR5 file; outdoor forecast | pass, one fix | µg/L to ppt correct (EPA 0.0053 µg/L = 5.3 ppt; MRL 0.004 µg/L = 4 ppt). °F with °C correct (50 °F = 10 °C, 72 °F = 22 °C). AQI integers. UV: the Today card showed "0.3" while "why yours" said "0.4" for the same 0.35 reading (`toFixed` against `Math.round`); now both round half up. |
| 2.4 | UCMR5 after the reload: non-detects with dates and reporting limits | h1 Raleigh, h6 Dare; scoring over all 290 stored systems | fail-fixed (serious) | **The reload made 35 systems with detections read "No detections, Good"** and lowered 21 more by over 5 risk points, because the score took each compound's most recent sample and a later non-detect at another entry point won. Raleigh: PFOS 5.3 and 5.6 ppt at E.M. Johnson (EP1) in 2023, then non-detects at both plants on 3/19/2024, so Homeguard showed "No detections" and the reveal "Nothing found above federal limits". Others: Iredell Water Corp (risk 98 to 0), Asheboro, Clayton and Brookwood (100 to 0), Bayleaf Master (PFHxS 152.6 ppt, 100 to 0.3). Fixed in `lib/scoring.js`: a numeric result outranks a non-detect from any date, which is the rule the district share already uses; after the fix 0 systems flip and 0 drop. The PFAS factor page also listed no non-detects at all; it now shows each one with "Below the reporting limit of N ppt" and its sample date, and a no-detections system reads "No PFAS was detected in this utility's reported samples" instead of "Water results appear when utility testing is available". |
| 2.5 | No detections versus no data are distinct | h6 (60 non-detects) vs h4 (no record) | pass | h6 "No detections, Good" with dated sample; h4 "No data", left out of the score. |
| 2.6 | District percentage wording | `/api/district`, DistrictPanel text | pass, one open item | Panel and rule say "systems with a numeric result". Open: the API's `exceedance_lines` still say "N of M systems tested for PFOS", and after the reload many systems were tested with non-detects. Not shown in the UI. |
| 2.7 | Measured AirNow on Today with provenance | h1, h4 | pass | Raleigh 36 AQI O3 "measured, AirNow"; AirNow's public page at 18:00 EDT: Millbrook NCore O3 34 (HALO's fetch at 6:13 PM, so the 17:00 hour). Graham 38 O3 equals JOANBOLD 38. |
| 2.8 | "Air, daily" outdoor forecast with provenance | h1 outdoors, Oct 25 to 27 | pass | "EPA AirNow forecast for the Wake County, NC reporting area, issued 2026-10-25 ... ozone Good (AQI 32) and PM2.5 Good (AQI 20)"; Oct 26 "Good (AQI 40), ozone", PM2.5 25. AirNow public forecast: Oct 25 O3 32, PM2.5 20; Oct 26 O3 40, PM2.5 25. |
| 3.1 | Check-ins for several days, including recalled days | h5: three remembered days (Oct 19 to 21, cough), today felt fine, Oct 24 sneezing with a private note | pass | "3 saved, 0 existing entries kept, 0 not saved"; Oct 24 entered on Oct 25 is marked "Recalled". |
| 3.2 | Patterns history loads with air and UV | h5 Patterns, `/api/evidence` | pass with a limit | Loads (200) with every day labelled "Recorded from 2026-10-26. Earlier days have no daily maximum." A household created today has no daily maxima until the next recorder run, so values could not be checked here. |
| 3.3 | Grid matches saved days | grid aria labels | pass | Exactly Oct 19, 20, 21, 24 "Symptoms logged ... recalled" and Oct 25 "Felt fine"; 79 other cells "Not logged". |
| 3.4 | Season | h5 Season | pass | Fall 2026, "5/55 logged days", partial season stated. |
| 3.5 | Export without private notes | Patterns "Export this range, without private notes" | pass | `halo-patterns.json` has entries and no note text. |
| 3.6 | Unsaved draft survives a profile refresh | draft for Oct 23, then the page's Refresh, `halo:settings-changed` and `online` (two `/api/profile` re-reads), and in-app navigation | pass | Date, symptom and note kept through all of them. A full browser reload drops the draft (visit-local by design). |
| 4.1 | Luna create, move, complete, reopen, save for later | h5, Chromium | pass | Each made a review with "Nothing changes in My Week until you confirm"; each confirm changed exactly the named task (`/api/frontend/actions` after every step). |
| 4.2 | Cancel | "QA release cancel me" | pass | "Review cancelled"; no task. |
| 4.3 | Edit before confirm | title and date edited, "Review edited changes", confirm | pass | Saved as "QA release radon test kit" on Oct 30. |
| 4.4 | Ambiguous task name | "Move the QA release task to November 5" | pass | "More than one task matches. Choose the one you mean. Nothing has changed." with three choices. |
| 4.5 | Expiry (30 minutes) | review left pending from 22:45 UTC, confirmed after 30 minutes | see note | Result recorded in the reply (the review was created during this run). |
| 4.6 | Double-click confirm | `dblclick` on Confirm changes | pass | One `POST /api/luna/tools/confirm`, one task. |
| 4.7 | Review card layout, Firefox and Chrome | screenshots | pass | Label then value, one calendar button in Firefox, buttons aligned. |
| 4.8 | Never claims a change before confirm; never offers reminders | all prompts, plus "Remind me tomorrow at 9 AM ..." | pass | The reminder request became an ordinary task review stating "Luna does not set reminders or send notifications"; cancelled. |
| F01 | Unknown water is not Good | h4 | pass | |
| F02 | District share wording | DistrictPanel | pass | See 2.6 for the API sentence. |
| F03 | Geocode review, likely supplier, outside NC in Explore | h1 to h6 onboarding | pass (partly retested) | "Your home area" card with Change and "likely supplier" shown. Low-confidence geocode and typed lat,lng not retested (each try is a new household; budget used). |
| F04 | Blank result rows | h1 report with one untouched and one filled row | pass | Only the filled row saved; review "needs clarification" with the missing fields listed. |
| F05 | Summary with scores and factors | h1 Summary, Create household PDF | pass | 2-page PDF created; content covered by the existing PDF text test. |
| F06 | Journal wired | h5 | pass | See 3.1 to 3.6. |
| F07 | Notes never sent to Luna | Explore note form | pass | "Nothing is sent to Luna or an external contact when you save." |
| F08 | Organizer question carries organizer | | not testable here | No verified participation listing exists. |
| F09 | Tasks re-read missing sources | | not testable here | Needs a task whose source collection fails to load. Tasks loaded and refreshed normally. |
| F10 | Outdoor plan covers the whole activity | 900-minute plan on Oct 27 | pass | "No forecast covers 9:00 PM to 11:00 PM. Check conditions again before that part." |
| F11 | Narrow header | My Week at 320 px | pass | No overlap; the selected day is in view. |
| F12 | Luna offers no reminders | 4.8 | pass | |

## Fixed in this branch

- `lib/scoring.js`: numeric results outrank non-detects from any date (2.4). Regression test
  `test/waterEvidence.test.mjs` (Raleigh's real PFOS pattern).
- `lib/frontend/stage-data.ts`, `lib/frontend/factor-preview.ts`, `components/foundation/PersonalHero.tsx`,
  `HomeHousehold.tsx`, `ScoreTransparency.tsx`: non-detects on the PFAS factor page; "Outside coverage"
  for water and radon outside NC; private-well PFAS wording and steps; "Home age not provided"; legend
  "Not combined"; UV rounding. `lib/frontend/copy.ts`: reveal outside-coverage sentence.
  `lib/learnWhyYours.js`: modeled-air reason. Tests `test/frontend-release-scenarios.test.mjs`,
  `test/learnWhyYours.test.mjs`.

## Open (not built: product, science or data decisions)

1. **Human gate, water science:** HALO now scores each compound's most recent detection, as it did before
   the reload. EPA compliance is a running annual average per entry point (Raleigh EP1 PFOS averages about
   2.7 ppt over its four 2023 to 2024 samples, under the 4 ppt MCL, while its latest detection, 5.6 ppt,
   is over). Someone should decide which rule HALO states before this is presented as a finding.
2. Pollen: Google's index 1 and 2 ("very low", "low") show as "Moderate", the Today overview is
   "Moderate" at 85, and a weed value flagged out of season still shows "1, Moderate". Severity
   calibration is a science decision.
3. `/api/district` `exceedance_lines` say "tested for" (API only; the prebuilt district file needs a
   rebuild to change).
4. Luna's cited passages show "exposure.; Use ..." and "laboratory..": the stored corpus predates the
   current passage builder and needs a reseed.
5. `lib/dailyMaxima.js` and the source operations copy still describe a 25-mile AirNow radius; check
   the recorder's measured/modeled rule against the ziplatlong service.
6. Toddler PFAS household line ("use filtered water for drinking and formula") shows beside a "No
   detections, Good" result; content wording decision.
