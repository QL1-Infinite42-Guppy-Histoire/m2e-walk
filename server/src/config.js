// M2E Walk — server-side rate / limit configuration.
// ALL rates live here (never hard-code them in the app) so they can be
// changed in one place after the user's final approval.
// NOTE: rates are NOT final yet (user approval pending) — see DESIGN.md §12/§13.
export const CONFIG = {
  // Earning: 100 steps = 1 pt, capped per day.
  stepsPerPoint: 100,
  dailyStepCap: 20000, // steps per day that convert to points (= 200 pt)

  // Ad unlock (AdMob rewarded + SSV): 1 verified view unlocks 20 pt.
  unlockChunkPoints: 20,
  maxUnlocksPerDay: 10, // = max 200 pt/day confirmed, matches the step cap

  // Yen value used for exchange tiers (proposal in DESIGN.md §13.4).
  pointYenValue: 0.05,
  exchangeTiers: [
    { points: 2500, yen: 125 }, // first tier
    { points: 10000, yen: 500 }, // main tier
  ],

  // Safety valves.
  monthlyBudgetYen: 5000, // pilot fronting cap; exchange auto-stops beyond this
  firstExchangeMinAgeDays: 14, // proposal: first exchange only after 14 days

  // Step plausibility: generous ceiling so real runners are not flagged.
  maxStepsPerMinute: 250, // sustained cadence ceiling used by the checker
  plausibilitySlackSteps: 500,
};
