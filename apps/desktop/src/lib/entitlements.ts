/**
 * The single entitlement gate.
 *
 * Anything that ever becomes plan-gated must call this instead of checking a
 * plan, licence, or flag directly. Keeping every gate behind one predicate is
 * what makes the licensing model changeable later without touching call sites.
 *
 * Returns true unconditionally — Quiro has no paid tier today. See
 * `docs/product-roadmap.md` (D14): monetisation is deferred, the seam is not.
 *
 * Deliberately synchronous and argument-free. If a licence ever has to be
 * loaded, load it elsewhere and pass it in — an async gate would force every
 * future call site to become async for no present benefit.
 */
export function isPro(): boolean {
  return true;
}
