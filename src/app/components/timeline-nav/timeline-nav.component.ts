import {
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WINDOW = 3; // days on each side of selected

@Component({
  selector: 'app-timeline-nav',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './timeline-nav.component.html',
})
export class TimelineNavComponent {
  readonly selectedDate = input.required<string>();
  readonly noteDates = input<Set<string>>(new Set());
  readonly dateSelected = output<string>();

  /** Offset from today used when arrows are pressed */
  readonly windowOffset = signal(0);

  readonly days = computed(() => {
    const center = this.selectedDate();
    return Array.from({ length: 7 }, (_, i) => {
      const dateStr = addDays(center, i - WINDOW);
      const d = new Date(dateStr + 'T00:00:00');
      return {
        date: dateStr,
        dayName: DAY_NAMES[d.getDay()],
        dayNum: d.getDate(),
        isSelected: dateStr === center,
        hasNote: this.noteDates().has(dateStr),
      };
    });
  });

  readonly todayDate = toDateStr(new Date());

  isToday = computed(() => this.selectedDate() === this.todayDate);

  select(date: string): void {
    this.dateSelected.emit(date);
  }

  goToToday(): void {
    this.dateSelected.emit(this.todayDate);
  }

  prev(): void {
    this.dateSelected.emit(addDays(this.selectedDate(), -1));
  }

  next(): void {
    this.dateSelected.emit(addDays(this.selectedDate(), 1));
  }
}
