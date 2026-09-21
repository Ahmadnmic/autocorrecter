/** Aggressiveness 0..1 maps to every decision threshold. 0.5 is the default. */
export function thresholds(aggr: number) {
  const a = Math.min(1, Math.max(0, Number.isFinite(aggr) ? aggr : 0.5));
  return {
    typo: 0.85 - 0.2 * a,        // Pass A choice confidence
    intentional: 0.5,            // Pass A "typed on purpose" noul
    recheck: 0.92 - 0.14 * a,    // Pass B choice confidence
    prefilter: 0.75 - 0.3 * a,   // Pass C: call Haiku only above this noul (0.6 at default)
    ctx: 0.9 - 0.2 * a,          // Pass C gate choice confidence
    prefers: 0.9 - 0.2 * a,      // Pass C gate "author would prefer" noul
    complete: 0.85 - 0.2 * a,    // autocomplete choice confidence (0.75 at default)
  };
}
