/**
 * HALO educational content — the seven Learn topics (§17).
 *
 * Canonical source of truth in code so it can be reviewed and unit-tested;
 * /api/learn serves from here and composes the household-specific "why yours"
 * line at request time. The learn_content table (migration 0005) is the spec'd
 * DB persistence for future editing/translation; seed it from this module.
 *
 * Every factual claim is traceable to a named source with a retrieval date.
 * Reading level ~6th grade. Spanish is authored separately, never machine-
 * translated at display time (§17.10).
 *
 * NOTE (§66): re-verify every source URL resolves, and re-check every claim /
 * certification against the primary source, before launch. `retrieved` dates
 * below are placeholders to be confirmed.
 */

const RETRIEVED = "2026-09"; // placeholder; confirm per source before launch

export const LEARN_TOPICS = ["pfas", "radon", "lead", "air", "pollen", "uv", "mold"];

export const LEARN_CONTENT = {
  pfas: {
    title: "PFAS",
    what_it_is:
      "PFAS are a family of manufactured chemicals used since the 1940s in nonstick coatings, firefighting foam, water-repellent fabric, and food packaging. They're called forever chemicals because they don't break down naturally in the environment or in the body.",
    protect: [
      "Use a filter certified to NSF/ANSI 53 with a P473 claim, or an NSF/ANSI 58 reverse-osmosis system — these are the reliable routes.",
      "Don't rely on boiling — it doesn't remove PFAS, it concentrates them as water evaporates.",
      "Don't assume bottled water is cleaner — independent testing has found PFAS in a majority of tested brands, and much bottled water is repackaged tap water. A certified filter is the better-verified option and makes no plastic waste.",
      "Use filtered water for drinking, cooking, and especially infant formula.",
    ],
    household: {
      has_pregnant: "During pregnancy and for young children, PFAS exposure carries added developmental concerns, so filtered water for drinking and formula matters more here.",
      has_toddler: "Young children are more vulnerable to PFAS exposure, so use filtered water for drinking and formula.",
    },
    sources: [
      { label: "EPA — PFAS drinking water regulation", url: "https://www.epa.gov/sdwa/and-polyfluoroalkyl-substances-pfas", retrieved: RETRIEVED },
      { label: "ATSDR — PFAS and your health", url: "https://www.atsdr.cdc.gov/pfas/", retrieved: RETRIEVED },
    ],
  },
  radon: {
    title: "Radon",
    what_it_is:
      "Radon is a naturally occurring radioactive gas produced as uranium decays in soil and rock. It has no color, smell, or taste, and it enters homes through foundation cracks and gaps. It's the second leading cause of lung cancer in the United States.",
    protect: [
      "Test — it's the only way to know. Short-term kits are inexpensive and mailed to a lab.",
      "Test in winter for the most accurate reading, when sealed and heated homes draw in more soil gas.",
      "The federal action level is 4.0 pCi/L.",
      "If a test comes back high, have a certified contractor install a soil-depressurization system — ventilation alone isn't an effective long-term fix.",
    ],
    household: {},
    sources: [
      { label: "EPA — A Citizen's Guide to Radon", url: "https://www.epa.gov/radon/citizens-guide-radon-guide-protecting-yourself-and-your-family-radon", retrieved: RETRIEVED },
    ],
  },
  lead: {
    title: "Lead",
    what_it_is:
      "Lead is a metal used in plumbing and solder for decades. It enters drinking water by leaching from pipes, solder, and fixtures — not from the source water itself, which is why a utility can deliver clean water that becomes contaminated inside a building.",
    protect: [
      "Run the tap before drinking if water has been sitting for hours.",
      "Use cold water for drinking, cooking, and especially infant formula — hot water leaches more lead.",
      "Use a filter certified to NSF/ANSI 53 for lead.",
      "Test through a local health department or a certified laboratory.",
    ],
    household: {
      has_toddler: "Young children absorb lead far more readily than adults, and exposure during development carries different consequences — worth testing sooner rather than later.",
      has_pregnant: "Lead exposure during pregnancy carries its own considerations, so this is worth testing sooner rather than later.",
    },
    sources: [
      { label: "EPA — Basic information about lead in drinking water", url: "https://www.epa.gov/ground-water-and-drinking-water/basic-information-about-lead-drinking-water", retrieved: RETRIEVED },
    ],
  },
  air: {
    title: "Air quality",
    what_it_is:
      "The air quality index is a 0-to-500 scale summarizing several pollutants including ozone and particle pollution. The number reported is the single worst pollutant, not an average — most people assume otherwise.",
    protect: [
      "Shift strenuous outdoor activity to hours with lower readings.",
      "Keep windows closed on poor days.",
      "Run heating or cooling on recirculation with a good filter.",
      "If anyone has asthma, keep rescue medication accessible on elevated days.",
    ],
    household: {
      has_respiratory: "People with asthma or heart or lung disease react at lower thresholds than the general population.",
      has_toddler: "Children react to air pollution at lower thresholds than adults.",
      has_senior: "Older adults react to air pollution at lower thresholds than the general population.",
    },
    sources: [
      { label: "AirNow — Air Quality Index basics", url: "https://www.airnow.gov/aqi/aqi-basics/", retrieved: RETRIEVED },
    ],
  },
  pollen: {
    title: "Pollen",
    what_it_is:
      "Pollen is fine powder released by trees, grasses, and weeds. Counts follow predictable seasons, rise with wind and warmth, and fall after sustained rain.",
    protect: [
      "Keep windows closed during peak hours.",
      "Shower and change clothing after extended time outdoors — pollen is carried indoors on skin and fabric.",
      "Use good filtration in heating and cooling systems.",
      "Track which category (tree, grass, or weed) matches your symptoms — the Journal does exactly this.",
    ],
    household: {
      has_respiratory: "High-pollen days are common triggers for asthma; keep windows closed and rescue medication close.",
    },
    sources: [
      { label: "American Lung Association — Pollen and your lungs", url: "https://www.lung.org/clean-air/outdoors/emergencies-and-natural-disasters/pollen", retrieved: RETRIEVED },
    ],
  },
  uv: {
    title: "Ultraviolet",
    what_it_is:
      "The ultraviolet index rates the strength of sunburn-causing radiation on a scale from 0 to 11 and above. It peaks near midday and runs higher in summer, at altitude, and near reflective surfaces such as water, sand, and snow.",
    protect: [
      "Use broad-spectrum sunscreen of at least SPF 30, applied 15 minutes before going outside and reapplied every two hours or after swimming.",
      "Seek shade between 10am and 4pm.",
      "Wear hats and protective clothing, which outperform sunscreen for sustained exposure.",
      "Remember UV passes through cloud cover, so overcast days still burn.",
    ],
    household: {
      has_toddler: "Children's skin burns faster, and sunburns in childhood carry long-term consequences.",
      has_child: "Children's skin burns faster, and sunburns in childhood carry long-term consequences.",
    },
    sources: [
      { label: "EPA — UV Index", url: "https://www.epa.gov/sunsafety/uv-index-1", retrieved: RETRIEVED },
    ],
  },
  mold: {
    title: "Mold",
    what_it_is:
      "Mold grows wherever moisture persists. HALO does not measure mold — it estimates favorable conditions from humidity and rainfall forecasts.",
    protect: [
      "Keep indoor humidity between 30 and 50 percent.",
      "Ventilate bathrooms and kitchens.",
      "Fix leaks promptly.",
      "Dry anything wet within one to two days; after flooding, dry thoroughly and discard porous materials that stayed wet.",
    ],
    household: {
      has_respiratory: "Damp conditions and mold can worsen asthma; keeping indoor humidity down helps.",
    },
    sources: [
      { label: "CDC — Mold and your health", url: "https://www.cdc.gov/mold/about/", retrieved: RETRIEVED },
    ],
  },
};

/** Base content for a topic + locale (only 'en' authored here; 'es' lives in DB). */
export function learnTopic(topic, locale = "en") {
  if (locale !== "en") return null;
  return LEARN_CONTENT[topic] ?? null;
}
