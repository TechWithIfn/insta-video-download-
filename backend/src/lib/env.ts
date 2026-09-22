/**
 * Read a positive integer from the environment.
 * Returns `fallback` for missing, non-numeric, or non-positive values so a
 * misconfigured dashboard variable can never disable a safety limit.
 */
export function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = parseInt(raw, 10);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
