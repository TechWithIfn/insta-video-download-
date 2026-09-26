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

/**
 * Read a non-negative integer from the environment (0 = "disabled/off" is a
 * meaningful, intentional value here, unlike in `readPositiveInt`).
 * Returns `fallback` for missing, non-numeric or negative values.
 */
export function readNonNegativeInt(name: string, fallback: number, max?: number): number {
  const raw = process.env[name];
  if (!raw) return cap(fallback, max);
  const value = parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value < 0) return cap(fallback, max);
  return cap(value, max);
}

function cap(value: number, max?: number): number {
  return max === undefined ? value : Math.min(value, max);
}

/**
 * Read an integer and clamp it into [min, max]. Used for resource limits so a
 * fat-fingered dashboard value (e.g. `MAX_CONCURRENT_PAGES=1000000`) can never
 * turn a bounded resource into an unbounded one.
 */
export function readBoundedInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return Math.min(Math.max(fallback, min), max);
  const value = parseInt(raw, 10);
  if (!Number.isSafeInteger(value)) return Math.min(Math.max(fallback, min), max);
  return Math.min(Math.max(value, min), max);
}
