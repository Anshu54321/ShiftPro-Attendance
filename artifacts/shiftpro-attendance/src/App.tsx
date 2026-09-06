import { useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  AlarmClock, ArrowRight, Banknote, CalendarDays,
  Check, ChevronLeft, ChevronRight, CircleHelp, Clock3, Coffee, Edit3,
  Gauge, LayoutDashboard, Menu, Moon, Plus, Save, Settings as SettingsIcon,
  Sparkles, Sun, Trash2, TrendingUp, X, Zap,
} from 'lucide-react';
import { Route, Switch, Router as WouterRouter, useLocation } from 'wouter';

type View = 'dashboard' | 'calendar' | 'settings';
type Settings = {
  dutyHours: number;
  breakMinutes: number;
  hourlyRate: number;
  overtimeRate: number;
  bonusPerShift: number;
  currency: string;
  payCycleStartDay: number;
  payCycleEndDay: number;
};
type Shift = {
  date: string;
  entry: string;
  exit: string;
  shiftType: 'day' | 'night';
  isHoliday: boolean;
  breakCount: number;
  manual: boolean;
  manualAmount: number;
};
type ComputedShift = Shift & {
  totalMinutes: number;
  paidMinutes: number;
  regularMinutes: number;
  overtimeMinutes: number;
  pay: number;
};

const queryClient = new QueryClient();
const STORAGE_SHIFTS = 'shiftpro-shifts-v1';
const STORAGE_SETTINGS = 'shiftpro-settings-v1';
const defaultSettings: Settings = {
  dutyHours: 8,
  breakMinutes: 30,
  hourlyRate: 18.5,
  overtimeRate: 27.75,
  bonusPerShift: 0,
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
function computeShift(shift: Shift, settings: Settings): ComputedShift {
  const totalMinutes = shiftDurationMinutes(shift.entry, shift.exit);
  const paidMinutes = Math.max(0, totalMinutes - shift.breakCount * settings.breakMinutes);
  const regularMinutes = Math.min(paidMinutes, settings.dutyHours * 60);
  const overtimeMinutes = Math.max(0, paidMinutes - regularMinutes);
  const calculatedPay = (regularMinutes / 60) * settings.hourlyRate
    + (overtimeMinutes / 60) * settings.overtimeRate
    + settings.bonusPerShift;
  return { ...shift, shiftType: shift.shiftType || 'day', isHoliday: Boolean(shift.isHoliday), totalMinutes, paidMinutes, regularMinutes, overtimeMinutes, pay: shift.manual && shift.manualAmount >= 0 ? shift.manualAmount : calculatedPay };
}

function useStoredData() {
  const [settings, setSettings] = useState<Settings>(() => {
    try {
      return { ...defaultSettings, ...JSON.parse(localStorage.getItem(STORAGE_SETTINGS) || '{}'), currency: '₹' };
    } catch { return defaultSettings; }
  });
  const [shifts, setShifts] = useState<Record<string, Shift>>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_SHIFTS) || '{}'); } catch { return {}; }
  });
  useEffect(() => { localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(settings)); }, [settings]);
  useEffect(() => { localStorage.setItem(STORAGE_SHIFTS, JSON.stringify(shifts)); }, [shifts]);
  return { settings, setSettings, shifts, setShifts };
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Switch>
            <Route path="/" component={Home} />
            <Route path="/settings" component={Home} />
            <Route path="/calendar" component={Home} />
            <Route component={NotFound} />
          </Switch>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function Home() {
  const [location, setLocation] = useLocation();
  const storage = useStoredData();
  const initialView: View = location === '/settings' ? 'settings' : location === '/calendar' ? 'calendar' : 'dashboard';
  const [view, setView] = useState<View>(initialView);
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [editorDate, setEditorDate] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [mobileNav, setMobileNav] = useState(false);

  useEffect(() => {
    setView(location === '/settings' ? 'settings' : location === '/calendar' ? 'calendar' : 'dashboard');
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
  const currentMonthPay = payrollShifts.reduce((sum, shift) => sum + shift.pay, 0);
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

  return (
    <div className="app-shell grain flex bg-[hsl(var(--background))]">
      <aside className={`fixed inset-y-0 left-0 z-30 flex w-[248px] flex-col bg-[hsl(var(--sidebar))] px-5 py-6 text-[hsl(var(--sidebar-foreground))] transition-transform duration-300 md:relative md:translate-x-0 ${mobileNav ? 'translate-x-0' : '-translate-x-full'}`}>
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
        <header className="sticky top-0 z-10 flex h-[74px] items-center justify-between border-b border-[hsl(var(--border))] bg-[hsl(var(--background)/.9)] px-5 backdrop-blur-md md:px-10">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileNav(true)} className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2.5 md:hidden" data-testid="button-open-nav"><Menu size={18} /></button>
            <div className="md:hidden font-display text-lg font-bold">Shift<span className="text-[hsl(var(--primary))]">Pro</span></div>
            <div className="hidden md:block">
              <p className="m-0 font-mono text-[10px] uppercase tracking-[.18em] text-[hsl(var(--muted-foreground))]">{view === 'dashboard' ? 'Your snapshot' : view === 'calendar' ? 'Your month at a glance' : 'Make the maths yours'}</p>
              <h1 className="m-0 mt-0.5 font-display text-xl font-bold">{view === 'dashboard' ? 'Good morning, worker.' : view === 'calendar' ? 'Attendance calendar' : 'Pay settings'}</h1>
            </div>
          </div>
          <button onClick={() => { setEditorDate(todayKey); }} className="flex items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-3.5 py-2.5 text-sm font-bold text-white shadow-[0_5px_15px_rgba(229,104,76,.25)] transition-transform hover:-translate-y-0.5" data-testid="button-log-shift-header"><Plus size={17} strokeWidth={2.5} /><span className="hidden sm:inline">Log a shift</span><span className="sm:hidden">Log</span></button>
        </header>
        <div className="mx-auto max-w-[1380px] px-5 py-7 md:px-10 md:py-9">
          {view === 'dashboard' && <Dashboard settings={storage.settings} shifts={computedShifts} todayKey={todayKey} month={month} payrollPeriod={payrollPeriod} monthPay={currentMonthPay} monthMinutes={currentMonthMinutes} monthOvertime={currentMonthOvertime} onPreviousPeriod={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} onNextPeriod={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} onAdd={() => { setEditorDate(todayKey); }} onEdit={setEditorDate} onCalendar={() => navigate('calendar')} />}
          {view === 'calendar' && <CalendarView month={month} setMonth={setMonth} shifts={computedShifts} settings={storage.settings} todayKey={todayKey} onEdit={setEditorDate} onAdd={(key) => setEditorDate(key)} />}
          {view === 'settings' && <SettingsView settings={storage.settings} setSettings={storage.setSettings} onSaved={() => setToast('Pay rules updated')} />}
        </div>
      </main>
      <div className="fixed inset-x-0 bottom-0 z-10 flex border-t border-[hsl(var(--border))] bg-[hsl(var(--card)/.96)] px-3 py-2 backdrop-blur-lg md:hidden">
        <MobileNav icon={<LayoutDashboard size={19} />} label="Overview" active={view === 'dashboard'} onClick={() => navigate('dashboard')} testId="mobile-nav-overview" />
        <MobileNav icon={<CalendarDays size={19} />} label="Calendar" active={view === 'calendar'} onClick={() => navigate('calendar')} testId="mobile-nav-calendar" />
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

function Dashboard({ settings, shifts, todayKey, month, payrollPeriod, monthPay, monthMinutes, monthOvertime, onPreviousPeriod, onNextPeriod, onAdd, onEdit, onCalendar }: { settings: Settings; shifts: ComputedShift[]; todayKey: string; month: Date; payrollPeriod: { start: Date; end: Date }; monthPay: number; monthMinutes: number; monthOvertime: number; onPreviousPeriod: () => void; onNextPeriod: () => void; onAdd: () => void; onEdit: (key: string) => void; onCalendar: () => void }) {
  const today = shifts.find((shift) => shift.date === todayKey);
  const monthShifts = shifts.filter((shift) => {
    const date = dateFromKey(shift.date);
    return date >= payrollPeriod.start && date <= payrollPeriod.end;
  }).sort((a, b) => b.date.localeCompare(a.date));
  const daysWorked = monthShifts.length;
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
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-blue-100/80">{today ? `${formatDuration(today.paidMinutes)} paid today${today.overtimeMinutes ? ` · ${formatDuration(today.overtimeMinutes)} overtime` : ''} · ${today.shiftType === 'night' ? 'night shift' : 'day shift'}.` : 'Track day and night shifts, see overtime as it happens, and keep your Indian rupee earnings clear.'}</p>
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
    <section className="grid gap-5 lg:grid-cols-[.9fr_1.1fr]">
      <div className="fade-up delay-1 overflow-hidden rounded-[22px] border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] p-5 shadow-[var(--shadow-sm)] md:p-6">
        <div className="mb-6 flex items-start justify-between"><div><div className="flex items-center gap-2"><h3 className="m-0 font-display text-lg font-bold">Workday pulse</h3><span className="rounded-md bg-[#d8f0eb] px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-[.1em] text-[#267163]">Live</span></div><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Your workdays this month</p></div><button onClick={onCalendar} className="rounded-lg p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]" data-testid="button-view-calendar"><CalendarDays size={18} /></button></div>
        <div className="flex items-center gap-5"><div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-full" style={{ background: `conic-gradient(#057b78 ${progress}%, hsl(var(--muted)) ${progress}% 100%)` }}><div className="flex h-[92px] w-[92px] flex-col items-center justify-center rounded-full bg-[hsl(var(--card))]"><strong className="font-display text-3xl">{progress}%</strong><span className="font-mono text-[9px] uppercase tracking-widest text-[hsl(var(--muted-foreground))]">on track</span></div></div><div className="min-w-0"><div className="font-display text-2xl font-bold">{daysWorked} <span className="text-sm font-medium text-[hsl(var(--muted-foreground))]">{daysWorked === 1 ? 'day' : 'days'}</span></div><p className="mt-2 max-w-[260px] text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">{daysWorked ? 'Every entry is turning into a clearer payday.' : 'Your calendar is waiting for its first day. Start with today.'}</p></div></div>
        <div className="mt-7 h-2 overflow-hidden rounded-full bg-[hsl(var(--muted))]"><div className="h-full rounded-full bg-[linear-gradient(90deg,#057b78,#f9d45c)] transition-all" style={{ width: `${progress}%` }} /></div>
      </div>
      <div className="fade-up delay-2 rounded-[22px] border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] p-5 shadow-[var(--shadow-sm)] md:p-6">
        <div className="mb-5 flex items-center justify-between"><div><h3 className="m-0 font-display text-lg font-bold">Recent days</h3><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Tap a day to edit its pay</p></div><CalendarDays size={19} className="text-[hsl(var(--muted-foreground))]" /></div>
        {monthShifts.length === 0 ? <EmptyMini onAdd={onAdd} /> : <div className="grid gap-2 sm:grid-cols-2">{monthShifts.slice(0, 4).map((shift) => <button key={shift.date} onClick={() => onEdit(shift.date)} className="group flex w-full items-center justify-between rounded-xl border border-transparent bg-[hsl(var(--muted)/.4)] px-3 py-3 text-left transition-colors hover:border-[hsl(var(--border))] hover:bg-[hsl(var(--muted)/.75)]" data-testid={`row-recent-shift-${shift.date}`}><div className="flex min-w-0 items-center gap-3"><div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${shift.shiftType === 'night' ? 'bg-[#e8e0fa] text-[#7250a5]' : 'bg-[#dff0ef] text-[#34736e]'}`}>{shift.shiftType === 'night' ? <Moon size={16} /> : <Sun size={16} />}</div><div className="min-w-0"><div className="truncate text-sm font-bold">{dateFromKey(shift.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</div><div className="font-mono text-[10px] text-[hsl(var(--muted-foreground))]">{shift.shiftType === 'night' ? 'Night' : 'Day'} · {formatTime12(shift.entry)} – {formatTime12(shift.exit)}{shift.overtimeMinutes ? ` · ${formatDuration(shift.overtimeMinutes)} OT` : ''}</div></div></div><span className="font-mono text-sm font-bold">{formatMoney(shift.pay, settings.currency)}</span></button>)}</div>}
      </div>
    </section>
  </div>;
}

function MetricCard({ label, value, sub, icon, tone }: { label: string; value: string; sub: string; icon: React.ReactNode; tone: string }) {
  const colors: Record<string, string> = { coral: 'bg-[#fde3dc] text-[#c65241]', teal: 'bg-[#d9efeb] text-[#34776f]', yellow: 'bg-[#fff0bd] text-[#9b7422]', blue: 'bg-[#dce8f1] text-[#39627a]' };
  return <div className="fade-up rounded-[18px] border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] p-4 shadow-[var(--shadow-sm)]"><div className="mb-4 flex items-center justify-between"><span className="font-mono text-[10px] uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">{label}</span><span className={`flex h-8 w-8 items-center justify-center rounded-lg ${colors[tone]}`}>{icon}</span></div><div className="font-display text-[25px] font-bold tracking-tight">{value}</div><div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{sub}</div></div>;
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
        const overtimeRatio = shift ? Math.min(1, shift.overtimeMinutes / Math.max(60, settings.dutyHours * 60)) : 0;
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

function ShiftEditor({ date, existing, settings, onSave, onDelete, onClose }: { date: string; existing?: Shift; settings: Settings; onSave: (shift: Shift) => void; onDelete: (key: string) => void; onClose: () => void }) {
  const [entry, setEntry] = useState(existing?.entry || '09:00');
  const [exit, setExit] = useState(existing?.exit || '17:00');
  const [shiftType, setShiftType] = useState<'day' | 'night'>(existing?.shiftType || 'day');
  const [isHoliday, setIsHoliday] = useState(existing?.isHoliday || false);
  const [breakCount, setBreakCount] = useState(existing?.breakCount ?? 1);
  const [manual, setManual] = useState(existing?.manual || false);
  const [manualAmount, setManualAmount] = useState(existing?.manualAmount?.toString() || '');
  const [error, setError] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const preview = computeShift({ date, entry, exit, shiftType, isHoliday, breakCount, manual, manualAmount: Number(manualAmount) || 0 }, settings);
  const isOvernight = minutesFromTime(exit) < minutesFromTime(entry);
  useEffect(() => { panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, []);
  function save() {
    const total = shiftDurationMinutes(entry, exit);
    if (!entry || !exit) { setError('Add both an entry and exit time.'); return; }
    if (total <= breakCount * settings.breakMinutes) { setError('Your break time cannot be longer than this shift.'); return; }
    if (manual && (!manualAmount || Number(manualAmount) < 0)) { setError('Add the manual amount you want to use.'); return; }
    onSave({ date, entry, exit, shiftType, isHoliday, breakCount, manual, manualAmount: Number(manualAmount) || 0 });
  }
  const labelDate = friendlyDate(date, true);
  return <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-950/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div ref={panelRef} className="fade-up max-h-[92dvh] w-full overflow-y-auto rounded-t-[25px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-2xl sm:max-w-[540px] sm:rounded-[25px]">
    <div className="sticky top-0 z-10 flex items-start justify-between border-b border-[hsl(var(--border))] bg-[hsl(var(--card)/.96)] px-5 py-5 backdrop-blur-md md:px-7"><div><div className="mb-1 font-mono text-[10px] uppercase tracking-[.16em] text-[hsl(var(--primary))]">{existing ? 'Edit logged day' : 'New day entry'}</div><h2 className="m-0 font-display text-2xl font-bold">{labelDate}</h2></div><button onClick={onClose} className="rounded-xl p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]" data-testid="button-close-editor"><X size={19} /></button></div>
     <div className="space-y-5 px-5 py-6 md:px-7">
        <div className="grid grid-cols-2 gap-3"><TimeField label="Entry (AM / PM)" value={entry} onChange={setEntry} testId="input-entry-time" /><TimeField label="Exit (AM / PM)" value={exit} onChange={setExit} testId="input-exit-time" /></div>
        <div className="flex items-center gap-2 rounded-xl bg-[hsl(var(--muted)/.65)] px-3 py-2.5 text-xs text-[hsl(var(--muted-foreground))]"><Clock3 size={14} className="shrink-0 text-[hsl(var(--primary))]" />{isOvernight ? 'Overnight timing: exit is counted on the next day, and extra time after regular duty becomes OT.' : `Regular duty is ${settings.dutyHours}h; anything beyond it becomes OT.`}</div>
       <div><div className="mb-2 flex items-center justify-between"><label className="text-sm font-bold">Shift type</label><span className="font-mono text-[10px] uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">{shiftType === 'night' ? 'Night hours' : 'Day hours'}</span></div><div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => setShiftType('day')} className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-bold transition-colors ${shiftType === 'day' ? 'border-[#4aaa83] bg-[#e4f5ed] text-[#256b56]' : 'border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--muted-foreground))]'}`} data-testid="button-shift-day"><Sun size={16} /> Day shift</button><button type="button" onClick={() => setShiftType('night')} className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-bold transition-colors ${shiftType === 'night' ? 'border-[#9e7bd0] bg-[#eee8fc] text-[#6d4a9d]' : 'border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--muted-foreground))]'}`} data-testid="button-shift-night"><Moon size={16} /> Night shift</button></div></div>
       <button type="button" onClick={() => setIsHoliday(!isHoliday)} className={`flex w-full items-center justify-between rounded-xl border px-3.5 py-3 text-left transition-colors ${isHoliday ? 'border-[#e87368] bg-[#ffe1de]' : 'border-[hsl(var(--border))] bg-[hsl(var(--card))]'}`} aria-pressed={isHoliday} data-testid="button-toggle-holiday"><span><span className="block text-sm font-bold">Holiday workday</span><span className="mt-0.5 block text-[11px] text-[hsl(var(--muted-foreground))]">Show this date in red on the calendar</span></span><span className={`relative h-6 w-11 rounded-full transition-colors ${isHoliday ? 'bg-[#d94f49]' : 'bg-[hsl(var(--border))]'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${isHoliday ? 'left-6' : 'left-1'}`} /></span></button>
      <div className="rounded-2xl bg-[hsl(var(--muted)/.65)] p-4"><div className="mb-3 flex items-center justify-between"><label className="flex items-center gap-2 text-sm font-bold"><Coffee size={16} className="text-[hsl(var(--primary))]" />Breaks taken</label><span className="font-mono text-[10px] text-[hsl(var(--muted-foreground))]">{settings.breakMinutes} min each</span></div><div className="flex items-center justify-between"><span className="text-xs text-[hsl(var(--muted-foreground))]">Unpaid breaks during this shift</span><div className="flex items-center gap-3"><button onClick={() => setBreakCount(Math.max(0, breakCount - 1))} className="flex h-8 w-8 items-center justify-center rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-lg font-medium" data-testid="button-break-decrease">−</button><span className="w-5 text-center font-mono font-medium" data-testid="text-break-count">{breakCount}</span><button onClick={() => setBreakCount(Math.min(8, breakCount + 1))} className="flex h-8 w-8 items-center justify-center rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-lg font-medium" data-testid="button-break-increase">+</button></div></div></div>
      <div className="grid grid-cols-3 gap-2 rounded-2xl border border-[hsl(var(--border))] bg-[#fffaf0] p-3 text-center"><div><div className="font-mono text-[9px] uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">Paid time</div><strong className="mt-1 block font-display text-lg">{formatDuration(preview.paidMinutes)}</strong></div><div><div className="font-mono text-[9px] uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">Regular</div><strong className="mt-1 block font-display text-lg">{formatDuration(preview.regularMinutes)}</strong></div><div><div className="font-mono text-[9px] uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">Est. pay</div><strong className="mt-1 block font-display text-lg text-[hsl(var(--primary))]">{formatMoney(preview.pay, settings.currency)}</strong></div></div>
      {preview.overtimeMinutes > 0 && <div className="flex items-center gap-2 rounded-xl bg-[#fff0bd] px-3 py-2.5 text-xs font-semibold text-[#7a5b1b]"><TrendingUp size={15} />{formatDuration(preview.overtimeMinutes)} will be paid at your overtime rate.</div>}
      <div className="rounded-xl border border-[hsl(var(--border))] px-3.5 py-3"><div className="flex items-center justify-between gap-3"><div><div className="text-sm font-bold">Use a manual total</div><div className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))]">For payslips or a manager-approved amount</div></div><button onClick={() => setManual(!manual)} className={`relative h-6 w-11 rounded-full transition-colors ${manual ? 'bg-[hsl(var(--primary))]' : 'bg-[hsl(var(--border))]'}`} aria-pressed={manual} data-testid="button-toggle-manual-pay"><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${manual ? 'left-6' : 'left-1'}`} /></button></div>{manual && <div className="mt-3"><label className="mb-1.5 block text-xs font-bold" htmlFor="manual-total">Amount ({settings.currency})</label><input id="manual-total" type="number" min="0" step="0.01" value={manualAmount} onChange={(event) => setManualAmount(event.target.value)} className="shift-input" placeholder="0.00" data-testid="input-manual-amount" /></div>}</div>
      {error && <div className="rounded-xl bg-[#fbe1dd] px-3 py-2.5 text-xs font-semibold text-[#a83c33]" role="alert" data-testid="status-editor-error">{error}</div>}
      <div className="flex gap-2.5 pt-1"><button onClick={save} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 py-3.5 text-sm font-bold text-white shadow-md shadow-orange-950/10 transition-transform hover:-translate-y-0.5" data-testid="button-save-shift"><Save size={16} /> Save shift</button>{existing && <button onClick={() => { if (window.confirm('Remove this shift from your journal?')) onDelete(date); }} className="rounded-xl border border-[#f0c8c2] px-4 text-[#b34a40] hover:bg-[#fbe8e5]" data-testid="button-delete-shift"><Trash2 size={17} /></button>}</div>
    </div>
  </div></div>;
}
function timeParts(time: string) {
  const [rawHours, rawMinutes] = time.split(':').map(Number);
  const hours = Number.isNaN(rawHours) ? 9 : rawHours;
  const minutes = Number.isNaN(rawMinutes) ? 0 : rawMinutes;
  return { hour: String(hours % 12 || 12), minute: String(minutes).padStart(2, '0'), period: hours >= 12 ? 'PM' : 'AM' };
}
function timeFromParts(hour: string, minute: string, period: string) {
  let hours = Number(hour) % 12;
  if (period === 'PM') hours += 12;
  return `${String(hours).padStart(2, '0')}:${minute}`;
}
function TimeField({ label, value, onChange, testId }: { label: string; value: string; onChange: (value: string) => void; testId: string }) {
  const parts = timeParts(value);
  const updateTime = (hour: string, minute: string, period: string) => onChange(timeFromParts(hour, minute, period));
  return <div><label className="mb-2 block text-sm font-bold">{label}</label><div className="grid grid-cols-[1fr_1fr_1.1fr] gap-1.5"><div className="relative"><AlarmClock size={14} className="pointer-events-none absolute left-2 top-1/2 z-[1] -translate-y-1/2 text-[hsl(var(--muted-foreground))]" /><select value={parts.hour} onChange={(event) => updateTime(event.target.value, parts.minute, parts.period)} onFocus={(event) => event.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'center' })} className="shift-input pl-7 font-mono text-xs" aria-label={`${label} hour`} data-testid={`${testId}-hour`}>{Array.from({ length: 12 }, (_, index) => String(index + 1)).map((hour) => <option key={hour} value={hour}>{hour}</option>)}</select></div><select value={parts.minute} onChange={(event) => updateTime(parts.hour, event.target.value, parts.period)} onFocus={(event) => event.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'center' })} className="shift-input font-mono text-xs" aria-label={`${label} minute`} data-testid={`${testId}-minute`}>{Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0')).map((minute) => <option key={minute} value={minute}>{minute}</option>)}</select><select value={parts.period} onChange={(event) => updateTime(parts.hour, parts.minute, event.target.value)} onFocus={(event) => event.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'center' })} className="shift-input font-mono text-xs font-bold" aria-label={`${label} AM or PM`} data-testid={`${testId}-period`}><option value="AM">AM</option><option value="PM">PM</option></select></div><div className="mt-1.5 pl-1 font-mono text-[11px] font-bold tracking-wide text-[hsl(var(--primary))]">{formatTime12(value)}</div></div>;
}

function SettingsView({ settings, setSettings, onSaved }: { settings: Settings; setSettings: (value: Settings | ((previous: Settings) => Settings)) => void; onSaved: () => void }) {
  const [draft, setDraft] = useState(settings);
  useEffect(() => setDraft(settings), [settings]);
  function update<K extends keyof Settings>(key: K, value: Settings[K]) { setDraft((current) => ({ ...current, [key]: value })); }
  function save() { if (draft.dutyHours <= 0 || draft.breakMinutes < 0 || draft.hourlyRate < 0 || draft.overtimeRate < 0 || draft.bonusPerShift < 0 || draft.payCycleStartDay < 1 || draft.payCycleStartDay > 31 || draft.payCycleEndDay < 1 || draft.payCycleEndDay > 31) return; setSettings({ ...draft, payCycleStartDay: clampDay(draft.payCycleStartDay), payCycleEndDay: clampDay(draft.payCycleEndDay), currency: '₹' }); onSaved(); }
  return <div className="mx-auto max-w-[900px] space-y-7">
    <section className="fade-up"><div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.18em] text-[hsl(var(--primary))]"><SettingsIcon size={14} /> Personal rules</div><h2 className="m-0 font-display text-3xl font-bold tracking-tight md:text-4xl">Make the maths yours.</h2><p className="mt-2 max-w-xl text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">Set the rules from your contract or payslip. Every shift will use these numbers instantly.</p></section>
    <section className="fade-up delay-1 overflow-hidden rounded-[22px] border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] shadow-[var(--shadow-sm)]"><div className="border-b border-[hsl(var(--border))] bg-[#fff7df] px-5 py-4 md:px-7"><div className="flex items-start gap-3"><div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-[hsl(var(--accent))]"><CircleHelp size={16} /></div><div><div className="text-sm font-bold">These settings stay on this device</div><p className="mt-1 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">ShiftPro never sends your rates anywhere. Change them whenever your contract does.</p></div></div></div><div className="grid gap-8 p-5 md:grid-cols-2 md:p-7">
       <div className="space-y-5"><div><h3 className="m-0 font-display text-lg font-bold">Time rules</h3><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">How your hours become paid hours</p></div><SettingField label="Standard duty hours" hint="Hours before overtime begins" suffix="hours"><input type="number" min="0.5" max="24" step="0.5" value={draft.dutyHours} onChange={(event) => update('dutyHours', Number(event.target.value))} className="shift-input pr-16" data-testid="input-duty-hours" /></SettingField><SettingField label="Break length" hint="Applied for each break count" suffix="minutes"><input type="number" min="0" max="240" step="5" value={draft.breakMinutes} onChange={(event) => update('breakMinutes', Number(event.target.value))} className="shift-input pr-16" data-testid="input-break-minutes" /></SettingField><div className="border-t border-[hsl(var(--border))] pt-5"><h3 className="m-0 font-display text-lg font-bold">Company payroll month</h3><p className="mt-1 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">Use your company’s cycle, for example day 26 to day 25.</p><div className="mt-4 grid grid-cols-2 gap-3"><SettingField label="Starts on" hint="Calendar day" suffix="day"><input type="number" min="1" max="31" step="1" value={draft.payCycleStartDay} onChange={(event) => update('payCycleStartDay', Number(event.target.value))} className="shift-input pr-14" data-testid="input-pay-cycle-start" /></SettingField><SettingField label="Ends on" hint="Calendar day" suffix="day"><input type="number" min="1" max="31" step="1" value={draft.payCycleEndDay} onChange={(event) => update('payCycleEndDay', Number(event.target.value))} className="shift-input pr-14" data-testid="input-pay-cycle-end" /></SettingField></div></div></div>
      <div className="space-y-5"><div><h3 className="m-0 font-display text-lg font-bold">Pay rules</h3><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">The rates behind your estimate</p></div><SettingField label="Regular hourly rate" hint="Your standard rate" suffix={draft.currency}><input type="number" min="0" step="0.01" value={draft.hourlyRate} onChange={(event) => update('hourlyRate', Number(event.target.value))} className="shift-input pr-16" data-testid="input-hourly-rate" /></SettingField><SettingField label="Overtime hourly rate" hint="Applied after standard duty hours" suffix={draft.currency}><input type="number" min="0" step="0.01" value={draft.overtimeRate} onChange={(event) => update('overtimeRate', Number(event.target.value))} className="shift-input pr-16" data-testid="input-overtime-rate" /></SettingField><SettingField label="Bonus per shift" hint="Optional fixed bonus added each time" suffix={draft.currency}><input type="number" min="0" step="0.01" value={draft.bonusPerShift} onChange={(event) => update('bonusPerShift', Number(event.target.value))} className="shift-input pr-16" data-testid="input-bonus-rate" /></SettingField></div>
    </div><div className="flex items-center justify-end gap-3 border-t border-[hsl(var(--border))] bg-[hsl(var(--muted)/.35)] px-5 py-4 md:px-7"><span className="mr-auto hidden text-xs text-[hsl(var(--muted-foreground))] sm:block">Used for all new and existing shift estimates</span><button onClick={() => setDraft(settings)} className="rounded-xl px-3.5 py-2.5 text-sm font-bold text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]" data-testid="button-reset-settings">Reset</button><button onClick={save} className="flex items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-bold text-white shadow-sm" data-testid="button-save-settings"><Check size={16} />Save rules</button></div></section>
    <section className="fade-up delay-2 grid gap-4 sm:grid-cols-3"><InfoTile icon={<Clock3 size={17} />} label="Regular time" value={`${draft.dutyHours}h`} /><InfoTile icon={<TrendingUp size={17} />} label="OT starts after" value={`${draft.dutyHours} hours`} /><InfoTile icon={<Banknote size={17} />} label="OT rate" value={formatMoney(draft.overtimeRate, draft.currency)} /></section>
  </div>;
}
function SettingField({ label, hint, suffix, children }: { label: string; hint: string; suffix: string; children: React.ReactNode }) {
  return <div><label className="mb-2 block text-sm font-bold">{label}</label><div className="relative">{children}<span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))]">{suffix}</span></div><div className="mt-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">{hint}</div></div>;
}
function InfoTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="rounded-2xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] p-4 shadow-[var(--shadow-sm)]"><div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-[#dce8f1] text-[#39627a]">{icon}</div><div className="font-mono text-[10px] uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">{label}</div><div className="mt-1 font-display text-xl font-bold">{value}</div></div>;
}

function NotFound() {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-[hsl(var(--background))] p-6 text-center"><div><div className="font-display text-6xl font-bold text-[hsl(var(--primary))]">404</div><h1 className="mt-3 font-display text-2xl font-bold">That page wandered off shift.</h1><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Head back to your overview to keep logging.</p><a href="/" className="mt-6 inline-flex rounded-xl bg-[hsl(var(--primary))] px-4 py-3 text-sm font-bold text-white">Back to overview</a></div></div>;
}

export default App;