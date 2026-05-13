import {
  Component,
  OnInit,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, switchMap, from, tap } from 'rxjs';

import { NoteStorageService } from './services/note-storage.service';
import { ThemeService } from './services/theme.service';
import { formatDateString, todayString } from './utils/date';
import { CalendarNavComponent } from './components/calendar-nav/calendar-nav.component';
import { DayEditorComponent } from './components/day-editor/day-editor.component';
import { OutgoingTodosComponent } from './components/outgoing-todos/outgoing-todos.component';
import { SettingsComponent } from './components/settings/settings.component';

type SaveStatus = 'idle' | 'saving' | 'saved';
type Section = 'today' | 'timeline' | 'calendar' | 'search';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CalendarNavComponent, DayEditorComponent, OutgoingTodosComponent, SettingsComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements OnInit {
  private readonly storage = inject(NoteStorageService);
  readonly theme = inject(ThemeService);

  @ViewChild(OutgoingTodosComponent) todosRef?: OutgoingTodosComponent;

  readonly currentDate = signal(todayString());
  /** Exposed to the template so it can call todayString() to navigate back to today. */
  readonly todayString = todayString;
  readonly currentContent = signal('');
  readonly allNoteDates = signal<Set<string>>(new Set());
  readonly allTodoDates = signal<Set<string>>(new Set());
  readonly saveStatus = signal<SaveStatus>('idle');
  readonly showSettings = signal(false);
  readonly activeSection = signal<Section>('today');
  readonly todosPanelHeight = signal(220);

  readonly formattedDate = computed(() => {
    const [y, m, d] = this.currentDate().split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  });

  private dragStartY = 0;
  private dragStartHeight = 0;
  private readonly onMouseMove = (e: MouseEvent) => {
    const delta = e.clientY - this.dragStartY;
    this.todosPanelHeight.set(Math.max(80, this.dragStartHeight + delta));
  };
  private readonly onMouseUp = () => {
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mouseup', this.onMouseUp);
    document.documentElement.classList.remove('is-resizing');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

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
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        this.saveStatus.set('saved');
        setTimeout(() => this.saveStatus.set('idle'), 1500);
        void this.refreshNotesList();
      });
  }

  async ngOnInit(): Promise<void> {
    if (!this.storage.notesDir()) {
      await this.storage.pickFolder();
    }
    await this.refreshNotesList();
  }

  startResize(e: MouseEvent): void {
    this.dragStartY = e.clientY;
    this.dragStartHeight = this.todosPanelHeight();
    document.documentElement.classList.add('is-resizing');
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mouseup', this.onMouseUp);
  }

  navigateDay(delta: number): void {
    const [year, month, day] = this.currentDate().split('-').map(Number);
    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() + delta);
    this.currentDate.set(formatDateString(date));
  }

  onContentChange(content: string): void {
    this.currentContent.set(content);
    this.saveSubject.next({ date: this.currentDate(), content });
  }

  onTodoAdded(): void {
    void this.refreshNotesList();
  }

  private async loadNote(date: string): Promise<void> {
    const content = await this.storage.readNote(date);
    if (this.currentDate() !== date) return;
    this.currentContent.set(content);
    this.saveStatus.set('idle');
  }

  private async refreshNotesList(): Promise<void> {
    const [notes, todos] = await Promise.all([
      this.storage.listNotes(),
      this.storage.listTodoFiles(),
    ]);
    this.allNoteDates.set(new Set(notes));
    this.allTodoDates.set(new Set(todos));
  }
}

