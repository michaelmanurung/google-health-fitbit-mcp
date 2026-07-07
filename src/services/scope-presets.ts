import {
  DEFAULT_SCOPES,
  GOOGLE_HEALTH_ECG_READ_SCOPE,
  GOOGLE_HEALTH_IRN_READ_SCOPE,
  GOOGLE_HEALTH_NUTRITION_WRITE_SCOPE
} from "../constants.js";

export const SCOPE_PRESETS = {
  basic: [
    "https://www.googleapis.com/auth/googlehealth.profile.readonly",
    "https://www.googleapis.com/auth/googlehealth.settings.readonly"
  ],
  activity: [
    "https://www.googleapis.com/auth/googlehealth.profile.readonly",
    "https://www.googleapis.com/auth/googlehealth.settings.readonly",
    "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
    "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly"
  ],
  sleep: [
    "https://www.googleapis.com/auth/googlehealth.profile.readonly",
    "https://www.googleapis.com/auth/googlehealth.settings.readonly",
    "https://www.googleapis.com/auth/googlehealth.sleep.readonly"
  ],
  full: DEFAULT_SCOPES,
  // Heart-safety preset: heart metrics plus the specialized ECG and irregular-rhythm scopes used
  // by google_health_get_irn_profile and the electrocardiogram data type. Still read-only.
  heart: [
    "https://www.googleapis.com/auth/googlehealth.profile.readonly",
    "https://www.googleapis.com/auth/googlehealth.settings.readonly",
    "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
    GOOGLE_HEALTH_ECG_READ_SCOPE,
    GOOGLE_HEALTH_IRN_READ_SCOPE
  ],
  // Opt-in WRITE preset: read-only profile/settings/nutrition + the nutrition write scope.
  // The only preset that grants any write capability. All others stay read-only.
  "nutrition-write": [
    "https://www.googleapis.com/auth/googlehealth.profile.readonly",
    "https://www.googleapis.com/auth/googlehealth.settings.readonly",
    "https://www.googleapis.com/auth/googlehealth.nutrition.readonly",
    GOOGLE_HEALTH_NUTRITION_WRITE_SCOPE
  ]
} as const;

export type ScopePresetName = keyof typeof SCOPE_PRESETS;

export function parseScopePreset(value: string): ScopePresetName {
  if (value in SCOPE_PRESETS) return value as ScopePresetName;
  throw new Error(`Scope preset must be one of: ${Object.keys(SCOPE_PRESETS).join(", ")}.`);
}

export function parseScopeList(value: string): string[] {
  const scopes = value.split(/[,\s]+/).map((scope) => scope.trim()).filter(Boolean);
  if (scopes.length === 0) throw new Error("At least one Google Health OAuth scope is required.");
  for (const scope of scopes) {
    if (!scope.startsWith("https://www.googleapis.com/auth/googlehealth.")) {
      throw new Error(`Unsupported Google Health OAuth scope: ${scope}`);
    }
  }
  return Array.from(new Set(scopes));
}

export function resolveScopes(preset: string | undefined, override: string | undefined): string[] {
  if (override) return parseScopeList(override);
  return [...SCOPE_PRESETS[parseScopePreset(preset ?? "full")]];
}
