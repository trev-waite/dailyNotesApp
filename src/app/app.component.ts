import {
  Component,
  OnInit,
  ViewChild,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Subject, debounceTime, switchMap, from, tap } from 'rxjs';

import { NoteStorageService } from './services/note-storage.service';
import { ThemeService } from './services/theme.service';
import { TimelineNavComponent } from './components/timeline-nav/timeline-nav.component';
import { DayEditorComponent } from './components/day-editor/day-editor.component';
import { OutgoingTodosComponent } from './components/outgoing-todos/outgoing-todos.component';
import { SettingsComponent } from './components/settings/settings.component';

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

type SaveStatus = 'idle' | 'saving' | 'saved';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [TimelineNavComponent, DayEditorComponent, OutgoingTodosComponent, SettingsComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements OnInit {
  private readonly storage = inject(NoteStorageService);
  readonly theme = inject(ThemeService);

  @ViewChild(OutgoingTodosComponent) todosRef?: OutgoingTodosComponent;

  readonly currentDate = signal(todayStr());
  readonly currentContent = signal('');
  readonly allNoteDates = signal<Set<string>>(new Set());
  readonly saveStatus = signal<SaveStatus>('idle');
  readonly showSettings = signal(false);

  private readonly saveSubject = new Subject<{ date: string; content: string }>();

  constructor() {
    effect(() => {
      const date = this.currentDate();
      void this.loadNote(date);
    });

    this.saveSubject
      .pipe(
        tap(() => this.saveStatus.set('saving')),
        debounceTime(500),
        switchMap(({ date, content }) =>
          from(this.storage.writeNote(date, content)),
        ),
      )
      .subscribe(() => {
        this.saveStatus.set('saved');
        setTimeout(() => this.saveStatus.set('idle'), 1500);
        void this.refreshNotesList();
        this.todosRef?.refresh(this.currentDate(), this.currentContent());
      });
  }

  async ngOnInit(): Promise<void> {
    if (!this.storage.notesDir()) {
      await this.storage.pickFolder();
    }
    await this.refreshNotesList();
  }

  private touchStartX = 0;
  private touchStartY = 0;
  private readonly SWIPE_THRESHOLD = 80;

  onTouchStart(e: TouchEvent): void {
    this.touchStartX = e.touches[0].clientX;
    this.touchStartY = e.touches[0].clientY;
  }

  onTouchEnd(e: TouchEvent): void {
    const dx = e.changedTouches[0].clientX - this.touchStartX;
    const dy = e.changedTouches[0].clientY - this.touchStartY;
    if (Math.abs(dx) > this.SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy) * 1.5) {
      dx < 0 ? this.goNextDay() : this.goPrevDay();
    }
  }

  goNextDay(): void {
    this.navigateDay(1);
  }

  goPrevDay(): void {
    this.navigateDay(-1);
  }

  onDateSelected(date: string): void {
    this.currentDate.set(date);
  }

  onContentChange(content: string): void {
    this.currentContent.set(content);
    this.saveSubject.next({ date: this.currentDate(), content });
  }

  private navigateDay(delta: number): void {
    const d = new Date(this.currentDate() + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    this.currentDate.set(d.toISOString().slice(0, 10));
  }

  private async loadNote(date: string): Promise<void> {
    const content = await this.storage.readNote(date);
    this.currentContent.set(content);
    this.saveStatus.set('idle');
  }

  private async refreshNotesList(): Promise<void> {
    const dates = await this.storage.listNotes();
    this.allNoteDates.set(new Set(dates));
  }
}
