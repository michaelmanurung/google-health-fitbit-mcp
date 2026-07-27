import assert from 'node:assert/strict';
import { buildDailySummary, buildWeeklySummary } from '../dist/services/summary.js';
import { buildWellnessContext } from '../dist/services/context.js';

function civilDate(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return { year, month, day };
}

// Real daily-resting-heart-rate / daily-heart-rate-variability endpoints return several days
// of unfiltered points at once (see the dataSourceFamily/filter fix in summary.ts), so the
// fake client mimics that shape here instead of returning a single pre-filtered point — this
// is what would have caught the earlier date-matching and field-name bugs.
const fakeClient = {
  async dailyRollup({ dataType, startDate }) {
    if (dataType === 'steps') return { rollupDataPoints: [{ steps: { countSum: '9000' } }] };
    if (dataType === 'distance') return { rollupDataPoints: [{ distance: { metersSum: '7200' } }] };
    if (dataType === 'total-calories') return { rollupDataPoints: [{ totalCalories: { kcalSum: 2400 } }] };
    if (dataType === 'active-zone-minutes') return { rollupDataPoints: [{ activeZoneMinutes: { sumInFatBurnHeartZone: '20', sumInCardioHeartZone: '25', sumInPeakHeartZone: '15' } }] };
    if (dataType === 'weight') return { rollupDataPoints: [{ weight: { weightGramsAvg: 80000 } }] };
    throw new Error(`unexpected rollup ${dataType} for ${startDate}`);
  },
  async reconcileDataPoints({ dataType }) {
    if (dataType === 'daily-resting-heart-rate') {
      // Unfiltered batch spanning several days, in descending date order like the real API.
      return {
        dataPoints: [
          { dailyRestingHeartRate: { date: civilDate(todayStr()), beatsPerMinute: 58 } },
          { dailyRestingHeartRate: { date: civilDate(yesterdayStr()), beatsPerMinute: 61 } }
        ]
      };
    }
    if (dataType === 'sleep') {
      // No dataSourceFamily filter now, and no interval filter (API rejects it) — a
      // Fitbit-sourced point with a real interval must still match the target civil date.
      return {
        dataPoints: [
          {
            dataSource: { platform: 'FITBIT' },
            sleep: {
              interval: { startTime: `${todayStr()}T10:00:00Z`, startUtcOffset: '7200s' },
              summary: { minutesAsleep: '430' }
            }
          }
        ]
      };
    }
    if (dataType === 'daily-heart-rate-variability') {
      return {
        dataPoints: [
          { dailyHeartRateVariability: { date: civilDate(todayStr()), averageHeartRateVariabilityMilliseconds: 48.2 } },
          { dailyHeartRateVariability: { date: civilDate(yesterdayStr()), averageHeartRateVariabilityMilliseconds: 50.1 } }
        ]
      };
    }
    throw new Error(`unexpected reconcile ${dataType}`);
  }
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayStr() {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const daily = await buildDailySummary(fakeClient, { date: 'today', timezone: 'UTC' });
assert.equal(daily.kind, 'daily_summary');
assert.equal(daily.source, 'google_health');
assert.equal(daily.scorecard.steps, 9000);
assert.equal(daily.scorecard.sleep_minutes, 430);
assert.equal(daily.scorecard.resting_heart_rate, 58);
assert.equal(daily.scorecard.calories_out, 2400);
assert.equal(daily.scorecard.active_zone_minutes, 60);
assert.equal(daily.scorecard.weight_kg, 80);
assert.ok(daily.diagnostic.action_candidates.length >= 2);

const weekly = await buildWeeklySummary(fakeClient, { days: 7, compare_days: 7, timezone: 'UTC' });
assert.equal(weekly.kind, 'weekly_summary');
assert.equal(weekly.scorecard.current.days, 7);
assert.equal(weekly.scorecard.current.avg_sleep_hours, 7.17);
assert.ok(weekly.diagnostic.bottlenecks.length >= 1);

const context = await buildWellnessContext(fakeClient, { days: 7, timezone: 'UTC' });
assert.equal(context.source, 'google_health');
assert.equal(context.sleep_hours, 7.17);
assert.equal(context.recent_training_load, 'normal');

console.log(JSON.stringify({ ok: true, daily: daily.kind, weekly: weekly.kind }, null, 2));
