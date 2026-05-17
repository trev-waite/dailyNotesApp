import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import { formatDateString, todayString } from '../../utils/date';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function currentYearMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
}

const CELL_BASE =
  'relative flex flex-col items-center justify-center aspect-square rounded-md transition-colors duration-100 cursor-pointer ';

interface CalendarDay {
  date: string;
  dayNum: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  hasNote: boolean;
  hasTodoOpen: boolean;
  hasTodoDone: boolean;
  cellClass: string;
  dotClass: string;
}

type DayBase = Omit<CalendarDay, 'cellClass' | 'dotClass'>;

function buildCellClass(day: DayBase): string {
  if (day.isSelected) {
    const ring = day.isToday ? ' ring-2 ring-green-400 dark:ring-green-500' : '';
    return CELL_BASE + 'bg-stone-800 text-white dark:bg-stone-200 dark:text-stone-900' + ring;
  }
  if (day.isToday) {
    return CELL_BASE + 'ring-2 ring-green-400 dark:ring-green-500 text-stone-900 dark:text-stone-100 font-semibold';
  }
  if (!day.isCurrentMonth) {
    return CELL_BASE + 'text-stone-300 dark:text-stone-700 hover:bg-stone-50 dark:hover:bg-stone-900/50';
  }
  return CELL_BASE + 'text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800';
}

function buildDotClass(day: DayBase): string {
  const base = 'absolute bottom-0.5 w-1 h-1 rounded-full ';
  if (day.isSelected) return base + 'bg-white opacity-60';
  if (day.hasTodoOpen) return base + 'bg-yellow-400 dark:bg-yellow-400';
  if (day.hasTodoDone) return base + 'bg-green-400 dark:bg-green-500';
  return base + 'bg-stone-400 dark:bg-stone-500';
}

@Component({
  selector: 'app-calendar-nav',
  standalone: true,
  templateUrl: './calendar-nav.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalendarNavComponent {
  readonly selectedDate = input.required<string>();
  readonly noteDates = input<Set<string>>(new Set());
  readonly openTodoDates = input<Set<string>>(new Set());
  readonly doneTodoDates = input<Set<string>>(new Set());
  readonly compact = input<boolean>(true);
  readonly dateSelected = output<string>();

  readonly today = todayString();
  readonly DAY_LABELS = DAY_LABELS;
  readonly MONTH_NAMES = MONTH_NAMES;

  readonly viewMonth = signal(currentYearMonth());

  readonly outerClass = computed(() =>
    this.compact()
      ? 'flex flex-col gap-2 select-none py-1'
      : 'flex flex-col gap-4 select-none h-full',
  );
  readonly monthLabelClass = computed(() =>
    this.compact()
      ? 'text-xs font-semibold text-stone-700 dark:text-stone-300'
      : 'text-sm font-semibold text-stone-700 dark:text-stone-300',
  );
  readonly todayLinkClass = computed(() =>
    this.compact()
      ? 'text-[10px] font-medium text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 transition-colors'
      : 'text-xs font-medium text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 transition-colors',
  );
  readonly labelClass = computed(() =>
    this.compact()
      ? 'text-[9px] font-medium text-stone-400 dark:text-stone-600 py-0.5'
      : 'text-xs font-medium text-stone-400 dark:text-stone-600 py-1',
  );
  readonly cellTextClass = computed(() =>
    this.compact() ? 'text-[11px] leading-none' : 'text-sm leading-none',
  );

  private initialized = false;

  constructor() {
    effect(
      () => {
        if (!this.initialized) {
          const [y, m] = this.selectedDate().split('-').map(Number);
          this.viewMonth.set({ year: y, month: m - 1 });
          this.initialized = true;
        }
      },
      { allowSignalWrites: true },
    );
  }

  readonly viewMonthLabel = computed(() => {
    const { year, month } = this.viewMonth();
    return `${MONTH_NAMES[month]} ${year}`;
  });

  readonly isViewingTodayMonth = computed(() => {
    const { year, month } = this.viewMonth();
    const now = new Date();
    return year === now.getFullYear() && month === now.getMonth();
  });

  readonly calendarDays = computed<CalendarDay[]>(() => {
    const { year, month } = this.viewMonth();
    const selected = this.selectedDate();
    const notes = this.noteDates();
    const openTodos = this.openTodoDates();
    const doneTodos = this.doneTodoDates();
    const today = this.today;

    const firstOfMonth = new Date(year, month, 1);
    const start = new Date(year, month, 1 - firstOfMonth.getDay());

    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const date = formatDateString(d);
      const base: DayBase = {
        date,
        dayNum: d.getDate(),
        isCurrentMonth: d.getMonth() === month,
        isToday: date === today,
        isSelected: date === selected,
        hasNote: notes.has(date),
        hasTodoOpen: openTodos.has(date),
        hasTodoDone: doneTodos.has(date),
      };
      return { ...base, cellClass: buildCellClass(base), dotClass: buildDotClass(base) };
    });
  });

  prevMonth(): void {
    this.viewMonth.update(({ year, month }) =>
      month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 },
    );
  }

  nextMonth(): void {
    this.viewMonth.update(({ year, month }) =>
      month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 },
    );
  }

  goToToday(): void {
    const now = new Date();
    this.viewMonth.set({ year: now.getFullYear(), month: now.getMonth() });
    this.dateSelected.emit(this.today);
  }

  selectDate(date: string): void {
    this.dateSelected.emit(date);
  }
}
