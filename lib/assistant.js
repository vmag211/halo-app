/**
 * Assistant guardrails and helpers (§18).
 *
 * The diagnostic check is STRUCTURAL, not an instruction to a model: it runs
 * before any answer is composed, so a determined user cannot argue their way
 * around it live (§18.4). It errs toward refusing genuine diagnosis/treatment
 * requests while leaving pattern questions ("why does my son cough more on some
 * days?") answerable, since those are handled from the household's own logs.
 *
 * Pure module.
 */

export const DISCLAIMER = "Not medical advice. Talk to a clinician about health decisions.";

export const DIAGNOSTIC_REFUSAL =
  "I can't help diagnose a condition, interpret symptoms as an illness, or recommend treatment — I'm not a medical tool. For anything about your health, please talk to a clinician. I can explain your environmental readings and what the health and environmental agencies say about them.";

export const NO_SOURCE =
  "I don't have a reliable source for that. I can only answer from the health and environmental agencies I've been given.";

// Requests for a diagnosis or treatment. Kept conservative so legitimate
// pattern/causation questions are not swept up.
const DIAGNOSTIC_PATTERNS = [
  /\bdiagnos(e|es|ing|is|able)\b/i,
  /\bdo (i|we|you) have\b[^?]*\b(asthma|cancer|copd|allerg\w*|infection|disease|condition|poisoning|covid|flu)\b/i,
  /\bam i (sick|dying|allergic|poisoned|contagious|going to)\b/i,
  /\bis (this|it|that|my \w+) (cancer|covid|asthma|copd|an infection|a tumou?r|serious|life[- ]threatening|contagious|going to (kill|harm|hurt))\b/i,
  /\bwhat('?s| is) wrong with (me|him|her|us|my \w+)\b/i,
  /\b(what|which|how much) (medication|medicine|drug|treatment|antibiotic|dose|dosage)\b/i,
  /\bshould i (take|stop taking|be on|see a doctor|go to (a|the)? ?(doctor|er|hospital|clinic))\b/i,
  /\b(prescri\w+|cure for|treat(ing)? (my|this)|is my \w+ safe to (eat|take))\b/i,
];

/** True when the question is asking for a diagnosis or treatment (§18.4). */
export function isDiagnosticRequest(question) {
  if (typeof question !== "string") return false;
  return DIAGNOSTIC_PATTERNS.some((p) => p.test(question));
}

// Three suggested opening questions, chosen by the page the user came from (§18.6).
const SUGGESTIONS = {
  home: ["What is PFOS?", "How do I filter PFAS out of my water?", "What is a radon zone?"],
  homeguard: ["What is PFOS?", "How do I filter PFAS out of my water?", "What is a radon zone?"],
  today: ["What is the air quality index?", "Should I limit outdoor exercise today?", "What does the UV index mean?"],
  journal: ["What can trigger allergy symptoms?", "How does pollen affect breathing?", "What is mold risk?"],
  map: ["What is a hazard index?", "What does 'not tested' mean on the map?", "What is PFHxS?"],
};

export function suggestedQuestions(page) {
  return SUGGESTIONS[page] || ["What is PFAS?", "How is my score calculated?", "What does NSF/ANSI 53 mean?"];
}
