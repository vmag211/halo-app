/** English catalog. Future locales replace this module, not component strings. */
export const copy = {
  preview: { title: 'Onboarding development preview', disclaimer: 'Sample data only. No account, location, or answers are saved.', scenario: 'Test scenario', restart: 'Restart onboarding', complete: 'Onboarding flow complete', handoff: 'In the connected app, this button opens Today. This isolated preview ends here.' },
  handoff: { title: 'Today', message: 'Onboarding is complete. The Today dashboard is the next frontend stage and is not implemented yet.', review: 'Review onboarding' },
  common: { back: "Back", continue: "Continue", retry: "Retry", working: "Working", checking: "Checking", optional: "Optional", noData: "No data", offline: "You're offline.", offlineCached: "You're offline. Showing your last readings.", loading: "Loading", empty: "There is no data to show yet.", progress: (step: number) => `Step ${step} of 4` },
  welcome: { title: "Welcome", subtitle: "To Halo", description: "See what's in the air, water, and ground around your home, and what to do about it.", account: "No account needed.", start: "Get started", duration: "Takes about a minute." },
  address: {
    title: "Where do you live?", label: "Address or ZIP code", placeholder: "Street address or ZIP code",
    privacy: "We use your address once to find your local data, then throw it away. We keep only your approximate coordinates, your county, and which water utility serves you. We never keep the street address itself.",
    useLocation: "Use my location", currentLocation: "Using your current location", locating: "Getting your location.", finding: "Finding your local data.",
    required: "Enter an address or ZIP code.", notFound: "We couldn't find that address. Try adding your city or ZIP code.",
    unsupported: "This device can't share its location. Please type your address.", denied: "Couldn't get your location. Please type your address instead.",
  },
  household: {
    title: "Who lives here?", description: "This lets HALO tell you what today's readings mean for the people in your home. We never ask for ages, birthdays, or names, just which groups apply.",
    legend: "Which groups apply to your household?", skip: "Skip this",
    groups: { has_toddler: "Toddler", has_child: "Child", has_teen: "Teen", has_adult: "Adult", has_senior: "Senior (65+)", has_pregnant: "Someone pregnant", has_respiratory: "Someone with asthma or a breathing condition" },
  },
  home: {
    title: "A little about your home.", year: "Year built", yearHelp: "Homes built before 1988 may have lead solder in their plumbing. If you're not sure, leave it blank. We'll tell you we don't know rather than guess.",
    invalidYear: "Enter a four-digit year, or leave this blank.", futureYear: "That year hasn't happened yet.", water: "Where does your water come from?", waterPlaceholder: "Select a water source", waterRequired: "Choose where your water comes from.", results: "See my results",
    waterOptions: [ { value: "utility", label: "City or town water" }, { value: "well", label: "Private well" }, { value: "spring", label: "Spring" }, { value: "other", label: "Other" }, { value: "not_sure", label: "Not sure" } ],
  },
  reveal: {
    title: "Results reveal", utility: "Finding your water utility...", water: "Checking federal testing results...", radon: (county: string | null | undefined) => county ? `Looking up radon for ${county}...` : "Looking up radon for your county...", air: "Getting today's air quality...",
    privateWell: "Private well (no utility)", spring: "Spring (no utility)", wellTesting: "Wells aren't tested by any agency", springTesting: "Springs aren't tested by any agency", noUtility: "No utility matched your address", noUtilityToCheck: "No utility to check", foundSystem: (id: string) => `Found your water system (${id})`, aboveLimit: (name: string) => `${name} found above the limit`, belowLimits: "Nothing found above federal limits", noResults: "No published water results yet for your utility.", outsideWater: "HALO's water testing data covers North Carolina utilities", unregulated: "Found compounds with no federal limit", unavailable: "Couldn't check right now", radonUnavailable: "Not available for this county", outsideRadon: "Covers North Carolina only", zone: (zone: number) => `Zone ${zone}`,
    outside: "Daily air, UV, and pollen readings work anywhere. Water and radon detail is strongest in North Carolina.", failureNote: "Some checks could not be completed. This is not a finding about your environment.",
  },
  severity: { good: "Good", moderate: "Moderate", elevated: "Elevated", high: "High", severe: "Severe", no_data: "No data" },
  errors: {
    generic: "Something went wrong on our end, not yours. Try again in a moment.", timeout: "That took too long. The data source may be slow right now.", offline: "You're offline. Check your connection and try again.", rate_limited: "You've made a lot of requests. Please try again later.", address_required: "Enter an address or ZIP code.", address_not_found: "We couldn't find that address. Try adding your city or ZIP code.", captcha_failed: "Verification could not be completed. Check your connection and try again.", signin_failed: "Could not start a session. Please reload and try again.", session_changed: "Your session changed. Please start again so we can use the right home details.", no_location: "Add your location to get your local readings.", no_county: "We couldn't find a county for this address. Try another address.", aborted: "", invalid_response: "Something went wrong on our end, not yours. Try again in a moment.", configuration: "Could not start a session. Please reload and try again.",
  },
} as const;
