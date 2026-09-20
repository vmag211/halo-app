/**
 * Household-aware explanatory sentences (§8.6, §11).
 *
 * The same reading gets a different sentence depending on who lives in the home.
 * The measurement, level, and score are identical for everyone; only the
 * sentence underneath changes. When several groups apply, the most specific one
 * wins (priority order in household.js).
 *
 * Pure module. Sentence case, no exclamation marks, no "safe/unsafe" verdicts,
 * second person (§30).
 */

import { normalizeSeverity } from "./severity.js";
import { priorityGroup } from "./household.js";

// metric → { general: {word: sentence}, groups: {groupKey: {word: sentence}} }.
// Only the words that meaningfully differ carry group overrides; everything else
// falls back to the general sentence, then to a safe default.
const COPY = {
  air: {
    general: {
      good: "Good air quality — fine to be outside.",
      moderate: "Moderate. Fine for most people.",
      elevated: "Unhealthy for sensitive groups. Limit long or intense outdoor activity.",
      high: "Unhealthy air today. Keep strenuous activity indoors where you can.",
      severe: "Very unhealthy air. Stay inside as much as possible today.",
      no_data: "We couldn't get an air quality reading for your area right now.",
    },
    groups: {
      has_respiratory: {
        moderate: "Moderate — fine for most people, but keep an eye on anyone with asthma today.",
        elevated: "Unhealthy for sensitive groups — keep anyone with asthma inside where you can today.",
        high: "Unhealthy air — keep anyone with asthma indoors and their rescue medication close today.",
        severe: "Very unhealthy air — anyone with asthma should stay inside today.",
      },
      has_toddler: {
        moderate: "Moderate — fine for most people, but your youngest may want to skip long stretches outside today.",
        elevated: "Unhealthy for sensitive groups — keep your youngest inside where you can this afternoon.",
        high: "Unhealthy air — keep your youngest indoors today.",
        severe: "Very unhealthy air — keep your youngest inside today.",
      },
      has_senior: {
        moderate: "Moderate — fine for most people; older adults may want to take it easy outside.",
        elevated: "Unhealthy for sensitive groups — older adults in your home should limit time outside today.",
        high: "Unhealthy air — older adults in your home should stay indoors today.",
        severe: "Very unhealthy air — older adults in your home should stay inside today.",
      },
      has_child: {
        elevated: "Unhealthy for sensitive groups — your kids should skip long or intense outdoor play today.",
        high: "Unhealthy air — keep your kids' outdoor activity short today.",
      },
    },
  },
  uv: {
    general: {
      good: "Low UV. No sun protection needed for short trips outside.",
      moderate: "Moderate UV. Sunscreen if you'll be out for a while.",
      elevated: "High UV. Sunscreen and shade between 10am and 4pm.",
      high: "Very high UV. Sunscreen, a hat, and shade — skin burns quickly today.",
      severe: "Extreme UV. Cover up and stay in the shade in the middle of the day.",
      no_data: "We couldn't get a UV reading for your area right now.",
    },
    groups: {
      has_toddler: {
        elevated: "High UV — young skin burns faster. Sunscreen, a hat, and shade for your youngest between 10am and 4pm.",
        high: "Very high UV — keep your youngest shaded and covered in the middle of the day.",
      },
      has_child: {
        elevated: "High UV — young skin burns faster. Sunscreen, hats, and shade for your kids between 10am and 4pm.",
        high: "Very high UV — keep your kids shaded and covered in the middle of the day.",
      },
    },
  },
  pollen: {
    general: {
      good: "Low pollen today.",
      moderate: "Moderate pollen. Fine for most people.",
      elevated: "High pollen. Keep windows closed if pollen affects you.",
      high: "High pollen — the kind of day that tends to set off allergies. Windows closed helps.",
      severe: "Very high pollen. Keep windows closed and limit time outside if pollen affects you.",
      no_data: "We couldn't get pollen data for your area right now.",
    },
    groups: {
      has_respiratory: {
        elevated: "High pollen — this is the kind of day that tends to set off asthma. Windows closed, and consider staying in.",
        high: "High pollen — a likely trigger day for asthma. Keep windows closed and rescue medication close.",
        severe: "Very high pollen — a strong trigger day for asthma. Stay indoors where you can.",
      },
    },
  },
  mold: {
    general: {
      good: "Low mold-forming conditions today.",
      moderate: "Some mold-forming conditions — humidity is up.",
      elevated: "Mold-forming conditions are high today, based on humidity and rain.",
      high: "Mold-forming conditions are high today, based on humidity and rain.",
      severe: "Mold-forming conditions are high today, based on humidity and rain.",
      no_data: "We couldn't estimate mold conditions for your area right now.",
    },
    groups: {
      has_respiratory: {
        elevated: "High mold-forming conditions — damp days can bother asthma. Keep indoor humidity down.",
        high: "High mold-forming conditions — damp days can bother asthma. Keep indoor humidity down.",
      },
    },
  },
  lead: {
    general: {
      severe: "Your utility's inventory lists a lead service line at this address. Testing confirms what's reaching your tap.",
      high: "Your home's age means lead plumbing is possible. Testing is the only way to know.",
      elevated: "Your home's age means lead plumbing is possible. Testing is the only way to know.",
      good: "Your home was built after the lead-solder ban, so lead plumbing is unlikely.",
      no_data: "We don't know when this home was built, so we can't estimate lead risk. Testing is the only way to know.",
    },
    groups: {
      has_toddler: {
        high: "Your home's age means lead plumbing is possible. Young children absorb lead far more readily than adults, so this is worth testing sooner rather than later.",
        elevated: "Your home's age means lead plumbing is possible. Young children absorb lead far more readily than adults, so this is worth testing sooner rather than later.",
      },
      has_pregnant: {
        high: "Your home's age means lead plumbing is possible. Lead exposure during pregnancy carries its own risks, so this is worth testing sooner rather than later.",
        elevated: "Your home's age means lead plumbing is possible. Lead exposure during pregnancy carries its own risks, so this is worth testing sooner rather than later.",
      },
    },
  },
};

/**
 * Choose the explanatory sentence for a reading.
 * @param {string} metric  one of air|uv|pollen|mold|lead
 * @param {string} severityWord  any canonical or legacy severity word
 * @param {object} bands  normalized household bands
 * @returns {string}
 */
export function explain(metric, severityWord, bands) {
  const table = COPY[metric];
  const word = normalizeSeverity(severityWord);
  if (!table) return "";

  const group = bands ? priorityGroup(bands) : null;
  if (group && table.groups[group] && table.groups[group][word]) {
    return table.groups[group][word];
  }
  if (table.general[word]) return table.general[word];
  // Safe default: never invent a reassurance we didn't compute.
  return table.general.no_data ?? "";
}
