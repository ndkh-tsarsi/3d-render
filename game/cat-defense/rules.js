/** The complete, versioned rule surface shared with an embedding host. */
export const DEFAULT_RULES = Object.freeze({
  enemySpeed: 58,
  enemyHealth: 40,
  spawnIntervalMs: 1700,
  maxEnemies: 18,
  autoFire: true,
  fireCooldownMs: 650,
  shotDamage: 24,
  pelletCount: 5,
  spreadDegrees: 16,
  projectileSpeed: 700,
  projectileLifetimeMs: 1600,
  fenceMaxHp: 1000,
  enemyContactDamage: 14,
  enemyAttackIntervalMs: 900,
  explosionDurationMs: 650,
  explosionRadius: 110,
  explosionDamage: 80,
  scorePerKill: 100,
  enemiesPerWave: 10,
  waveDelayMs: 2500,
  enemySpeedMultiplierPerWave: 0.06,
  maxWaves: 0,
  scoreMode: "game",
});

export const RULE_LIMITS = Object.freeze({
  enemySpeed: { min: 0, max: 600 },
  enemyHealth: { min: 1, max: 100000 },
  spawnIntervalMs: { min: 100, max: 60000 },
  maxEnemies: { min: 1, max: 100, integer: true },
  autoFire: { type: "boolean" },
  fireCooldownMs: { min: 80, max: 30000 },
  shotDamage: { min: 0, max: 100000 },
  pelletCount: { min: 1, max: 24, integer: true },
  spreadDegrees: { min: 0, max: 100 },
  projectileSpeed: { min: 50, max: 3000 },
  projectileLifetimeMs: { min: 100, max: 10000 },
  fenceMaxHp: { min: 1, max: 1000000 },
  enemyContactDamage: { min: 0, max: 100000 },
  enemyAttackIntervalMs: { min: 100, max: 30000 },
  explosionDurationMs: { min: 100, max: 10000 },
  explosionRadius: { min: 1, max: 1280 },
  explosionDamage: { min: 0, max: 100000 },
  scorePerKill: { min: 0, max: 1000000, integer: true },
  enemiesPerWave: { min: 1, max: 500, integer: true },
  waveDelayMs: { min: 0, max: 60000 },
  enemySpeedMultiplierPerWave: { min: 0, max: 1 },
  maxWaves: { min: 0, max: 10000, integer: true },
  scoreMode: { values: ["game", "host"] },
});

export function gameError(code, message) {
  const error = new RangeError(message);
  error.code = code;
  return error;
}

export function assertRecord(value, label = "payload") {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw gameError("INVALID_ARGUMENT", `${label} must be a plain object.`);
  }
  for (const key of Object.keys(value)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) {
      throw gameError("INVALID_ARGUMENT", `${label} contains an unsupported key.`);
    }
  }
  return value;
}

export function finiteNumber(value, label, min, max, integer = false) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max ||
      (integer && !Number.isInteger(value))) {
    throw gameError("INVALID_ARGUMENT", `${label} must be ${integer ? "an integer" : "a number"} between ${min} and ${max}.`);
  }
  return value;
}

export function validateRules(partial, current = DEFAULT_RULES) {
  assertRecord(partial, "rules");
  const next = { ...current };
  for (const [key, value] of Object.entries(partial)) {
    if (!Object.hasOwn(RULE_LIMITS, key)) {
      throw gameError("UNKNOWN_RULE", `Unknown rule: ${key}.`);
    }
    const limit = RULE_LIMITS[key];
    if (limit.type === "boolean") {
      if (typeof value !== "boolean") throw gameError("INVALID_RULE", `${key} must be a boolean.`);
    } else if (limit.values) {
      if (!limit.values.includes(value)) throw gameError("INVALID_RULE", `${key} must be one of: ${limit.values.join(", ")}.`);
    } else {
      try { finiteNumber(value, key, limit.min, limit.max, limit.integer); }
      catch { throw gameError("INVALID_RULE", `${key} must be ${limit.integer ? "an integer" : "a number"} between ${limit.min} and ${limit.max}.`); }
    }
    next[key] = value;
  }
  return next;
}
