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
  hasTodo: boolean;
  cellClass: string;
  dotClass: string;
}

type DayBase = Omit<CalendarDay, 'cellClass' | 'dotClass'>;

function buildCellClass(day: DayBase): string {
  if (day.isSelected) {
    return CELL_BASE + 'bg-stone-800 text-white dark:bg-stone-200 dark:text-stone-900';
  }
  if (day.isToday) {
    return CELL_BASE + 'bg-stone-200 text-stone-900 dark:bg-stone-700 dark:text-stone-100 font-semibold';
  }
  if (!day.isCurrentMonth) {
    return CELL_BASE + 'text-stone-300 dark:text-stone-700 hover:bg-stone-50 dark:hover:bg-stone-900/50';
  }
  return CELL_BASE + 'text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800';
}

function buildDotClass(day: DayBase): string {
  const base = 'absolute bottom-0.5 w-1 h-1 rounded-full ';
  if (day.isSelected || day.isToday) return base + 'bg-current opacity-50';
  if (day.hasTodo) return base + 'bg-blue-400 dark:bg-blue-500';
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
  readonly todoDates = input<Set<string>>(new Set());
  readonly dateSelected = output<string>();

  readonly today = todayString();
  readonly DAY_LABELS = DAY_LABELS;
  readonly MONTH_NAMES = MONTH_NAMES;

  readonly viewMonth = signal(currentYearMonth());

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
    const todos = this.todoDates();
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
        hasTodo: todos.has(date),
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
