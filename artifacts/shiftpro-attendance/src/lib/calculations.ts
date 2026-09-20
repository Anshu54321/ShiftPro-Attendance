export type ShiftType = 'morning' | 'general' | 'night';

export type Settings = {
  dutyHours: number;
  lunchBreakMinutes: number;
  hourlyRate: number;
  dailyRate: number;
  overtimeRate: number;
  payMode: 'hourly' | 'daily';
  bonusTargetDays: number;
  fullAttendanceBonus: number;
  absentPenalty: number;
  bonusAbsentLimit: number;
  companyOffDays: number[];
  currency: string;
  payCycleStartDay: number;
  payCycleEndDay: number;
};

export type Shift = {
  date: string;
  entry: string;
  exit: string;
  shiftType?: ShiftType | 'day';
  isHoliday: boolean;
  workOnHoliday?: boolean;
  manual: boolean;
  manualAmount: number;
  manualHours?: boolean;
  manualPaidHours?: number;
  manualOvertimeHours?: number;
};

export type ComputedShift = Omit<Shift, 'shiftType'> & {
  shiftType: ShiftType;
  totalMinutes: number;
  paidMinutes: number;
  regularMinutes: number;
  overtimeMinutes: number;
  regularPay: number;
  overtimePay: number;
  pay: number;
};

export function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function dateFromKey(key: string) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function minutesFromTime(time: string) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

export function shiftDurationMinutes(entry: string, exit: string) {
  let total = minutesFromTime(exit) - minutesFromTime(entry);
  if (total < 0) total += 24 * 60;
  return total;
}

export function normalizeShiftType(type?: Shift['shiftType']): ShiftType {
  return type === 'night' ? 'night' : type === 'morning' ? 'morning' : 'general';
}

export function isCompanyOffDay(date: string, settings: Settings) {
  return Boolean(settings.companyOffDays?.includes(dateFromKey(date).getDay()));
}

export function computeShift(shift: Shift, settings: Settings): ComputedShift {
  const isCompanyHoliday = Boolean(shift.isHoliday);
  const workOnHoliday = Boolean(shift.workOnHoliday);
  const holidayIgnored = isCompanyHoliday && !workOnHoliday;
  const hasTimes = Boolean(shift.entry) && Boolean(shift.exit);
  const lunchBreakMinutes = Math.max(0, Math.round(settings.lunchBreakMinutes || 0));
  const rawMinutes = hasTimes ? shiftDurationMinutes(shift.entry, shift.exit) : 0;
  const totalMinutes = hasTimes ? Math.max(0, rawMinutes - lunchBreakMinutes) : 0;
  const paidMinutes = holidayIgnored || !hasTimes ? 0 : (shift.manualHours ? Math.max(0, Math.round((shift.manualPaidHours || 0) * 60)) : totalMinutes);
  const manualOtMinutes = shift.manualHours ? Math.min(paidMinutes, Math.max(0, Math.round((shift.manualOvertimeHours || 0) * 60))) : 0;
  const companyOffDay = isCompanyOffDay(shift.date, settings);
  const dutyHoursMinutes = Math.max(0, Math.round((settings.dutyHours || 0) * 60));
  let regularMinutes: number;
  let overtimeMinutes: number;
  let calculatedRegularPay: number;
  let calculatedOvertimePay: number;
  if (isCompanyHoliday) {
    regularMinutes = 0;
    overtimeMinutes = shift.manualHours ? manualOtMinutes : paidMinutes;
    calculatedRegularPay = settings.dailyRate;
    calculatedOvertimePay = (overtimeMinutes / 60) * settings.overtimeRate;
  } else if (companyOffDay) {
    regularMinutes = 0;
    overtimeMinutes = shift.manualHours ? manualOtMinutes : paidMinutes;
    calculatedRegularPay = 0;
    calculatedOvertimePay = (overtimeMinutes / 60) * settings.overtimeRate;
  } else {
    if (shift.manualHours) {
      overtimeMinutes = manualOtMinutes;
      regularMinutes = Math.max(0, paidMinutes - overtimeMinutes);
    } else {
      overtimeMinutes = Math.max(0, paidMinutes - dutyHoursMinutes);
      regularMinutes = Math.min(paidMinutes, dutyHoursMinutes);
    }
    calculatedRegularPay = settings.payMode === 'daily'
      ? settings.dailyRate
      : (regularMinutes / 60) * settings.hourlyRate;
    calculatedOvertimePay = (overtimeMinutes / 60) * settings.overtimeRate;
  }
  const calculatedPay = calculatedRegularPay + calculatedOvertimePay;
  const manualFactor = shift.manual && shift.manualAmount >= 0 && calculatedPay > 0 ? shift.manualAmount / calculatedPay : 1;
  return { ...shift, shiftType: normalizeShiftType(shift.shiftType), isHoliday: isCompanyHoliday, workOnHoliday, totalMinutes: holidayIgnored ? 0 : totalMinutes, paidMinutes, regularMinutes, overtimeMinutes, regularPay: calculatedRegularPay * manualFactor, overtimePay: calculatedOvertimePay * manualFactor, pay: shift.manual && shift.manualAmount >= 0 ? shift.manualAmount : calculatedPay };
}

export function getAttendanceSummary(period: { start: Date; end: Date }, shifts: ComputedShift[], settings: Settings) {
  const inPeriod = (shift: ComputedShift) => dateFromKey(shift.date) >= period.start && dateFromKey(shift.date) <= period.end;
  const holidayDates = new Set(shifts.filter((shift) => inPeriod(shift) && shift.isHoliday).map((shift) => shift.date));
  const presentDates = new Set(shifts.filter((shift) => inPeriod(shift) && !shift.isHoliday && !isCompanyOffDay(shift.date, settings)).map((shift) => shift.date));
  let workingDays = 0;
  for (let cursor = new Date(period.start); cursor <= period.end; cursor.setDate(cursor.getDate() + 1)) {
    const key = dateKey(cursor);
    if (!isCompanyOffDay(key, settings) && !holidayDates.has(key)) workingDays += 1;
  }
  const presentDays = presentDates.size;
  const absentDays = Math.max(0, workingDays - presentDays);
  const target = Math.max(0, settings.bonusTargetDays);
  const attendanceBonus = settings.fullAttendanceBonus <= 0 ? 0 : presentDays >= target
    ? settings.fullAttendanceBonus
    : absentDays > settings.bonusAbsentLimit
      ? 0
      : Math.max(0, settings.fullAttendanceBonus - absentDays * settings.absentPenalty);
  return { workingDays, presentDays, absentDays, attendanceBonus };
}