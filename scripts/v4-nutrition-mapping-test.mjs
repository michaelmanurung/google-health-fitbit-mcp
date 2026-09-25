import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildNutritionDataPointBody, nutritionPreviewFingerprint, NUTRITION_DATA_TYPE } from '../dist/services/google-v4-nutrition-datapoint.js';
import { GoogleHealthClient } from '../dist/services/google-health-client.js';

const item = {
  food_name: 'banana', amount_g: 100,
  nutrients: { calories_kcal: 89, protein_g: 1.09, carbohydrates_g: 22.84, fat_g: 0.33, fiber_g: 2.6, sodium_mg: 500 }
};
const meal = { items: [item], meal_type: 'snack', eaten_at: '2026-06-16T19:00:00+07:00' };
assert.equal(NUTRITION_DATA_TYPE, 'nutrition-log');
assert.deepEqual(buildNutritionDataPointBody(item, meal), {
  nutritionLog: {
    interval: {
      startTime: '2026-06-16T12:00:00.000Z', startUtcOffset: '25200s',
      endTime: '2026-06-16T12:00:01.000Z', endUtcOffset: '25200s'
    },
    foodDisplayName: 'banana (100 g)', mealType: 'SNACK',
    energy: { kcal: 89 }, totalCarbohydrate: { grams: 22.84 }, totalFat: { grams: 0.33 },
    nutrients: [
      { nutrient: 'PROTEIN', quantity: { grams: 1.09 } },
      { nutrient: 'DIETARY_FIBER', quantity: { grams: 2.6 } },
      { nutrient: 'SODIUM', quantity: { grams: 0.5 } }
    ]
  }
});
assert.equal(nutritionPreviewFingerprint(meal), nutritionPreviewFingerprint(meal));
assert.notEqual(nutritionPreviewFingerprint(meal), nutritionPreviewFingerprint({ ...meal, items: [{ ...item, amount_g: 120 }] }));

const dir = mkdtempSync(join(tmpdir(), 'nutrition-create-'));
const originalFetch = globalThis.fetch;
try {
  const tokenPath = join(dir, 'token.json');
  writeFileSync(tokenPath, JSON.stringify({ access_token: 'test', expires_at: Math.floor(Date.now() / 1000) + 3600 }), { mode: 0o600 });
  const client = new GoogleHealthClient({
    clientId: 'test', clientSecret: 'test', redirectUri: 'http://127.0.0.1:3000/callback', scopes: [],
    tokenPath, privacyMode: 'structured', cacheEnabled: false, cachePath: join(dir, 'cache.sqlite'),
    apiBaseUrl: 'https://health.googleapis.com'
  });
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls += 1;
    assert.equal(url, 'https://health.googleapis.com/v4/users/me/dataTypes/nutrition-log/dataPoints');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), buildNutritionDataPointBody(item, meal));
    return new Response('{"error":"temporary"}', { status: 503 });
  };
  await assert.rejects(client.createNutritionDataPoint(buildNutritionDataPointBody(item, meal)), /HTTP 503/);
  assert.equal(calls, 1, 'ambiguous create failure must not retry');
} finally {
  globalThis.fetch = originalFetch;
  rmSync(dir, { recursive: true, force: true });
}
console.log(JSON.stringify({ ok: true, v4_nutrition_mapping: true }));
