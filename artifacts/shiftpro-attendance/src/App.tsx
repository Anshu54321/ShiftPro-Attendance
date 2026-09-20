import { useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary, type ErrorFallbackProps } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  AlarmClock, ArrowRight, Banknote, CalendarDays,
  Check, ChevronLeft, ChevronRight, ChevronsUpDown, CircleHelp, ClipboardPaste, Clock3, Coffee, Copy, Edit3,
  FileText, Gauge, LayoutDashboard, Menu, Moon, Pencil, Plus, Save, Settings as SettingsIcon,
  Sparkles, Sun, Trash2, TrendingUp, Users, X, Zap,
} from 'lucide-react';
import { Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';

type View = 'dashboard' | 'calendar' | 'report' | 'settings';
type ShiftType = 'morning' | 'general' | 'night';
type Settings = {
  breakMinutes: number;
  teaBreakMinutes: number;
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
type Shift = {
  date: string;
  entry: string;
  exit: string;
  shiftType?: ShiftType | 'day';
  isHoliday: boolean;
  breakCount?: number;
  teaBreakCount?: number;
  lunchBreakCount?: number;
  manual: boolean;
  manualAmount: number;
  manualHours?: boolean;
  manualPaidHours?: number;
  manualOvertimeHours?: number;
};
type ComputedShift = Omit<Shift, 'shiftType'> & {
  shiftType: ShiftType;
  totalMinutes: number;
  paidMinutes: number;
  regularMinutes: number;
  overtimeMinutes: number;
  regularPay: number;
  overtimePay: number;
  pay: number;
};
type Account = { id: string; name: string; createdAt: number };
type ClipboardData = { sourceAccountId: string; sourceAccountName: string; copiedAt: number; settings: Settings; shifts: Record<string, Shift> };

const queryClient = new QueryClient();
const STORAGE_SHIFTS = 'shiftpro-shifts-v1';
const STORAGE_SETTINGS = 'shiftpro-settings-v1';
const STORAGE_ACCOUNTS = 'shiftpro-accounts-v1';
const STORAGE_ACTIVE_ACCOUNT = 'shiftpro-active-account-v1';
const STORAGE_CLIPBOARD = 'shiftpro-clipboard-v1';
function accountShiftsKey(id: string) { return `shiftpro-account-${id}-shifts-v1`; }
function accountSettingsKey(id: string) { return `shiftpro-account-${id}-settings-v1`; }
function saveJSON(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ } }
function loadJSON<T>(key: string, fallback: T): T { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; } }
function makeAccountId() { return `acct_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
const defaultSettings: Settings = {
  breakMinutes: 30,
  teaBreakMinutes: 10,
  lunchBreakMinutes: 30,
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

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function dateFromKey(key: string) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}
function formatMoney(value: number, currency = '₹') {
  return `${currency}${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function formatTime12(time: string) {
  const [rawHours, rawMinutes] = time.split(':').map(Number);
  if (Number.isNaN(rawHours) || Number.isNaN(rawMinutes)) return time;
  const suffix = rawHours >= 12 ? 'PM' : 'AM';
  const hours = rawHours % 12 || 12;
  return `${hours}:${String(rawMinutes).padStart(2, '0')} ${suffix}`;
}
function formatTimeRange(entry: string, exit: string) {
  return entry && exit ? `${formatTime12(entry)} – ${formatTime12(exit)}` : '—';
}
function minutesFromTime(time: string) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}
function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return mins ? `${hours}h ${String(mins).padStart(2, '0')}m` : `${hours}h`;
}
function friendlyDate(key: string, year = false) {
  return dateFromKey(key).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', ...(year ? { year: 'numeric' } : {}) });
}
function monthTitle(date: Date) {
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}
function clampDay(day: number) {
  return Math.min(31, Math.max(1, Math.round(day || 1)));
}
function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}
function getPayrollPeriod(anchor: Date, settings: Settings) {
  const startDay = clampDay(settings.payCycleStartDay);
  const endDay = clampDay(settings.payCycleEndDay);
  const periodStartMonth = new Date(anchor.getFullYear(), anchor.getMonth() - (anchor.getDate() < startDay ? 1 : 0), 1);
  const periodEndMonth = new Date(periodStartMonth.getFullYear(), periodStartMonth.getMonth() + (startDay > endDay ? 1 : 0), 1);
  const start = new Date(periodStartMonth.getFullYear(), periodStartMonth.getMonth(), Math.min(startDay, daysInMonth(periodStartMonth.getFullYear(), periodStartMonth.getMonth())));
  const end = new Date(periodEndMonth.getFullYear(), periodEndMonth.getMonth(), Math.min(endDay, daysInMonth(periodEndMonth.getFullYear(), periodEndMonth.getMonth())));
  return { start, end };
}
function payrollPeriodLabel(period: { start: Date; end: Date }) {
  const format = (date: Date) => date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return `${format(period.start)} – ${format(period.end)}`;
}
function shiftDurationMinutes(entry: string, exit: string) {
  let total = minutesFromTime(exit) - minutesFromTime(entry);
  if (total < 0) total += 24 * 60;
  return total;
}
function normalizeShiftType(type?: Shift['shiftType']): ShiftType {
  return type === 'night' ? 'night' : type === 'morning' ? 'morning' : 'general';
}
function shiftTypeLabel(type: ShiftType) {
  return type === 'morning' ? 'Morning' : type === 'night' ? 'Night' : 'General';
}
function isCompanyOffDay(date: string, settings: Settings) {
  return Boolean(settings.companyOffDays?.includes(dateFromKey(date).getDay()));
}
function getBreakMinutes(shift: Shift, settings: Settings) {
  if (shift.teaBreakCount !== undefined || shift.lunchBreakCount !== undefined) {
    return (shift.teaBreakCount || 0) * settings.teaBreakMinutes + (shift.lunchBreakCount || 0) * settings.lunchBreakMinutes;
  }
  return (shift.breakCount || 0) * settings.breakMinutes;
}
function computeShift(shift: Shift, settings: Settings): ComputedShift {
  const hasTimes = Boolean(shift.entry) && Boolean(shift.exit);
  const totalMinutes = hasTimes ? shiftDurationMinutes(shift.entry, shift.exit) : 0;
  const calculatedPaidMinutes = hasTimes ? Math.max(0, totalMinutes - getBreakMinutes(shift, settings)) : 0;
  const paidMinutes = hasTimes ? (shift.manualHours ? Math.max(0, Math.round((shift.manualPaidHours || 0) * 60)) : calculatedPaidMinutes) : 0;
  const manualOtMinutes = shift.manualHours ? Math.min(paidMinutes, Math.max(0, Math.round((shift.manualOvertimeHours || 0) * 60))) : 0;
  const isCompanyHoliday = Boolean(shift.isHoliday);
  const companyOffDay = isCompanyOffDay(shift.date, settings);
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
    regularMinutes = paidMinutes;
    overtimeMinutes = manualOtMinutes;
    calculatedRegularPay = settings.payMode === 'daily'
      ? settings.dailyRate
      : (regularMinutes / 60) * settings.hourlyRate;
    calculatedOvertimePay = (overtimeMinutes / 60) * settings.overtimeRate;
  }
  const calculatedPay = calculatedRegularPay + calculatedOvertimePay;
  const manualFactor = shift.manual && shift.manualAmount >= 0 && calculatedPay > 0 ? shift.manualAmount / calculatedPay : 1;
  return { ...shift, shiftType: normalizeShiftType(shift.shiftType), isHoliday: isCompanyHoliday, totalMinutes, paidMinutes, regularMinutes, overtimeMinutes, regularPay: calculatedRegularPay * manualFactor, overtimePay: calculatedOvertimePay * manualFactor, pay: shift.manual && shift.manualAmount >= 0 ? shift.manualAmount : calculatedPay };
}

function getAttendanceSummary(period: { start: Date; end: Date }, shifts: ComputedShift[], settings: Settings) {
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

function useStoredData(accountId: string) {
  const settingsKey = accountSettingsKey(accountId);
  const shiftsKey = accountShiftsKey(accountId);
  const [settings, setSettings] = useState<Settings>(() => {
    try {
      return { ...defaultSettings, ...JSON.parse(localStorage.getItem(settingsKey) || '{}'), currency: '₹' };
    } catch { return { ...defaultSettings, currency: '₹' }; }
  });
  const [shifts, setShifts] = useState<Record<string, Shift>>(() => {
    try { return JSON.parse(localStorage.getItem(shiftsKey) || '{}'); } catch { return {}; }
  });
  useEffect(() => { localStorage.setItem(settingsKey, JSON.stringify(settings)); }, [settings, settingsKey]);
  useEffect(() => { localStorage.setItem(shiftsKey, JSON.stringify(shifts)); }, [shifts, shiftsKey]);
  return { settings, setSettings, shifts, setShifts };
}

function readAccountList(): Account[] {
  const existing = loadJSON<Account[]>(STORAGE_ACCOUNTS, []);
  if (Array.isArray(existing) && existing.length > 0) return existing;
  const legacyShifts = localStorage.getItem(STORAGE_SHIFTS);
  const legacySettings = localStorage.getItem(STORAGE_SETTINGS);
  const main: Account = { id: 'main-account', name: 'Main account', createdAt: Date.now() };
  if (legacyShifts) localStorage.setItem(accountShiftsKey(main.id), legacyShifts);
  if (legacySettings) localStorage.setItem(accountSettingsKey(main.id), legacySettings);
  localStorage.removeItem(STORAGE_SHIFTS);
  localStorage.removeItem(STORAGE_SETTINGS);
  saveJSON(STORAGE_ACCOUNTS, [main]);
  return [main];
}

function readAccountData(id: string) {
  return {
    settings: { ...defaultSettings, ...loadJSON<Partial<Settings>>(accountSettingsKey(id), {}), currency: '₹' },
    shifts: loadJSON<Record<string, Shift>>(accountShiftsKey(id), {}),
  };
}

function useAccounts() {
  const [state, setState] = useState<{ list: Account[]; activeId: string }>(() => {
    const list = readAccountList();
    const storedActive = localStorage.getItem(STORAGE_ACTIVE_ACCOUNT);
    const activeId = storedActive && list.some((account) => account.id === storedActive) ? storedActive : list[0]?.id ?? '';
    return { list, activeId };
  });
  const active = state.list.find((account) => account.id === state.activeId) ?? state.list[0];
  useEffect(() => { saveJSON(STORAGE_ACCOUNTS, state.list); }, [state.list]);
  useEffect(() => { if (state.activeId) localStorage.setItem(STORAGE_ACTIVE_ACCOUNT, state.activeId); }, [state.activeId]);
  function switchAccount(id: string) {
    if (!state.list.some((account) => account.id === id)) return;
    setState((current) => ({ ...current, activeId: id }));
  }
  function createAccount(name: string) {
    const account: Account = { id: makeAccountId(), name: name.trim() || 'New account', createdAt: Date.now() };
    setState((current) => ({ list: [...current.list, account], activeId: account.id }));
  }
  function renameAccount(id: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setState((current) => ({ ...current, list: current.list.map((account) => account.id === id ? { ...account, name: trimmed } : account) }));
  }
  function deleteAccount(id: string) {
    if (state.list.length <= 1) return;
    setState((current) => {
      const remaining = current.list.filter((account) => account.id !== id);
      localStorage.removeItem(accountShiftsKey(id));
      localStorage.removeItem(accountSettingsKey(id));
      return { list: remaining, activeId: current.activeId === id ? remaining[0].id : current.activeId };
    });
  }
  return { accounts: state.list, active, activeId: state.activeId, switchAccount, createAccount, renameAccount, deleteAccount };
}

function App() {
  const accountsApi = useAccounts();
  const [clipboard, setClipboard] = useState<ClipboardData | null>(() => loadJSON<ClipboardData | null>(STORAGE_CLIPBOARD, null));
  useEffect(() => { saveJSON(STORAGE_CLIPBOARD, clipboard); }, [clipboard]);
  const { accounts, active } = accountsApi;
  const renderHome = () => <Home key={active.id} account={active} accounts={accounts} onSwitchAccount={accountsApi.switchAccount} onCreateAccount={accountsApi.createAccount} onRenameAccount={accountsApi.renameAccount} onDeleteAccount={accountsApi.deleteAccount} clipboard={clipboard} setClipboard={setClipboard} />;
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter hook={useHashLocation} base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Switch>
            <Route path="/">{renderHome}</Route>
            <Route path="/settings">{renderHome}</Route>
            <Route path="/calendar">{renderHome}</Route>
            <Route path="/report">{renderHome}</Route>
            <Route component={NotFound} />
          </Switch>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function Home({ account, accounts, clipboard, setClipboard, onSwitchAccount, onCreateAccount, onRenameAccount, onDeleteAccount }: {
  account: Account;
  accounts: Account[];
  clipboard: ClipboardData | null;
  setClipboard: (value: ClipboardData | null) => void;
  onSwitchAccount: (id: string) => void;
  onCreateAccount: (name: string) => void;
  onRenameAccount: (id: string, name: string) => void;
  onDeleteAccount: (id: string) => void;
}) {
  const [location, setLocation] = useLocation();
  const storage = useStoredData(account.id);
  const initialView: View = location === '/settings' ? 'settings' : location === '/calendar' ? 'calendar' : location === '/report' ? 'report' : 'dashboard';
  const [view, setView] = useState<View>(initialView);
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [editorDate, setEditorDate] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [mobileNav, setMobileNav] = useState(false);

  useEffect(() => {
    setView(location === '/settings' ? 'settings' : location === '/calendar' ? 'calendar' : location === '/report' ? 'report' : 'dashboard');
  }, [location]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);
  const computedShifts = useMemo(() => Object.values(storage.shifts).map((shift) => computeShift(shift, storage.settings)), [storage.shifts, storage.settings]);
  const now = new Date();
  const payrollPeriod = useMemo(() => getPayrollPeriod(month, storage.settings), [month, storage.settings]);
  const payrollShifts = computedShifts.filter((shift) => {
    const date = dateFromKey(shift.date);
    return date >= payrollPeriod.start && date <= payrollPeriod.end;
  });
  const attendanceSummary = getAttendanceSummary(payrollPeriod, computedShifts, storage.settings);
  const currentMonthPay = payrollShifts.reduce((sum, shift) => sum + shift.pay, 0) + attendanceSummary.attendanceBonus;
  const currentMonthMinutes = payrollShifts.reduce((sum, shift) => sum + shift.paidMinutes, 0);
  const currentMonthOvertime = payrollShifts.reduce((sum, shift) => sum + shift.overtimeMinutes, 0);
  const todayKey = dateKey(now);

  function navigate(next: View) {
    setView(next);
    setMobileNav(false);
    setLocation(next === 'dashboard' ? '/' : `/${next}`);
  }
  function saveShift(shift: Shift) {
    storage.setShifts((existing) => ({ ...existing, [shift.date]: shift }));
    setEditorDate(null);
    setToast('Shift saved to your journal');
  }
  function deleteShift(key: string) {
    storage.setShifts((existing) => {
      const next = { ...existing };
      delete next[key];
      return next;
    });
    setEditorDate(null);
    setToast('Shift removed');
  }
  function copyAccountData(id: string) {
    const data = readAccountData(id);
    const source = accounts.find((item) => item.id === id);
    const sourceName = source?.name ?? 'Account';
    setClipboard({ sourceAccountId: id, sourceAccountName: sourceName, copiedAt: Date.now(), settings: data.settings, shifts: data.shifts });
    setToast(`Copied "${sourceName}" — switch to another account and paste`);
  }
  function pasteAccountData(id: string) {
    if (!clipboard || clipboard.sourceAccountId === id) return false;
    const targetName = accounts.find((item) => item.id === id)?.name ?? 'this account';
    if (!window.confirm(`Overwrite "${targetName}" with the copied data?`)) return false;
    if (id === account.id) {
      storage.setSettings(clipboard.settings);
      storage.setShifts(clipboard.shifts);
    } else {
      try {
        localStorage.setItem(accountSettingsKey(id), JSON.stringify(clipboard.settings));
        localStorage.setItem(accountShiftsKey(id), JSON.stringify(clipboard.shifts));
      } catch { /* ignore */ }
    }
    setToast(`Pasted into "${targetName}"`);
    return true;
  }

  return (
    <div className="app-shell grain flex bg-[hsl(var(--background))]">
      <aside className={`no-print fixed inset-y-0 left-0 z-30 flex w-[248px] flex-col bg-[hsl(var(--sidebar))] px-5 py-6 text-[hsl(var(--sidebar-foreground))] transition-transform duration-300 md:relative md:translate-x-0 ${mobileNav ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="mb-12 flex items-center gap-3 px-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-[13px] bg-[hsl(var(--primary))] text-white shadow-lg shadow-orange-950/15"><Zap size={20} fill="currentColor" /></div>
          <div>
            <div className="font-display text-[21px] font-bold tracking-tight">Shift<span className="text-[hsl(var(--accent))]">Pro</span></div>
            <div className="font-mono text-[9px] uppercase tracking-[.18em] text-slate-400">your shift journal</div>
          </div>
          <button onClick={() => setMobileNav(false)} className="ml-auto rounded-lg p-2 text-slate-400 hover:bg-white/10 md:hidden" data-testid="button-close-nav"><X size={18} /></button>
        </div>
        <div className="mb-3 px-3 font-mono text-[10px] uppercase tracking-[.18em] text-slate-500">Workspace</div>
        <nav className="space-y-1.5">
          <NavItem icon={<LayoutDashboard size={18} />} label="Overview" active={view === 'dashboard'} onClick={() => navigate('dashboard')} testId="nav-overview" />
           <NavItem icon={<CalendarDays size={18} />} label="Attendance calendar" active={view === 'calendar'} onClick={() => navigate('calendar')} testId="nav-calendar" />
           <NavItem icon={<FileText size={18} />} label="Reports" active={view === 'report'} onClick={() => navigate('report')} testId="nav-report" />
          <NavItem icon={<SettingsIcon size={18} />} label="Pay settings" active={view === 'settings'} onClick={() => navigate('settings')} testId="nav-settings" />
        </nav>
        <div className="mt-auto rounded-2xl border border-white/10 bg-white/[.055] p-4">
          <div className="mb-2 flex items-center gap-2 text-[hsl(var(--accent))]"><Sparkles size={15} /><span className="font-mono text-[10px] uppercase tracking-[.12em]">Private by design</span></div>
          <p className="m-0 text-xs leading-relaxed text-slate-400">Your shifts live only in this browser. No account, no upload, no fuss.</p>
        </div>
        <div className="mt-5 flex items-center gap-3 border-t border-white/10 px-2 pt-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#d7e9ec] font-display font-bold text-[#265567]">Y</div>
          <div><div className="text-sm font-semibold">Your journal</div><div className="font-mono text-[10px] text-slate-500">stored on device</div></div>
        </div>
      </aside>
      {mobileNav && <button className="fixed inset-0 z-20 bg-slate-950/35 md:hidden" onClick={() => setMobileNav(false)} aria-label="Close navigation" data-testid="button-nav-backdrop" />}
      <main className="mobile-scroll min-h-[100dvh] min-w-0 flex-1">
        <header className="no-print sticky top-0 z-10 flex h-[74px] items-center justify-between border-b border-[hsl(var(--border))] bg-[hsl(var(--background)/.9)] px-5 backdrop-blur-md md:px-10">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileNav(true)} className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2.5 md:hidden" data-testid="button-open-nav"><Menu size={18} /></button>
            <div className="md:hidden font-display text-lg font-bold">Shift<span className="text-[hsl(var(--primary))]">Pro</span></div>
             <div className="hidden md:block">
               <p className="m-0 font-mono text-[10px] uppercase tracking-[.18em] text-[hsl(var(--muted-foreground))]">{view === 'dashboard' ? 'Your snapshot' : view === 'calendar' ? 'Your month at a glance' : view === 'report' ? 'Shareable attendance record' : 'Make the maths yours'}</p>
               <h1 className="m-0 mt-0.5 font-display text-xl font-bold">{view === 'dashboard' ? 'Good morning, worker.' : view === 'calendar' ? 'Attendance calendar' : view === 'report' ? 'Reports' : 'Pay settings'}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <AccountSwitcher account={account} accounts={accounts} activeId={account.id} clipboard={clipboard} onCreate={onCreateAccount} onRename={onRenameAccount} onDelete={onDeleteAccount} onSwitch={onSwitchAccount} onCopy={copyAccountData} onPaste={pasteAccountData} />
            <button onClick={() => { setEditorDate(todayKey); }} className="flex items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-3.5 py-2.5 text-sm font-bold text-white shadow-[0_5px_15px_rgba(229,104,76,.25)] transition-transform hover:-translate-y-0.5" data-testid="button-log-shift-header"><Plus size={17} strokeWidth={2.5} /><span className="hidden sm:inline">Log a shift</span><span className="sm:hidden">Log</span></button>
          </div>
        </header>
        <div className="mx-auto max-w-[1380px] px-5 py-7 md:px-10 md:py-9">
          {view === 'dashboard' && <section className="mb-7 fade-up rounded-[22px] border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] p-5 shadow-[var(--shadow-sm)] md:p-6">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[.16em] text-[hsl(var(--primary))]">Workspace accounts</div>
                <h3 className="mt-1 font-display text-lg font-bold">Switch, copy, or add accounts</h3>
                <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Every account keeps fully separate shifts, settings and manual pay on this device.</p>
              </div>
              <Users size={20} className="mt-1 shrink-0 text-[hsl(var(--muted-foreground))]" />
            </div>
            <AccountMenu accounts={accounts} activeId={account.id} clipboard={clipboard} onSwitch={onSwitchAccount} onCreate={onCreateAccount} onRename={onRenameAccount} onDelete={onDeleteAccount} onCopy={copyAccountData} onPaste={pasteAccountData} />
          </section>}
          {view === 'dashboard' && <Dashboard settings={storage.settings} shifts={computedShifts} todayKey={todayKey} month={month} payrollPeriod={payrollPeriod} attendanceSummary={attendanceSummary} monthPay={currentMonthPay} monthMinutes={currentMonthMinutes} monthOvertime={currentMonthOvertime} onPreviousPeriod={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} onNextPeriod={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} onAdd={() => { setEditorDate(todayKey); }} onEdit={setEditorDate} onCalendar={() => navigate('calendar')} />}
          {view === 'calendar' && <CalendarView month={month} setMonth={setMonth} shifts={computedShifts} settings={storage.settings} todayKey={todayKey} onEdit={setEditorDate} onAdd={(key) => setEditorDate(key)} />}
           {view === 'report' && <ErrorBoundary resetKey={`${view}:${month.getTime()}`} FallbackComponent={ReportFallback}><ReportView month={month} setMonth={setMonth} shifts={computedShifts} settings={storage.settings} payrollPeriod={payrollPeriod} accountName={account.name} onAdd={() => setEditorDate(todayKey)} /></ErrorBoundary>}
          {view === 'settings' && <SettingsView settings={storage.settings} setSettings={storage.setSettings} onSaved={() => setToast('Pay rules updated')} />}
        </div>
      </main>
       <div className="no-print fixed inset-x-0 bottom-0 z-10 flex border-t border-[hsl(var(--border))] bg-[hsl(var(--card)/.96)] px-3 py-2 backdrop-blur-lg md:hidden">
        <MobileNav icon={<LayoutDashboard size={19} />} label="Overview" active={view === 'dashboard'} onClick={() => navigate('dashboard')} testId="mobile-nav-overview" />
        <MobileNav icon={<CalendarDays size={19} />} label="Calendar" active={view === 'calendar'} onClick={() => navigate('calendar')} testId="mobile-nav-calendar" />
         <MobileNav icon={<FileText size={19} />} label="Report" active={view === 'report'} onClick={() => navigate('report')} testId="mobile-nav-report" />
        <MobileNav icon={<SettingsIcon size={19} />} label="Settings" active={view === 'settings'} onClick={() => navigate('settings')} testId="mobile-nav-settings" />
      </div>
      {editorDate && <ShiftEditor date={editorDate} existing={storage.shifts[editorDate]} settings={storage.settings} onSave={saveShift} onDelete={deleteShift} onClose={() => { setEditorDate(null); }} />}
      {toast && <div className="fade-up fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-xl bg-[hsl(var(--sidebar))] px-4 py-3 text-sm font-semibold text-white shadow-xl md:bottom-7" role="status" data-testid="status-toast"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#a8d9ac] text-[#234d35]"><Check size={13} strokeWidth={3} /></span>{toast}</div>}
    </div>
  );
}

function NavItem({ icon, label, active, onClick, testId }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void; testId: string }) {
  return <button onClick={onClick} className={`nav-pill flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold ${active ? 'bg-[hsl(var(--primary))] text-white shadow-md shadow-black/10' : 'text-slate-400 hover:bg-white/[.07] hover:text-slate-100'}`} data-testid={testId}>{icon}<span>{label}</span>{active && <ArrowRight size={15} className="ml-auto opacity-70" />}</button>;
}
function MobileNav({ icon, label, active, onClick, testId }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void; testId: string }) {
  return <button onClick={onClick} className={`flex flex-1 flex-col items-center gap-1 rounded-xl py-1.5 text-[10px] font-bold ${active ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--muted-foreground))]'}`} data-testid={testId}>{icon}<span>{label}</span></button>;
}

function AccountMenu({ accounts, activeId, clipboard, onSwitch, onCreate, onRename, onDelete, onCopy, onPaste }: {
  accounts: Account[];
  activeId: string;
  clipboard: ClipboardData | null;
  onSwitch: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onCopy: (id: string) => void;
  onPaste: (id: string) => boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pastedId, setPastedId] = useState<string | null>(null);
  const shiftCount = (id: string) => Object.keys(loadJSON<Record<string, unknown>>(accountShiftsKey(id), {})).length;
  function submitAdd() { if (newName.trim()) onCreate(newName); setNewName(''); setAdding(false); }
  function submitRename(id: string) { onRename(id, renameValue); setRenamingId(null); setRenameValue(''); }
  function handleCopy(id: string) { onCopy(id); setCopiedId(id); window.setTimeout(() => setCopiedId(null), 1800); }
  function handlePaste(id: string) { if (onPaste(id)) { setPastedId(id); window.setTimeout(() => setPastedId(null), 1800); } }
  return <div className="space-y-3">
    <div className="flex items-center justify-between gap-2">
      <div className="font-mono text-[10px] uppercase tracking-[.16em] text-[hsl(var(--primary))]">{accounts.length} {accounts.length === 1 ? 'account' : 'accounts'} · isolated data</div>
      <button type="button" onClick={() => setAdding(!adding)} className="flex items-center gap-1 rounded-lg bg-[hsl(var(--primary))] px-2.5 py-1.5 text-[11px] font-bold text-white shadow-sm" data-testid="button-add-account"><Plus size={12} strokeWidth={3} /> Add account</button>
    </div>
    <div className="max-h-[270px] space-y-1.5 overflow-y-auto pr-0.5">
      {accounts.map((item) => {
        const isActive = item.id === activeId;
        const isRenaming = renamingId === item.id;
        return <div key={item.id} className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 ${isActive ? 'border-[hsl(var(--primary)/.45)] bg-[#fff1e7]' : 'border-[hsl(var(--border)/.75)]'}`}>
          <button type="button" disabled={isRenaming} onClick={() => onSwitch(item.id)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-display text-xs font-bold ${isActive ? 'bg-[hsl(var(--primary))] text-white' : 'bg-[#d7e9ec] text-[#265567]'}`}>{item.name.charAt(0).toUpperCase() || 'A'}</span>
            {isRenaming
              ? <input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submitRename(item.id); if (event.key === 'Escape') { setRenamingId(null); setRenameValue(''); } }} onClick={(event) => event.stopPropagation()} className="shift-input w-full py-1.5 text-xs" aria-label="Account name" data-testid="input-rename-account" />
              : <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{item.name}</span><span className="block font-mono text-[10px] text-[hsl(var(--muted-foreground))]">{isActive ? 'Active · ' : ''}{shiftCount(item.id)} shifts</span></span>}
          </button>
          {isRenaming
            ? <div className="flex items-center gap-0.5"><button type="button" onClick={() => submitRename(item.id)} className="rounded-lg bg-[hsl(var(--primary))] p-1.5 text-white" title="Save name" data-testid="button-save-rename-account"><Check size={14} /></button><button type="button" onClick={() => { setRenamingId(null); setRenameValue(''); }} className="rounded-lg p-1.5 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]" title="Cancel" data-testid="button-cancel-rename-account"><X size={14} /></button></div>
            : <div className="flex items-center gap-0.5">
                <button type="button" onClick={() => handleCopy(item.id)} title="Copy this account's data" className="rounded-lg p-1.5 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]" data-testid={`button-copy-account-${item.id}`}>{copiedId === item.id ? <Check size={14} className="text-[#2f8f5b]" /> : <Copy size={14} />}</button>
                <button type="button" onClick={() => handlePaste(item.id)} disabled={!clipboard || clipboard.sourceAccountId === item.id} title={!clipboard ? 'Copy an account first' : 'Paste copied data here'} className="rounded-lg p-1.5 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] disabled:cursor-not-allowed disabled:opacity-35" data-testid={`button-paste-account-${item.id}`}>{pastedId === item.id ? <Check size={14} className="text-[#2f8f5b]" /> : <ClipboardPaste size={14} />}</button>
                <button type="button" onClick={() => { setRenamingId(item.id); setRenameValue(item.name); }} title="Rename" className="rounded-lg p-1.5 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]" data-testid={`button-rename-account-${item.id}`}><Pencil size={14} /></button>
                <button type="button" onClick={() => { if (window.confirm(`Delete "${item.name}"? Its shifts and settings will be removed from this device.`)) onDelete(item.id); }} disabled={accounts.length <= 1} title="Delete" className="rounded-lg p-1.5 text-[hsl(var(--muted-foreground))] hover:bg-[#fbe8e5] hover:text-[#b34a40] disabled:cursor-not-allowed disabled:opacity-35" data-testid={`button-delete-account-${item.id}`}><Trash2 size={14} /></button>
              </div>}
        </div>;
      })}
    </div>
    {adding && <div className="flex items-center gap-2">
      <input autoFocus value={newName} onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submitAdd(); if (event.key === 'Escape') { setAdding(false); setNewName(''); } }} placeholder="New account name" className="shift-input min-w-0 flex-1 py-2 text-sm" data-testid="input-new-account-name" />
      <button type="button" onClick={submitAdd} className="rounded-xl bg-[hsl(var(--primary))] px-3 py-2 text-sm font-bold text-white" data-testid="button-save-new-account"><Check size={15} /></button>
      <button type="button" onClick={() => { setAdding(false); setNewName(''); }} className="rounded-xl p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]" data-testid="button-cancel-new-account"><X size={15} /></button>
    </div>}
    {clipboard && <div className="flex items-start gap-2 rounded-xl bg-[#fff7df] px-3 py-2.5 text-[11px] leading-relaxed text-[#7a5b1b]"><ClipboardPaste size={14} className="mt-0.5 shrink-0" /><span>Copied from <strong>{clipboard.sourceAccountName}</strong> ({Object.keys(clipboard.shifts).length} shifts). Tap the paste button on any account to apply it.</span></div>}
  </div>;
}

function AccountSwitcher({ account, accounts, activeId, clipboard, onSwitch, onCreate, onRename, onDelete, onCopy, onPaste }: {
  account: Account;
  accounts: Account[];
  activeId: string;
  clipboard: ClipboardData | null;
  onSwitch: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onCopy: (id: string) => void;
  onPaste: (id: string) => boolean;
}) {
  const [open, setOpen] = useState(false);
  return <div className="relative">
    <button type="button" onClick={() => setOpen((current) => !current)} className="flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2 py-2 hover:bg-[hsl(var(--muted))]" data-testid="button-account-switcher" aria-haspopup="dialog" aria-expanded={open}>
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#d7e9ec] font-display text-xs font-bold text-[#265567]">{account.name.charAt(0).toUpperCase() || 'A'}</span>
      <span className="hidden max-w-[120px] truncate text-sm font-bold sm:inline">{account.name}</span>
      <ChevronsUpDown size={14} className="hidden text-[hsl(var(--muted-foreground))] sm:block" />
    </button>
    {open && <>
      <div className="fixed inset-0 z-40 bg-transparent" onClick={() => setOpen(false)} data-testid="account-menu-backdrop" />
      <div className="absolute right-0 top-[calc(100%+10px)] z-50 w-[330px] rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-[var(--shadow-md)]">
        <div className="mb-1 px-1 font-mono text-[9px] uppercase tracking-[.14em] text-[hsl(var(--muted-foreground))]">Active account</div>
        <AccountMenu accounts={accounts} activeId={activeId} clipboard={clipboard} onSwitch={onSwitch} onCreate={onCreate} onRename={onRename} onDelete={onDelete} onCopy={onCopy} onPaste={onPaste} />
      </div>
    </>}
  </div>;
}

function ReportFallback({ error, resetError }: ErrorFallbackProps) {
  return <div className="fade-up flex min-h-[320px] items-center justify-center rounded-2xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] p-6 shadow-[var(--shadow-sm)]">
    <div className="max-w-md text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#fbe1dd] text-[#a83c33]"><FileText size={22} /></div>
      <h3 className="m-0 font-display text-xl font-bold">The report hit a snag</h3>
      <p className="mt-2 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">Your attendance data is safe in this browser. Reload the report to get back to it.</p>
      {import.meta.env.DEV && error?.message ? <pre className="mt-3 overflow-x-auto rounded-lg bg-[hsl(var(--muted))] p-3 text-left font-mono text-[10px] text-[hsl(var(--muted-foreground))]">{error.message}</pre> : null}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={resetError} className="flex items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-bold text-white" data-testid="button-reload-report">Reload report</button>
      </div>
    </div>
  </div>;
}

function Dashboard({ settings, shifts, todayKey, month, payrollPeriod, attendanceSummary, monthPay, monthMinutes, monthOvertime, onPreviousPeriod, onNextPeriod, onAdd, onEdit, onCalendar }: { settings: Settings; shifts: ComputedShift[]; todayKey: string; month: Date; payrollPeriod: { start: Date; end: Date }; attendanceSummary: { workingDays: number; presentDays: number; absentDays: number; attendanceBonus: number }; monthPay: number; monthMinutes: number; monthOvertime: number; onPreviousPeriod: () => void; onNextPeriod: () => void; onAdd: () => void; onEdit: (key: string) => void; onCalendar: () => void }) {
  const today = shifts.find((shift) => shift.date === todayKey);
  const monthShifts = shifts.filter((shift) => {
    const date = dateFromKey(shift.date);
    return date >= payrollPeriod.start && date <= payrollPeriod.end;
  }).sort((a, b) => b.date.localeCompare(a.date));
  const daysWorked = monthShifts.filter((shift) => !shift.isHoliday).length;
  const regularPay = monthShifts.reduce((sum, shift) => sum + shift.regularPay, 0);
  const overtimePay = monthShifts.reduce((sum, shift) => sum + shift.overtimePay, 0);
  const periodDays = Math.round((payrollPeriod.end.getTime() - payrollPeriod.start.getTime()) / 86400000) + 1;
  const expectedDays = Math.max(1, Math.min(periodDays, Math.round(periodDays * 0.75)));
  const progress = Math.min(100, Math.round((daysWorked / expectedDays) * 100));
  return <div className="space-y-7">
    <section className="fade-up flex flex-col justify-between gap-4 rounded-2xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] px-4 py-4 shadow-[var(--shadow-sm)] sm:flex-row sm:items-center md:px-5">
      <div><div className="font-mono text-[10px] uppercase tracking-[.18em] text-[hsl(var(--primary))]">Payroll period</div><div className="mt-1 font-display text-lg font-bold">{payrollPeriodLabel(payrollPeriod)}</div><div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Company cycle: day {settings.payCycleStartDay} to day {settings.payCycleEndDay}</div></div>
      <div className="flex items-center gap-2"><button onClick={onPreviousPeriod} className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-2.5 hover:bg-[hsl(var(--muted))]" aria-label="Previous payroll period" data-testid="button-payroll-period-prev"><ChevronLeft size={18} /></button><div className="min-w-[104px] text-center font-mono text-[10px] uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">{monthTitle(month)}</div><button onClick={onNextPeriod} className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-2.5 hover:bg-[hsl(var(--muted))]" aria-label="Next payroll period" data-testid="button-payroll-period-next"><ChevronRight size={18} /></button></div>
    </section>
    <section className="fade-up relative overflow-hidden rounded-[28px] bg-[linear-gradient(135deg,#141d3c_0%,#273b68_48%,#057b78_100%)] px-5 py-6 text-white shadow-[0_22px_55px_rgba(20,29,60,.2)] md:px-9 md:py-8">
      <div className="absolute -right-20 -top-24 h-72 w-72 rounded-full border-[34px] border-[#f9d45c]/20" />
      <div className="absolute -bottom-24 right-24 h-64 w-64 rounded-full bg-[#ef6f58]/20 blur-3xl" />
      <div className="absolute right-8 top-8 hidden h-20 w-20 rounded-3xl border border-white/20 bg-white/10 rotate-12 md:block" />
      <div className="relative flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
        <div className="max-w-2xl">
          <div className="mb-4 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.2em] text-[#f9d45c]"><span className="h-1.5 w-1.5 rounded-full bg-[#f9d45c]" />{today ? 'Today is on the board' : 'Payroll period board'}</div>
          <h2 className="m-0 max-w-[680px] font-display text-[clamp(2.25rem,5vw,4.7rem)] font-bold leading-[.94] tracking-[-.055em]">{today ? `Today is worth ${formatMoney(today.pay, settings.currency)}.` : 'Make every workday count.'}</h2>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-blue-100/80">{today ? `${formatDuration(today.paidMinutes)} paid today${today.overtimeMinutes ? ` · ${formatDuration(today.overtimeMinutes)} overtime` : ''} · ${today.isHoliday ? 'company holiday' : `${shiftTypeLabel(today.shiftType).toLowerCase()} shift`}.` : 'Track day and night shifts, see overtime as it happens, and keep your Indian rupee earnings clear.'}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button onClick={onAdd} className="flex items-center gap-2 rounded-xl bg-[#f9d45c] px-4 py-3 text-sm font-extrabold text-[#17203d] transition-transform hover:-translate-y-0.5" data-testid="button-log-first-shift"><Plus size={17} /> Log a day</button>
            <button onClick={onCalendar} className="flex items-center gap-2 rounded-xl border border-white/25 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-white/10" data-testid="button-open-month">Open month <ArrowRight size={16} /></button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap lg:max-w-[300px] lg:justify-end">
          <span className="rounded-xl bg-white/10 px-3 py-2 font-mono text-[11px] text-blue-50">{daysWorked} {daysWorked === 1 ? 'day' : 'days'} logged</span>
          <span className="rounded-xl bg-[#f9d45c]/20 px-3 py-2 font-mono text-[11px] text-[#fff0ae]">{formatMoney(monthPay, settings.currency)} earned</span>
          <span className="rounded-xl bg-[#ef6f58]/20 px-3 py-2 font-mono text-[11px] text-[#ffd0c8]">{formatDuration(monthOvertime)} OT</span>
        </div>
      </div>
    </section>
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="This period" value={formatMoney(monthPay, settings.currency)} sub={monthPay ? 'estimated earnings' : 'nothing logged yet'} icon={<Banknote size={18} />} tone="coral" />
      <MetricCard label="Days worked" value={String(daysWorked)} sub={`${formatDuration(monthMinutes)} paid time`} icon={<CalendarDays size={18} />} tone="teal" />
      <MetricCard label="Overtime" value={formatDuration(monthOvertime)} sub={monthOvertime ? 'at your OT rate' : 'no overtime logged'} icon={<TrendingUp size={18} />} tone="yellow" />
      <MetricCard label="Average day" value={daysWorked ? formatMoney(monthPay / daysWorked, settings.currency) : formatMoney(0, settings.currency)} sub="per logged day" icon={<Gauge size={18} />} tone="blue" />
    </section>
    <section className="fade-up grid gap-4 md:grid-cols-[1.1fr_.9fr]">
      <div className="rounded-[22px] border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] p-5 shadow-[var(--shadow-sm)] md:p-6">
        <div className="mb-5 flex items-start justify-between"><div><div className="font-mono text-[10px] uppercase tracking-[.16em] text-[hsl(var(--primary))]">Pay breakdown</div><h3 className="mt-1 font-display text-xl font-bold">Regular day vs overtime</h3><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Only the money from logged shifts in this payroll period.</p></div><Banknote size={20} className="text-[hsl(var(--muted-foreground))]" /></div>
        <div className="grid gap-3 sm:grid-cols-2"><PayBreakdownCard label="Regular day pay" value={formatMoney(regularPay, settings.currency)} detail={settings.payMode === 'daily' ? 'Daily-rate mode' : 'Hourly-rate mode'} tone="teal" /><PayBreakdownCard label="Overtime pay" value={formatMoney(overtimePay, settings.currency)} detail={`${formatDuration(monthOvertime)} at OT rate`} tone="yellow" /></div>
      </div>
      <div className="rounded-[22px] border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] p-5 shadow-[var(--shadow-sm)] md:p-6"><div className="font-mono text-[10px] uppercase tracking-[.16em] text-[hsl(var(--primary))]">Attendance bonus</div><div className="mt-1 flex items-end justify-between gap-3"><h3 className="font-display text-xl font-bold">{formatMoney(attendanceSummary.attendanceBonus, settings.currency)}</h3><Sparkles size={20} className="text-[#c58e16]" /></div><p className="mt-2 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">{attendanceSummary.presentDays} present · {attendanceSummary.absentDays} absent · target {settings.bonusTargetDays} days</p><div className="mt-4 h-2 overflow-hidden rounded-full bg-[hsl(var(--muted))]"><div className="h-full rounded-full bg-[linear-gradient(90deg,#057b78,#f9d45c)]" style={{ width: `${Math.min(100, attendanceSummary.workingDays ? (attendanceSummary.presentDays / attendanceSummary.workingDays) * 100 : 0)}%` }} /></div></div>
    </section>
    <section className="grid gap-5 lg:grid-cols-[.9fr_1.1fr]">
      <div className="fade-up delay-1 overflow-hidden rounded-[22px] border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] p-5 shadow-[var(--shadow-sm)] md:p-6">
         <div className="mb-6 flex items-start justify-between"><div><div className="flex items-center gap-2"><h3 className="m-0 font-display text-lg font-bold">Workday pulse</h3><span className="rounded-md bg-[#d8f0eb] px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-[.1em] text-[#267163]">Live</span></div><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Your workdays this payroll period</p></div><button onClick={onCalendar} className="rounded-lg p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]" data-testid="button-view-calendar"><CalendarDays size={18} /></button></div>
        <div className="flex items-center gap-5"><div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-full" style={{ background: `conic-gradient(#057b78 ${progress}%, hsl(var(--muted)) ${progress}% 100%)` }}><div className="flex h-[92px] w-[92px] flex-col items-center justify-center rounded-full bg-[hsl(var(--card))]"><strong className="font-display text-3xl">{progress}%</strong><span className="font-mono text-[9px] uppercase tracking-widest text-[hsl(var(--muted-foreground))]">on track</span></div></div><div className="min-w-0"><div className="font-display text-2xl font-bold">{daysWorked} <span className="text-sm font-medium text-[hsl(var(--muted-foreground))]">{daysWorked === 1 ? 'day' : 'days'}</span></div><p className="mt-2 max-w-[260px] text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">{daysWorked ? 'Every entry is turning into a clearer payday.' : 'Your calendar is waiting for its first day. Start with today.'}</p></div></div>
        <div className="mt-7 h-2 overflow-hidden rounded-full bg-[hsl(var(--muted))]"><div className="h-full rounded-full bg-[linear-gradient(90deg,#057b78,#f9d45c)] transition-all" style={{ width: `${progress}%` }} /></div>
      </div>
      <div className="fade-up delay-2 rounded-[22px] border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] p-5 shadow-[var(--shadow-sm)] md:p-6">
        <div className="mb-5 flex items-center justify-between"><div><h3 className="m-0 font-display text-lg font-bold">Recent days</h3><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Tap a day to edit its pay</p></div><CalendarDays size={19} className="text-[hsl(var(--muted-foreground))]" /></div>
        {monthShifts.length === 0 ? <EmptyMini onAdd={onAdd} /> : <div className="grid gap-2 sm:grid-cols-2">{monthShifts.slice(0, 4).map((shift) => <button key={shift.date} onClick={() => onEdit(shift.date)} className="group flex w-full items-center justify-between rounded-xl border border-transparent bg-[hsl(var(--muted)/.4)] px-3 py-3 text-left transition-colors hover:border-[hsl(var(--border))] hover:bg-[hsl(var(--muted)/.75)]" data-testid={`row-recent-shift-${shift.date}`}><div className="flex min-w-0 items-center gap-3"><div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${shift.shiftType === 'night' ? 'bg-[#e8e0fa] text-[#7250a5]' : 'bg-[#dff0ef] text-[#34736e]'}`}>{shift.shiftType === 'night' ? <Moon size={16} /> : <Sun size={16} />}</div><div className="min-w-0"><div className="truncate text-sm font-bold">{dateFromKey(shift.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</div><div className="font-mono text-[10px] text-[hsl(var(--muted-foreground))]">{shift.isHoliday ? 'Company holiday' : shift.shiftType === 'night' ? 'Night' : 'Day'} · {formatTimeRange(shift.entry, shift.exit)}{shift.overtimeMinutes ? ` · ${formatDuration(shift.overtimeMinutes)} OT` : ''}</div></div></div><span className="font-mono text-sm font-bold">{formatMoney(shift.pay, settings.currency)}</span></button>)}</div>}
      </div>
    </section>
  </div>;
}

function MetricCard({ label, value, sub, icon, tone }: { label: string; value: string; sub: string; icon: React.ReactNode; tone: string }) {
  const colors: Record<string, string> = { coral: 'bg-[#fde3dc] text-[#c65241]', teal: 'bg-[#d9efeb] text-[#34776f]', yellow: 'bg-[#fff0bd] text-[#9b7422]', blue: 'bg-[#dce8f1] text-[#39627a]' };
  return <div className="fade-up rounded-[18px] border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] p-4 shadow-[var(--shadow-sm)]"><div className="mb-4 flex items-center justify-between"><span className="font-mono text-[10px] uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">{label}</span><span className={`flex h-8 w-8 items-center justify-center rounded-lg ${colors[tone]}`}>{icon}</span></div><div className="font-display text-[25px] font-bold tracking-tight">{value}</div><div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{sub}</div></div>;
}
function PayBreakdownCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: 'teal' | 'yellow' }) {
  return <div className={`rounded-2xl p-4 ${tone === 'teal' ? 'bg-[#e4f5ed]' : 'bg-[#fff3c9]'}`}><div className={`font-mono text-[10px] uppercase tracking-[.1em] ${tone === 'teal' ? 'text-[#34776f]' : 'text-[#9b7422]'}`}>{label}</div><div className="mt-2 font-display text-2xl font-bold">{value}</div><div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{detail}</div></div>;
}
function EmptyMini({ onAdd }: { onAdd: () => void }) {
  return <div className="rounded-xl bg-[hsl(var(--muted)/.65)] px-4 py-5 text-center"><div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-[hsl(var(--accent))] text-slate-800"><Plus size={18} /></div><p className="m-0 text-sm font-semibold">No days this month</p><button onClick={onAdd} className="mt-2 text-xs font-bold text-[hsl(var(--primary))] hover:underline" data-testid="button-empty-add-shift">Add your first day</button></div>;
}

function CalendarView({ month, setMonth, shifts, settings, todayKey, onEdit, onAdd }: { month: Date; setMonth: (date: Date) => void; shifts: ComputedShift[]; settings: Settings; todayKey: string; onEdit: (key: string) => void; onAdd: (key: string) => void }) {
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: 42 }, (_, index) => {
    const day = index - firstDay + 1;
    return day > 0 && day <= daysInMonth ? new Date(month.getFullYear(), month.getMonth(), day) : null;
  });
  const byDate = useMemo(() => Object.fromEntries(shifts.map((shift) => [shift.date, shift])), [shifts]);
  return <div className="space-y-6">
    <section className="fade-up flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.18em] text-[hsl(var(--primary))]"><CalendarDays size={14} /> Day & overtime map</div><h2 className="m-0 font-display text-3xl font-bold tracking-tight md:text-4xl">See your month in color.</h2><p className="mt-2 max-w-lg text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">Overtime is shown directly on every day. More OT means a richer green; holidays stay red.</p></div><div className="flex items-center gap-2"><button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2.5 hover:bg-[hsl(var(--muted))]" data-testid="button-calendar-prev"><ChevronLeft size={18} /></button><div className="min-w-[145px] text-center font-display text-base font-bold">{monthTitle(month)}</div><button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2.5 hover:bg-[hsl(var(--muted))]" data-testid="button-calendar-next"><ChevronRight size={18} /></button></div></section>
    <section className="fade-up delay-1 overflow-hidden rounded-[20px] border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] p-3 shadow-[var(--shadow-sm)] md:p-6">
      <div className="grid grid-cols-7 border-b border-[hsl(var(--border))] pb-3">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <div key={day} className="text-center font-mono text-[9px] uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))] sm:text-[10px]">{day}</div>)}</div>
      <div className="grid grid-cols-7 gap-1.5 pt-3 sm:gap-2">{cells.map((cell, index) => {
        if (!cell) return <div key={`blank-${index}`} className="min-h-[86px] rounded-xl bg-[hsl(var(--muted)/.28)] sm:min-h-[117px]" />;
        const key = dateKey(cell);
        const shift = byDate[key];
        const isToday = key === todayKey;
        const overtimeRatio = shift ? Math.min(1, shift.overtimeMinutes / 480) : 0;
        const cellStyle = shift?.isHoliday
          ? { backgroundColor: '#ffe1de', borderColor: '#e87368', boxShadow: 'inset 0 -4px 0 #d94f49' }
          : shift?.overtimeMinutes
            ? { backgroundColor: `hsl(${145 - overtimeRatio * 18} ${58 + overtimeRatio * 30}% ${95 - overtimeRatio * 28}%)`, borderColor: `hsl(${145 - overtimeRatio * 18} ${45 + overtimeRatio * 35}% ${67 - overtimeRatio * 22}%)`, boxShadow: `inset 0 -4px 0 hsl(${145 - overtimeRatio * 18} ${50 + overtimeRatio * 35}% ${49 - overtimeRatio * 18}%)` }
            : shift?.shiftType === 'night'
              ? { backgroundColor: '#eee8fc', borderColor: '#cbb8ef', boxShadow: 'inset 0 -4px 0 #9e7bd0' }
              : shift
                ? { backgroundColor: '#e4f5ed', borderColor: '#a9ddc5', boxShadow: 'inset 0 -4px 0 #4aaa83' }
                : undefined;
        return <button key={key} onClick={() => shift ? onEdit(key) : onAdd(key)} style={cellStyle} className={`calendar-cell group relative flex min-h-[86px] flex-col items-start rounded-xl border p-2 text-left transition-all hover:-translate-y-0.5 hover:shadow-md sm:min-h-[117px] sm:p-3 ${isToday ? 'ring-2 ring-[hsl(var(--primary))] ring-offset-2 ring-offset-[hsl(var(--background))]' : shift ? '' : 'border-[hsl(var(--border)/.65)] bg-[hsl(var(--card))] hover:border-[hsl(var(--primary)/.55)]'}`} data-testid={`calendar-day-${key}`}><span className={`font-mono text-[11px] ${isToday ? 'font-bold text-[hsl(var(--primary))]' : 'text-[hsl(var(--muted-foreground))]'}`}>{cell.getDate()}</span>{isToday && <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-[hsl(var(--primary))]" />}{shift ? <><span className={`mt-auto flex w-full items-center gap-1.5 truncate text-[10px] font-bold sm:text-xs ${shift.isHoliday ? 'text-[#ad3935]' : shift.overtimeMinutes ? 'text-[#176c4e]' : shift.shiftType === 'night' ? 'text-[#6d4a9d]' : 'text-[#256b56]'}`}><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${shift.isHoliday ? 'bg-[#d94f49]' : shift.overtimeMinutes ? 'bg-[#1a9b69]' : shift.shiftType === 'night' ? 'bg-[#8a61bd]' : 'bg-[#4aaa83]'}`} />{shift.isHoliday ? 'Holiday' : shift.shiftType === 'night' ? 'Night' : 'Day'}</span><span className={`mt-0.5 font-mono text-[9px] font-bold ${shift.isHoliday ? 'text-[#ad3935]' : shift.overtimeMinutes ? 'text-[#176c4e]' : 'text-[hsl(var(--muted-foreground))]'}`}>{shift.overtimeMinutes ? `+${formatDuration(shift.overtimeMinutes)} OT` : 'No OT'}</span><span className="mt-0.5 font-mono text-[9px] text-[hsl(var(--muted-foreground))]">{formatMoney(shift.pay, settings.currency)}</span></> : <span className="mt-auto hidden text-[9px] font-semibold text-[hsl(var(--muted-foreground))] opacity-0 transition-opacity group-hover:opacity-100 sm:block">Add day</span>}</button>;
      })}</div>
      <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 border-t border-[hsl(var(--border))] pt-4 text-[10px] text-[hsl(var(--muted-foreground))]"><span className="flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-[#d94f49]" />Holiday</span><span className="flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-[#4aaa83]" />Day</span><span className="flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-[#1a9b69]" />Day + OT (darker = more)</span><span className="flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-[#8a61bd]" />Night</span><span className="ml-auto hidden sm:block">Stored on this device</span></div>
    </section>
  </div>;
}

function downloadBlob(content: string, type: string, filename: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadCsvReport(periodShifts: ComputedShift[], settings: Settings, accountName: string, period: { start: Date; end: Date }) {
  const escape = (value: string) => `"${String(value).replace(/"/g, '""')}"`;
  const rows: string[][] = [
    ['ShiftPro Attendance Report', '', '', '', '', '', ''],
    ['Account', accountName, '', '', '', '', ''],
    ['Payroll period', payrollPeriodLabel(period), '', '', '', '', ''],
    ['Company cycle', `day ${settings.payCycleStartDay} to day ${settings.payCycleEndDay}`, '', '', '', '', ''],
    ['Generated on', new Date().toLocaleString('en-IN'), '', '', '', '', ''],
    [],
    ['No.', 'Date', 'Day', 'Shift', 'Entry', 'Exit', 'Overtime hours'],
    ...periodShifts.map((shift, index) => {
      const date = dateFromKey(shift.date);
      const offDay = isCompanyOffDay(shift.date, settings) || shift.isHoliday;
      return [
        String(index + 1),
        date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
        date.toLocaleDateString('en-IN', { weekday: 'long' }),
        shiftTypeLabel(shift.shiftType),
        shift.entry ? formatTime12(shift.entry) : '—',
        shift.exit ? formatTime12(shift.exit) : '—',
        formatDuration(shift.overtimeMinutes),
      ];
    }),
    [],
    ['Total days', String(periodShifts.filter((shift) => !shift.isHoliday).length), '', '', '', '', ''],
    ['Company holidays', String(periodShifts.filter((shift) => shift.isHoliday).length), '', '', '', '', ''],
    ['Total overtime', formatDuration(periodShifts.reduce((sum, shift) => sum + shift.overtimeMinutes, 0)), '', '', '', '', ''],
  ];
  const csv = '\uFEFF' + rows.map((row) => row.map(escape).join(',')).join('\r\n') + '\r\n';
  downloadBlob(csv, 'text/csv;charset=utf-8', `shiftpro-attendance-report-${dateKey(period.start)}-to-${dateKey(period.end)}.csv`);
}

function downloadHtmlReport(periodShifts: ComputedShift[], settings: Settings, accountName: string, period: { start: Date; end: Date }) {
  const totalOvertime = periodShifts.reduce((sum, shift) => sum + shift.overtimeMinutes, 0);
  const daysLogged = periodShifts.filter((shift) => !shift.isHoliday).length;
  const holidayDays = periodShifts.filter((shift) => shift.isHoliday).length;
  const rowsHtml = periodShifts.map((shift, index) => {
    const date = dateFromKey(shift.date);
    const offDay = isCompanyOffDay(shift.date, settings) || shift.isHoliday;
    return `<tr${index % 2 === 1 ? ' class="alt"' : ''}>
      <td class="num">${index + 1}</td>
      <td>${date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
      <td>${date.toLocaleDateString('en-IN', { weekday: 'long' })}</td>
      <td>${shiftTypeLabel(shift.shiftType)}</td>
      <td class="mono">${shift.entry ? formatTime12(shift.entry) : '—'}</td>
      <td class="mono">${shift.exit ? formatTime12(shift.exit) : '—'}</td>
      <td class="mono num">${shift.overtimeMinutes ? formatDuration(shift.overtimeMinutes) : '—'}</td>
      <td class="status ${offDay ? 'off' : 'ok'}">${offDay ? (shift.isHoliday ? 'Company holiday' : 'Company off') : 'Regular'}</td>
    </tr>`;
  }).join('\n      ');
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>ShiftPro Attendance Report – ${accountName}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 40px 24px; background: #f6f4ef; color: #1f2430; font-family: 'Segoe UI', Arial, Helvetica, sans-serif; }
  .sheet { max-width: 900px; margin: 0 auto; background: #ffffff; border-radius: 16px; padding: 40px 44px; box-shadow: 0 18px 45px rgba(31,36,48,.12); }
  .brand { display: flex; align-items: center; gap: 10px; font: 700 22px 'Segoe UI', Arial, sans-serif; letter-spacing: -.02em; }
  .brand span { color: #e5684c; }
  h1 { margin: 22px 0 4px; font-size: 26px; letter-spacing: -.02em; }
  .meta { color: #6b7280; font-size: 13px; margin: 0 0 26px; line-height: 1.7; }
  .summary { display: flex; gap: 14px; flex-wrap: wrap; margin: 0 0 28px; }
  .card { flex: 1 1 170px; border: 1px solid #e6e2da; border-radius: 12px; padding: 14px 18px; background: #fdfbf7; }
  .card .k { font-size: 11px; text-transform: uppercase; letter-spacing: .09em; color: #8a8579; margin-bottom: 6px; }
  .card .v { font-size: 20px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  thead th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #6b7280; padding: 10px 12px; border-bottom: 2px solid #e6e2da; }
  tbody td { padding: 11px 12px; border-bottom: 1px solid #efece6; font-size: 14px; vertical-align: middle; }
  tr.alt td { background: #faf8f4; }
  .mono { font-family: Consolas, 'Courier New', monospace; font-size: 13px; }
  .num { text-align: right; }
  .status { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; }
  .status.ok { color: #1f7a5d; }
  .status.off { color: #b34a40; }
  tfoot td { font-weight: 700; border-top: 2px solid #e6e2da; border-bottom: none; padding: 12px; }
  .footer { margin-top: 30px; padding-top: 16px; border-top: 1px solid #eee; color: #9aa0a8; font-size: 12px; display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
  @media print { body { background: #fff; padding: 0; } .sheet { box-shadow: none; padding: 24px; } .no-print { display: none; } }
</style>
</head>
<body>
  <div class="sheet">
    <div class="brand">Shift<span>Pro</span> Attendance Report</div>
    <h1>Attendance Record – ${accountName}</h1>
    <p class="meta">Payroll period: <strong>${payrollPeriodLabel(period)}</strong><br />Company cycle: day ${settings.payCycleStartDay} to day ${settings.payCycleEndDay} &nbsp;·&nbsp; Generated on ${new Date().toLocaleString('en-IN')}</p>
    <div class="summary">
      <div class="card"><div class="k">Days logged</div><div class="v">${daysLogged}</div></div>
      <div class="card"><div class="k">Company holidays</div><div class="v">${holidayDays}</div></div>
      <div class="card"><div class="k">Overtime</div><div class="v">${formatDuration(totalOvertime)}</div></div>
    </div>
    <table>
      <thead><tr><th class="num">No.</th><th>Date</th><th>Day</th><th>Shift</th><th>Entry</th><th>Exit</th><th class="num">Overtime hours</th><th>Status</th></tr></thead>
      <tbody>
      ${rowsHtml || '<tr><td colspan="8" style="text-align:center;color:#9aa0a8;padding:26px 12px;">No attendance logged for this period.</td></tr>'}
      </tbody>
      <tfoot>
        <tr><td colspan="6">Totals</td><td class="num">${formatDuration(totalOvertime)}</td><td class="status ok">${daysLogged} regular days</td></tr>
      </tfoot>
    </table>
    <div class="footer"><span>ShiftPro Attendance &amp; Payroll Tracker</span><span>Data stored on this device · Entry/exit shown in AM/PM format</span></div>
  </div>
</body>
</html>`;
  downloadBlob(html, 'text/html;charset=utf-8', `shiftpro-attendance-report-${dateKey(period.start)}-to-${dateKey(period.end)}.html`);
}

function ReportView({ month, setMonth, shifts, settings, payrollPeriod, accountName, onAdd }: { month: Date; setMonth: (date: Date) => void; shifts: ComputedShift[]; settings: Settings; payrollPeriod: { start: Date; end: Date }; accountName: string; onAdd: () => void }) {
  const periodShifts = useMemo(() => shifts.filter((shift) => {
    const date = dateFromKey(shift.date);
    return date >= payrollPeriod.start && date <= payrollPeriod.end;
  }).sort((a, b) => a.date.localeCompare(b.date)), [shifts, payrollPeriod]);
  const daysLogged = periodShifts.filter((shift) => !shift.isHoliday).length;
  const holidayDays = periodShifts.filter((shift) => shift.isHoliday).length;
  const overtimeMinutes = periodShifts.reduce((sum, shift) => sum + shift.overtimeMinutes, 0);
  function downloadCsv() { downloadCsvReport(periodShifts, settings, accountName, payrollPeriod); }
  return <div className="report-paper space-y-6">
    <section className="fade-up flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
      <div><div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.18em] text-[hsl(var(--primary))]"><FileText size={14} /> Company-ready attendance report</div><h2 className="m-0 font-display text-3xl font-bold tracking-tight md:text-4xl">Work, clearly recorded.</h2><p className="mt-2 max-w-xl text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">Only attendance timings and overtime hours are shown. Earnings are intentionally excluded.</p></div>
      <div className="no-print flex flex-wrap gap-2"><button onClick={() => downloadHtmlReport(periodShifts, settings, accountName, payrollPeriod)} className="flex items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-3.5 py-2.5 text-sm font-bold text-white shadow-[0_5px_15px_rgba(229,104,76,.25)] hover:-translate-y-0.5" data-testid="button-download-report"><FileText size={16} /> Download report</button><button onClick={downloadCsv} className="flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3.5 py-2.5 text-sm font-bold hover:bg-[hsl(var(--muted))]" data-testid="button-download-csv"><Save size={16} /> Download CSV</button><button onClick={() => window.print()} className="flex items-center gap-2 rounded-xl bg-[#19242e] px-3.5 py-2.5 text-sm font-bold text-white hover:-translate-y-0.5" data-testid="button-print-report">Print / PDF</button></div>
    </section>
    <section className="fade-up flex flex-col justify-between gap-4 rounded-2xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] px-4 py-4 shadow-[var(--shadow-sm)] sm:flex-row sm:items-center md:px-5">
      <div><div className="font-mono text-[10px] uppercase tracking-[.18em] text-[hsl(var(--primary))]">Selected payroll month</div><div className="mt-1 font-display text-xl font-bold">{payrollPeriodLabel(payrollPeriod)}</div><div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Company cycle: day {settings.payCycleStartDay} to day {settings.payCycleEndDay}</div></div>
      <div className="no-print flex items-center gap-2"><button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-2.5 hover:bg-[hsl(var(--muted))]" aria-label="Previous report month" data-testid="button-report-prev"><ChevronLeft size={18} /></button><div className="min-w-[110px] text-center font-mono text-[10px] uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">{monthTitle(month)}</div><button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-2.5 hover:bg-[hsl(var(--muted))]" aria-label="Next report month" data-testid="button-report-next"><ChevronRight size={18} /></button></div>
    </section>
    <section className="grid gap-3 sm:grid-cols-3">
      <ReportStat label="Days logged" value={String(daysLogged)} detail="regular duty days" />
      <ReportStat label="Company holidays" value={String(holidayDays)} detail="marked as company holiday" />
      <ReportStat label="Overtime" value={formatDuration(overtimeMinutes)} detail="extra hours" />
    </section>
    <section className="fade-up overflow-hidden rounded-[22px] border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] shadow-[var(--shadow-sm)]">
      <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-5 py-4 md:px-6"><div><h3 className="m-0 font-display text-xl font-bold">Attendance details</h3><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Entry and exit times are shown in AM / PM format.</p></div><span className="font-mono text-[10px] uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">{periodShifts.length} rows</span></div>
      {periodShifts.length === 0 ? <div className="px-5 py-14 text-center md:px-6"><div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[hsl(var(--accent))]"><FileText size={19} /></div><h3 className="m-0 font-display text-lg font-bold">No attendance logged for this period</h3><p className="mx-auto mt-2 max-w-sm text-sm text-[hsl(var(--muted-foreground))]">Add a day to build a clean report for your company.</p><button onClick={onAdd} className="mt-4 rounded-xl bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-bold text-white" data-testid="button-report-add-day">Log a day</button></div> : <div className="flex max-h-[560px] flex-col gap-3 overflow-y-auto px-5 pb-5 pt-3 md:px-6">{periodShifts.map((shift) => { const date = dateFromKey(shift.date); const offDay = isCompanyOffDay(shift.date, settings); const isHolidayDay = Boolean(shift.isHoliday); const statusText = isHolidayDay ? 'Company holiday' : offDay ? 'Company off-day' : 'Regular day'; const statusTone = isHolidayDay ? 'bg-[#ffe1de] text-[#ad3935]' : offDay ? 'bg-[#fff0bd] text-[#9b7422]' : 'bg-[#dff0ef] text-[#34736e]'; return <article key={shift.date} className="flex flex-col gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[#fdfbf7] p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><div className="font-display text-base font-bold">{date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })}</div><div className="font-mono text-[10px] uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">{date.toLocaleDateString(undefined, { weekday: 'long' })}</div></div><span className={`rounded-lg px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[.08em] ${statusTone}`}>{statusText}</span></div><div className="grid grid-cols-2 gap-2"><ReportDetail label="Shift" value={shiftTypeLabel(shift.shiftType)} /><ReportDetail label="Work time" value={formatDuration(shift.paidMinutes)} /><ReportDetail label="Entry" value={shift.entry ? formatTime12(shift.entry) : '—'} /><ReportDetail label="Exit" value={shift.exit ? formatTime12(shift.exit) : '—'} /><ReportDetail label="Overtime" value={formatDuration(shift.overtimeMinutes)} accent /></div></article>; })}</div>}
    </section>
  </div>;
}
function ReportStat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="rounded-2xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] p-4 shadow-[var(--shadow-sm)]"><div className="font-mono text-[10px] uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">{label}</div><div className="mt-2 font-display text-2xl font-bold">{value}</div><div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{detail}</div></div>;
}
function ReportDetail({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return <div className="rounded-lg bg-[hsl(var(--muted)/.55)] px-2.5 py-2"><div className="font-mono text-[9px] uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">{label}</div><div className={`mt-0.5 text-sm font-bold ${accent ? 'text-[#9b7422]' : ''}`}>{value}</div></div>;
}

function ShiftEditor({ date, existing, settings, onSave, onDelete, onClose }: { date: string; existing?: Shift; settings: Settings; onSave: (shift: Shift) => void; onDelete: (key: string) => void; onClose: () => void }) {
  const [entry, setEntry] = useState(existing?.entry || '08:00');
  const [exit, setExit] = useState(existing?.exit || '20:30');
  const [shiftType, setShiftType] = useState<ShiftType>(normalizeShiftType(existing?.shiftType));
  const [isHoliday, setIsHoliday] = useState(existing?.isHoliday || false);
  const [teaBreakCount, setTeaBreakCount] = useState(existing?.teaBreakCount ?? 0);
  const [lunchBreakCount, setLunchBreakCount] = useState(existing?.lunchBreakCount ?? existing?.breakCount ?? 1);
  const [manual, setManual] = useState(existing?.manual || false);
  const [manualAmount, setManualAmount] = useState(existing?.manualAmount?.toString() || '');
  const [manualHours, setManualHours] = useState(existing?.manualHours || false);
  const [manualPaidHours, setManualPaidHours] = useState(existing?.manualPaidHours?.toString() || '');
  const [manualOvertimeHours, setManualOvertimeHours] = useState(existing?.manualOvertimeHours?.toString() || '');
  const [error, setError] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const draftShift: Shift = { date, entry, exit, shiftType, isHoliday, teaBreakCount, lunchBreakCount, manual, manualAmount: Number(manualAmount) || 0, manualHours, manualPaidHours: Number(manualPaidHours) || 0, manualOvertimeHours: Number(manualOvertimeHours) || 0 };
  const preview = computeShift(draftShift, settings);
  const isOffDay = isHoliday || isCompanyOffDay(date, settings);
  useEffect(() => { panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, []);
  function save() {
    const hasBoth = Boolean(entry) && Boolean(exit);
    const noneFilled = !entry && !exit;
    if (!isHoliday && !hasBoth) { setError('Add both an entry and exit time.'); return; }
    if (isHoliday && !hasBoth && !noneFilled) { setError('Add both an entry and exit time, or leave both blank on a company holiday.'); return; }
    if (hasBoth) {
      const total = shiftDurationMinutes(entry, exit);
      const breakMinutes = getBreakMinutes(draftShift, settings);
      if (total <= breakMinutes) { setError('Your break time cannot be longer than this shift.'); return; }
    }
    if (manual && (!manualAmount || Number(manualAmount) < 0)) { setError('Add the manual amount you want to use.'); return; }
    if (manualHours && (!manualPaidHours || Number(manualPaidHours) < 0 || Number(manualOvertimeHours) < 0 || Number(manualOvertimeHours) > Number(manualPaidHours))) { setError('Check your manual paid and overtime hours.'); return; }
    onSave(draftShift);
  }
  const labelDate = friendlyDate(date, true);
  return <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-950/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div ref={panelRef} className="fade-up max-h-[92dvh] w-full overflow-y-auto rounded-t-[25px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-2xl sm:max-w-[540px] sm:rounded-[25px]">
    <div className="sticky top-0 z-10 flex items-start justify-between border-b border-[hsl(var(--border))] bg-[hsl(var(--card)/.96)] px-5 py-5 backdrop-blur-md md:px-7"><div><div className="mb-1 font-mono text-[10px] uppercase tracking-[.16em] text-[hsl(var(--primary))]">{existing ? 'Edit logged day' : 'New day entry'}</div><h2 className="m-0 font-display text-2xl font-bold">{labelDate}</h2></div><button onClick={onClose} className="rounded-xl p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]" data-testid="button-close-editor"><X size={19} /></button></div>
     <div className="space-y-5 px-5 py-6 md:px-7">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><TimeField label="Entry time" value={entry} onChange={setEntry} testId="input-entry-time" optional={isHoliday} /><TimeField label="Exit time" value={exit} onChange={setExit} testId="input-exit-time" optional={isHoliday} /></div>
        <div className="flex items-center gap-2 rounded-xl bg-[hsl(var(--muted)/.65)] px-3 py-2.5 text-xs text-[hsl(var(--muted-foreground))]"><Clock3 size={14} className="shrink-0 text-[hsl(var(--primary))]" />{isHoliday ? 'Company holiday: entry and exit are optional. Leave both blank to credit the daily base wage with 00:00 work time, or log hours to earn them entirely as overtime.' : isOffDay ? 'Company off-day: every paid hour counts as overtime at your overtime rate.' : 'Log your entry and exit times to record a regular working day.'}</div>
        <div><div className="mb-2 flex items-center justify-between"><label className="text-sm font-bold">Shift type</label><span className="font-mono text-[10px] uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">{shiftTypeLabel(shiftType)} hours</span></div><div className="grid grid-cols-3 gap-2"><button type="button" onClick={() => setShiftType('morning')} className={`flex items-center justify-center gap-1.5 rounded-xl border px-2 py-3 text-xs font-bold transition-colors ${shiftType === 'morning' ? 'border-[#4aaa83] bg-[#e4f5ed] text-[#256b56]' : 'border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--muted-foreground))]'}`} data-testid="button-shift-morning"><Sun size={15} /> Morning</button><button type="button" onClick={() => setShiftType('general')} className={`flex items-center justify-center gap-1.5 rounded-xl border px-2 py-3 text-xs font-bold transition-colors ${shiftType === 'general' ? 'border-[#4aaa83] bg-[#e4f5ed] text-[#256b56]' : 'border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--muted-foreground))]'}`} data-testid="button-shift-general"><Clock3 size={15} /> General</button><button type="button" onClick={() => setShiftType('night')} className={`flex items-center justify-center gap-1.5 rounded-xl border px-2 py-3 text-xs font-bold transition-colors ${shiftType === 'night' ? 'border-[#9e7bd0] bg-[#eee8fc] text-[#6d4a9d]' : 'border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--muted-foreground))]'}`} data-testid="button-shift-night"><Moon size={15} /> Night</button></div></div>
        <button type="button" onClick={() => setIsHoliday(!isHoliday)} className={`flex w-full items-center justify-between rounded-xl border px-3.5 py-3 text-left transition-colors ${isHoliday ? 'border-[#e87368] bg-[#ffe1de]' : 'border-[hsl(var(--border))] bg-[hsl(var(--card))]'}`} aria-pressed={isHoliday} data-testid="button-toggle-holiday"><span><span className="block text-sm font-bold">Company holiday</span><span className="mt-0.5 block text-[11px] text-[hsl(var(--muted-foreground))]">{isHoliday ? 'Daily base wage credited; any hours logged become overtime' : 'Credit the daily base wage and mark this date as a holiday'}</span></span><span className={`relative h-6 w-11 rounded-full transition-colors ${isHoliday ? 'bg-[#d94f49]' : 'bg-[hsl(var(--border))]'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${isHoliday ? 'left-6' : 'left-1'}`} /></span></button>
       <div className="rounded-2xl bg-[hsl(var(--muted)/.65)] p-4"><div className="mb-3 flex items-center justify-between"><label className="flex items-center gap-2 text-sm font-bold"><Coffee size={16} className="text-[hsl(var(--primary))]" />Breaks taken</label><span className="font-mono text-[10px] text-[hsl(var(--muted-foreground))]">deducted automatically</span></div><div className="grid grid-cols-2 gap-3"><label className="text-xs font-bold">Tea breaks<select value={teaBreakCount} onChange={(event) => setTeaBreakCount(Number(event.target.value))} className="shift-input mt-1.5 text-sm" data-testid="select-tea-breaks">{Array.from({ length: 9 }, (_, index) => <option key={index} value={index}>{index} × {settings.teaBreakMinutes} min</option>)}</select></label><label className="text-xs font-bold">Lunch breaks<select value={lunchBreakCount} onChange={(event) => setLunchBreakCount(Number(event.target.value))} className="shift-input mt-1.5 text-sm" data-testid="select-lunch-breaks">{Array.from({ length: 4 }, (_, index) => <option key={index} value={index}>{index} × {settings.lunchBreakMinutes} min</option>)}</select></label></div></div>
       {isHoliday ? <div className="flex items-center gap-2 rounded-xl bg-[#ffe1de] px-3 py-2.5 text-xs font-semibold text-[#ad3935]"><Zap size={15} />Company holiday: {formatMoney(settings.dailyRate, settings.currency)} daily base wage is credited.{preview.overtimeMinutes > 0 ? ` ${formatDuration(preview.overtimeMinutes)} of work is paid as overtime.` : ' No times logged, so work time is 00:00.'}</div> : isOffDay && <div className="flex items-center gap-2 rounded-xl bg-[#fff0bd] px-3 py-2.5 text-xs font-semibold text-[#7a5b1b]"><Zap size={15} />Company off-day: all paid hours are overtime.</div>}
       <div className="grid grid-cols-4 gap-2 rounded-2xl border border-[hsl(var(--border))] bg-[#fffaf0] p-3 text-center"><div><div className="font-mono text-[9px] uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">Paid</div><strong className="mt-1 block font-display text-base">{formatDuration(preview.paidMinutes)}</strong></div><div><div className="font-mono text-[9px] uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">Regular</div><strong className="mt-1 block font-display text-base">{formatDuration(preview.regularMinutes)}</strong></div><div><div className="font-mono text-[9px] uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">OT</div><strong className="mt-1 block font-display text-base">{formatDuration(preview.overtimeMinutes)}</strong></div><div><div className="font-mono text-[9px] uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">Pay</div><strong className="mt-1 block font-display text-base text-[hsl(var(--primary))]">{formatMoney(preview.pay, settings.currency)}</strong></div></div>
      {preview.overtimeMinutes > 0 && <div className="flex items-center gap-2 rounded-xl bg-[#fff0bd] px-3 py-2.5 text-xs font-semibold text-[#7a5b1b]"><TrendingUp size={15} />{formatDuration(preview.overtimeMinutes)} will be paid at your overtime rate.</div>}
       <div className="rounded-xl border border-[hsl(var(--border))] px-3.5 py-3"><div className="flex items-center justify-between gap-3"><div><div className="text-sm font-bold">Adjust hours manually</div><div className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))]">Use approved paid and overtime hours</div></div><button onClick={() => setManualHours(!manualHours)} className={`relative h-6 w-11 rounded-full transition-colors ${manualHours ? 'bg-[hsl(var(--primary))]' : 'bg-[hsl(var(--border))]'}`} aria-pressed={manualHours} data-testid="button-toggle-manual-hours"><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${manualHours ? 'left-6' : 'left-1'}`} /></button></div>{manualHours && <div className="mt-3 grid grid-cols-2 gap-3"><label className="text-xs font-bold">Paid hours<input type="number" min="0" step="0.25" value={manualPaidHours} onChange={(event) => setManualPaidHours(event.target.value)} className="shift-input mt-1.5" placeholder="8" data-testid="input-manual-paid-hours" /></label><label className="text-xs font-bold">OT hours<input type="number" min="0" step="0.25" value={manualOvertimeHours} onChange={(event) => setManualOvertimeHours(event.target.value)} className="shift-input mt-1.5" placeholder="0" data-testid="input-manual-overtime-hours" /></label></div>}</div>
       <div className="rounded-xl border border-[hsl(var(--border))] px-3.5 py-3"><div className="flex items-center justify-between gap-3"><div><div className="text-sm font-bold">Use a manual total</div><div className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))]">For payslips or a manager-approved amount</div></div><button onClick={() => setManual(!manual)} className={`relative h-6 w-11 rounded-full transition-colors ${manual ? 'bg-[hsl(var(--primary))]' : 'bg-[hsl(var(--border))]'}`} aria-pressed={manual} data-testid="button-toggle-manual-pay"><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${manual ? 'left-6' : 'left-1'}`} /></button></div>{manual && <div className="mt-3"><label className="mb-1.5 block text-xs font-bold" htmlFor="manual-total">Amount ({settings.currency})</label><input id="manual-total" type="number" min="0" step="0.01" value={manualAmount} onChange={(event) => setManualAmount(event.target.value)} className="shift-input" placeholder="0.00" data-testid="input-manual-amount" /></div>}</div>
      {error && <div className="rounded-xl bg-[#fbe1dd] px-3 py-2.5 text-xs font-semibold text-[#a83c33]" role="alert" data-testid="status-editor-error">{error}</div>}
      <div className="flex gap-2.5 pt-1"><button onClick={save} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 py-3.5 text-sm font-bold text-white shadow-md shadow-orange-950/10 transition-transform hover:-translate-y-0.5" data-testid="button-save-shift"><Save size={16} /> Save shift</button>{existing && <button onClick={() => { if (window.confirm('Remove this shift from your journal?')) onDelete(date); }} className="rounded-xl border border-[#f0c8c2] px-4 text-[#b34a40] hover:bg-[#fbe8e5]" data-testid="button-delete-shift"><Trash2 size={17} /></button>}</div>
    </div>
  </div></div>;
}
function timeParts(time: string) {
  if (!time) return { hour: '', minute: '', period: '' };
  const [rawHours, rawMinutes] = time.split(':').map(Number);
  const hours = Number.isNaN(rawHours) ? 8 : rawHours;
  const minutes = Number.isNaN(rawMinutes) ? 0 : rawMinutes;
  return { hour: String(hours % 12 || 12), minute: String(minutes).padStart(2, '0'), period: hours >= 12 ? 'PM' : 'AM' };
}
function timeFromParts(hour: string, minute: string, period: string) {
  if (!hour) return '';
  let hours = Number(hour) % 12;
  if (period === 'PM') hours += 12;
  return `${String(hours).padStart(2, '0')}:${minute}`;
}
const MINUTE_OPTIONS = ['00', '15', '30', '45'];
function TimeField({ label, value, onChange, testId, optional }: { label: string; value: string; onChange: (value: string) => void; testId: string; optional?: boolean }) {
  const parts = timeParts(value);
  const isBlank = parts.hour === '';
  const displayMinute = parts.minute || '00';
  const displayPeriod = parts.period || 'AM';
  const minuteOptions = MINUTE_OPTIONS.includes(displayMinute) ? MINUTE_OPTIONS : [...MINUTE_OPTIONS, displayMinute].sort();
  const updateTime = (hour: string, minute: string, period: string) => onChange(timeFromParts(hour, minute, period));
  const setMinute = (minute: string) => updateTime(parts.hour, minute, parts.period);
  return <div>
    <label className="mb-2 block text-sm font-bold">{label}{optional && <span className="ml-1.5 font-mono text-[9px] uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">optional</span>}</label>
    <div className="grid grid-cols-[1fr_1fr_1.1fr] gap-1.5">
      <div className="relative"><AlarmClock size={14} className="pointer-events-none absolute left-2 top-1/2 z-[1] -translate-y-1/2 text-[hsl(var(--muted-foreground))]" /><select value={parts.hour} onChange={(event) => updateTime(event.target.value, displayMinute, displayPeriod)} onFocus={(event) => event.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'center' })} className="shift-input pl-7 font-mono text-xs" aria-label={`${label} hour`} data-testid={`${testId}-hour`}>{optional && !isBlank && <option value="">—</option>}{Array.from({ length: 12 }, (_, index) => String(index + 1)).map((hour) => <option key={hour} value={hour}>{hour}</option>)}</select></div>
      <select value={displayMinute} onChange={(event) => updateTime(parts.hour, event.target.value, displayPeriod)} disabled={isBlank} onFocus={(event) => event.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'center' })} className="shift-input font-mono text-xs" aria-label={`${label} minute`} data-testid={`${testId}-minute`}>{minuteOptions.map((minute) => <option key={minute} value={minute}>{minute}</option>)}</select>
      <select value={displayPeriod} onChange={(event) => updateTime(parts.hour, parts.minute, event.target.value)} disabled={isBlank} onFocus={(event) => event.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'center' })} className="shift-input font-mono text-xs font-bold" aria-label={`${label} AM or PM`} data-testid={`${testId}-period`}><option value="AM">AM</option><option value="PM">PM</option></select>
    </div>
    <div className="mt-1.5 flex items-center justify-between gap-2">
      <span className="font-mono text-[11px] font-bold tracking-wide text-[hsl(var(--primary))]">{isBlank ? '—' : formatTime12(value)}</span>
      <span className="flex items-center gap-1">
        {MINUTE_OPTIONS.map((minute) => <button key={minute} type="button" onClick={() => setMinute(minute)} disabled={isBlank || parts.minute === minute} className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold transition-colors ${parts.minute === minute ? 'bg-[hsl(var(--primary))] text-white' : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--border))] hover:text-[hsl(var(--foreground))]'}`} data-testid={`${testId}-quick-${minute}`}>{minute}</button>)}
      </span>
    </div>
    <div className="mt-1 pl-1 text-[10px] text-[hsl(var(--muted-foreground))]">{optional ? 'Clearing the hour leaves this time blank.' : 'Quick select :00 · :15 · :30 · :45 instead of minute-by-minute scrolling'}</div>
  </div>;
}

function SettingsView({ settings, setSettings, onSaved }: { settings: Settings; setSettings: (value: Settings | ((previous: Settings) => Settings)) => void; onSaved: () => void }) {
  const [draft, setDraft] = useState(settings);
  useEffect(() => setDraft(settings), [settings]);
  function update<K extends keyof Settings>(key: K, value: Settings[K]) { setDraft((current) => ({ ...current, [key]: value })); }
  function save() { if (draft.breakMinutes < 0 || draft.teaBreakMinutes < 0 || draft.lunchBreakMinutes < 0 || draft.hourlyRate < 0 || draft.dailyRate < 0 || draft.overtimeRate < 0 || draft.fullAttendanceBonus < 0 || draft.absentPenalty < 0 || draft.bonusTargetDays < 0 || draft.bonusAbsentLimit < 0 || draft.payCycleStartDay < 1 || draft.payCycleStartDay > 31 || draft.payCycleEndDay < 1 || draft.payCycleEndDay > 31) return; setSettings({ ...draft, payCycleStartDay: clampDay(draft.payCycleStartDay), payCycleEndDay: clampDay(draft.payCycleEndDay), companyOffDays: [...draft.companyOffDays].sort(), currency: '₹' }); onSaved(); }
  return <div className="mx-auto max-w-[900px] space-y-7">
    <section className="fade-up"><div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.18em] text-[hsl(var(--primary))]"><SettingsIcon size={14} /> Personal rules</div><h2 className="m-0 font-display text-3xl font-bold tracking-tight md:text-4xl">Make the maths yours.</h2><p className="mt-2 max-w-xl text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">Set the rules from your contract or payslip. Every shift will use these numbers instantly.</p></section>
    <section className="fade-up delay-1 overflow-hidden rounded-[22px] border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] shadow-[var(--shadow-sm)]"><div className="border-b border-[hsl(var(--border))] bg-[#fff7df] px-5 py-4 md:px-7"><div className="flex items-start gap-3"><div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-[hsl(var(--accent))]"><CircleHelp size={16} /></div><div><div className="text-sm font-bold">These settings stay on this device</div><p className="mt-1 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">ShiftPro never sends your rates anywhere. Change them whenever your contract does.</p></div></div></div><div className="grid gap-8 p-5 md:grid-cols-2 md:p-7">
        <div className="space-y-5"><div><h3 className="m-0 font-display text-lg font-bold">Time rules</h3><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">How your hours become paid hours</p></div><div className="grid grid-cols-2 gap-3"><SettingField label="Tea break" hint="Per break" suffix="minutes"><input type="number" min="0" max="240" step="5" value={draft.teaBreakMinutes} onChange={(event) => update('teaBreakMinutes', Number(event.target.value))} className="shift-input pr-16" data-testid="input-tea-break-minutes" /></SettingField><SettingField label="Lunch break" hint="Per break" suffix="minutes"><input type="number" min="0" max="240" step="5" value={draft.lunchBreakMinutes} onChange={(event) => update('lunchBreakMinutes', Number(event.target.value))} className="shift-input pr-16" data-testid="input-lunch-break-minutes" /></SettingField></div><div className="border-t border-[hsl(var(--border))] pt-5"><h3 className="m-0 font-display text-lg font-bold">Company payroll month</h3><p className="mt-1 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">Use your company’s cycle, for example day 26 to day 25.</p><div className="mt-4 grid grid-cols-2 gap-3"><SettingField label="Starts on" hint="Calendar day" suffix="day"><input type="number" min="1" max="31" step="1" value={draft.payCycleStartDay} onChange={(event) => update('payCycleStartDay', Number(event.target.value))} className="shift-input pr-14" data-testid="input-pay-cycle-start" /></SettingField><SettingField label="Ends on" hint="Calendar day" suffix="day"><input type="number" min="1" max="31" step="1" value={draft.payCycleEndDay} onChange={(event) => update('payCycleEndDay', Number(event.target.value))} className="shift-input pr-14" data-testid="input-pay-cycle-end" /></SettingField></div></div><div className="border-t border-[hsl(var(--border))] pt-5"><h3 className="m-0 font-display text-lg font-bold">Company off-days</h3><p className="mt-1 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">Work logged on these days is automatically 100% overtime.</p><div className="mt-3 grid grid-cols-2 gap-2">{[['0', 'Sunday'], ['1', 'Monday'], ['2', 'Tuesday'], ['3', 'Wednesday'], ['4', 'Thursday'], ['5', 'Friday'], ['6', 'Saturday']].map(([value, label]) => <label key={value} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold ${draft.companyOffDays.includes(Number(value)) ? 'border-[#4aaa83] bg-[#e4f5ed] text-[#256b56]' : 'border-[hsl(var(--border))]'}`}><input type="checkbox" checked={draft.companyOffDays.includes(Number(value))} onChange={(event) => update('companyOffDays', event.target.checked ? [...draft.companyOffDays, Number(value)] : draft.companyOffDays.filter((day) => day !== Number(value)))} className="accent-[#34776f]" data-testid={`checkbox-off-day-${value}`} />{label}</label>)}</div></div></div>
       <div className="space-y-5"><div><h3 className="m-0 font-display text-lg font-bold">Pay rules</h3><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Choose whether regular pay is calculated by hour or by a standard day.</p></div><div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => update('payMode', 'hourly')} className={`rounded-xl border px-3 py-3 text-sm font-bold ${draft.payMode === 'hourly' ? 'border-[#34776f] bg-[#e4f5ed] text-[#256b56]' : 'border-[hsl(var(--border))]'}`} data-testid="button-pay-mode-hourly">Hourly pay</button><button type="button" onClick={() => update('payMode', 'daily')} className={`rounded-xl border px-3 py-3 text-sm font-bold ${draft.payMode === 'daily' ? 'border-[#34776f] bg-[#e4f5ed] text-[#256b56]' : 'border-[hsl(var(--border))]'}`} data-testid="button-pay-mode-daily">Daily pay</button></div>{draft.payMode === 'hourly' ? <SettingField label="Regular hourly rate" hint="Paid for each regular hour" suffix={draft.currency}><input type="number" min="0" step="0.01" value={draft.hourlyRate} onChange={(event) => update('hourlyRate', Number(event.target.value))} className="shift-input pr-16" data-testid="input-hourly-rate" /></SettingField> : <SettingField label="Standard day rate" hint="Paid for each regular working day" suffix={draft.currency}><input type="number" min="0" step="0.01" value={draft.dailyRate} onChange={(event) => update('dailyRate', Number(event.target.value))} className="shift-input pr-16" data-testid="input-daily-rate" /></SettingField>}<SettingField label="Overtime hourly rate" hint="Always paid separately for OT hours" suffix={draft.currency}><input type="number" min="0" step="0.01" value={draft.overtimeRate} onChange={(event) => update('overtimeRate', Number(event.target.value))} className="shift-input pr-16" data-testid="input-overtime-rate" /></SettingField><div className="border-t border-[hsl(var(--border))] pt-5"><h3 className="m-0 font-display text-lg font-bold">Attendance bonus</h3><p className="mt-1 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">Set the target, penalty, and zero-bonus absence limit.</p><div className="mt-4 space-y-3"><SettingField label="Target present days" hint="Days needed for full bonus" suffix="days"><input type="number" min="0" max="31" step="1" value={draft.bonusTargetDays} onChange={(event) => update('bonusTargetDays', Number(event.target.value))} className="shift-input pr-14" data-testid="input-bonus-target-days" /></SettingField><SettingField label="Full attendance bonus" hint="Paid when target is reached" suffix={draft.currency}><input type="number" min="0" step="0.01" value={draft.fullAttendanceBonus} onChange={(event) => update('fullAttendanceBonus', Number(event.target.value))} className="shift-input pr-16" data-testid="input-full-attendance-bonus" /></SettingField><div className="grid grid-cols-2 gap-3"><SettingField label="Absent penalty" hint="Deduct per absence" suffix={draft.currency}><input type="number" min="0" step="0.01" value={draft.absentPenalty} onChange={(event) => update('absentPenalty', Number(event.target.value))} className="shift-input pr-16" data-testid="input-absent-penalty" /></SettingField><SettingField label="Zero bonus after" hint="Absences above this" suffix="days"><input type="number" min="0" max="31" step="1" value={draft.bonusAbsentLimit} onChange={(event) => update('bonusAbsentLimit', Number(event.target.value))} className="shift-input pr-14" data-testid="input-bonus-absent-limit" /></SettingField></div></div></div></div>
    </div><div className="flex items-center justify-end gap-3 border-t border-[hsl(var(--border))] bg-[hsl(var(--muted)/.35)] px-5 py-4 md:px-7"><span className="mr-auto hidden text-xs text-[hsl(var(--muted-foreground))] sm:block">Used for all new and existing shift estimates</span><button onClick={() => setDraft(settings)} className="rounded-xl px-3.5 py-2.5 text-sm font-bold text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]" data-testid="button-reset-settings">Reset</button><button onClick={save} className="flex items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-bold text-white shadow-sm" data-testid="button-save-settings"><Check size={16} />Save rules</button></div></section>
    <section className="fade-up delay-2 grid gap-4 sm:grid-cols-3"><InfoTile icon={<CalendarDays size={17} />} label="Daily base wage" value={draft.payMode === 'daily' ? formatMoney(draft.dailyRate, draft.currency) : formatMoney(draft.hourlyRate * 8, draft.currency)} /><InfoTile icon={<TrendingUp size={17} />} label="OT hourly rate" value={formatMoney(draft.overtimeRate, draft.currency)} /><InfoTile icon={<Banknote size={17} />} label="Pay mode" value={draft.payMode === 'daily' ? 'Daily pay' : 'Hourly pay'} /></section>
  </div>;
}
function SettingField({ label, hint, suffix, children }: { label: string; hint: string; suffix: string; children: React.ReactNode }) {
  return <div><label className="mb-2 block text-sm font-bold">{label}</label><div className="relative">{children}<span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))]">{suffix}</span></div><div className="mt-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">{hint}</div></div>;
}
function InfoTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="rounded-2xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] p-4 shadow-[var(--shadow-sm)]"><div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-[#dce8f1] text-[#39627a]">{icon}</div><div className="font-mono text-[10px] uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">{label}</div><div className="mt-1 font-display text-xl font-bold">{value}</div></div>;
}

function NotFound() {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-[hsl(var(--background))] p-6 text-center"><div><div className="font-display text-6xl font-bold text-[hsl(var(--primary))]">404</div><h1 className="mt-3 font-display text-2xl font-bold">That page wandered off shift.</h1><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Head back to your overview to keep logging.</p><a href="#/" className="mt-6 inline-flex rounded-xl bg-[hsl(var(--primary))] px-4 py-3 text-sm font-bold text-white">Back to overview</a></div></div>;
}

export default App;