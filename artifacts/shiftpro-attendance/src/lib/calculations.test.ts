import assert from 'node:assert/strict';
import { computeShift, getAttendanceSummary, type Settings, type Shift } from './calculations.ts';

const baseSettings: Settings = {
  dutyHours: 8,
  lunchBreakMinutes: 60,
  hourlyRate: 18.5,
  dailyRate: 148,
  overtimeRate: 27.75,
  payMode: 'hourly',
  bonusTargetDays: 22,
  fullAttendanceBonus: 3000,
  absentPenalty: 1000,
  bonusAbsentLimit: 1,
  companyOffDays: [0, 6],
  currency: '₹',
  payCycleStartDay: 1,
  payCycleEndDay: 31,
};

function makeShift(overrides: Partial<Shift>): Shift {
  return {
    date: '2026-09-10',
    entry: '09:00',
    exit: '18:00',
    shiftType: 'general',
    isHoliday: false,
    manual: false,
    manualAmount: 0,
    ...overrides,
  };
}

let passed = 0;
let failed = 0;
const failures: string[] = [];
function check(name: string, actual: unknown, expected: unknown) {
  try {
    assert.deepStrictEqual(actual, expected);
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (error) {
    failed += 1;
    failures.push(`${name} -> expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    console.log(`  FAIL ${name}`);
  }
}

console.log('computeShift / lunch break tests');
console.log('  [1] default 60-min lunch break: 09:00-18:00 is 8h paid, no OT');
{
  const { paidMinutes, overtimeMinutes, regularMinutes } = computeShift(makeShift({}), baseSettings);
  check('paidMinutes', paidMinutes, 480);
  check('overtimeMinutes', overtimeMinutes, 0);
  check('regularMinutes', regularMinutes, 480);
}

console.log('  [2] zero lunch break: 09:00-18:00 is 9h paid, 1h OT');
{
  const { paidMinutes, overtimeMinutes } = computeShift(makeShift({}), { ...baseSettings, lunchBreakMinutes: 0 });
  check('paidMinutes', paidMinutes, 540);
  check('overtimeMinutes', overtimeMinutes, 60);
}

console.log('  [3] 30-min break produces 8.5h paid, 0.5h OT');
{
  const { paidMinutes, overtimeMinutes } = computeShift(makeShift({}), { ...baseSettings, lunchBreakMinutes: 30 });
  check('paidMinutes', paidMinutes, 510);
  check('overtimeMinutes', overtimeMinutes, 30);
}

console.log('  [4] break longer than shift clamps paid time to 0');
{
  const short = makeShift({ entry: '13:00', exit: '13:30' });
  const { paidMinutes, totalMinutes } = computeShift(short, baseSettings);
  check('paidMinutes', paidMinutes, 0);
  check('totalMinutes', totalMinutes, 0);
}

console.log('  [5] night shift crossing midnight still deducts the break');
{
  const night = makeShift({ entry: '22:00', exit: '06:00', shiftType: 'night' });
  const { paidMinutes } = computeShift(night, { ...baseSettings, lunchBreakMinutes: 60 });
  check('paidMinutes', paidMinutes, 420);
}

console.log('  [6] manual hours bypass the auto break deduction');
{
  const manual = makeShift({ manualHours: true, manualPaidHours: 8, manualOvertimeHours: 1 });
  const { paidMinutes, overtimeMinutes } = computeShift(manual, baseSettings);
  check('paidMinutes', paidMinutes, 480);
  check('overtimeMinutes', overtimeMinutes, 60);
}

console.log('  [7] company off-day: all paid minutes are OT (break still applied)');
{
  const sunday = makeShift({ date: '2026-09-06' });
  const { paidMinutes, overtimeMinutes, regularMinutes } = computeShift(sunday, baseSettings);
  check('paidMinutes', paidMinutes, 480);
  check('overtimeMinutes', overtimeMinutes, 480);
  check('regularMinutes', regularMinutes, 0);
}

console.log('  [8] company holiday no duty: 0 work time, base wage credited');
{
  const holiday = makeShift({ isHoliday: true, workOnHoliday: false, entry: '', exit: '' });
  const { paidMinutes, pay } = computeShift(holiday, baseSettings);
  check('paidMinutes', paidMinutes, 0);
  check('pay', pay, 148);
}

console.log('getAttendanceSummary tests');
{
  const period = { start: new Date(2026, 8, 1), end: new Date(2026, 8, 30) };
  const shifts: Shift[] = [
    makeShift({ date: '2026-09-01', entry: '09:00', exit: '18:00' }),
    makeShift({ date: '2026-09-02', entry: '09:00', exit: '18:00' }),
    makeShift({ date: '2026-09-05', isHoliday: true, entry: '', exit: '' }),
  ];
  const computed = shifts.map((shift) => computeShift(shift, baseSettings));
  const summary = getAttendanceSummary(period, computed, baseSettings);
  check('summary.workingDays', summary.workingDays, 22);
  check('summary.presentDays', summary.presentDays, 2);
  check('summary.absentDays', summary.absentDays, 20);
}

console.log('');
if (failed > 0) {
  console.error(`${failed} test(s) FAILED:`);
  failures.forEach((message) => console.error(`  - ${message}`));
  process.exit(1);
}
console.log(`All ${passed} checks passed.`);