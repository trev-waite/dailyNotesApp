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
import { HistoryTimelineComponent } from './components/history-timeline/history-timeline.component';
import { SearchPanelComponent } from './components/search-panel/search-panel.component';

type SaveStatus = 'idle' | 'saving' | 'saved';
type ActiveView = 'editor' | 'calendar' | 'timeline' | 'search';

const CALENDAR_ALWAYS_VISIBLE_KEY = 'calendarAlwaysVisible';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CalendarNavComponent,
    DayEditorComponent,
    OutgoingTodosComponent,
    SettingsComponent,
    HistoryTimelineComponent,
    SearchPanelComponent,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements OnInit {
  private readonly storage = inject(NoteStorageService);
  readonly theme = inject(ThemeService);

  @ViewChild(OutgoingTodosComponent) todosRef?: OutgoingTodosComponent;

  readonly currentDate = signal(todayString());
  readonly todayString = todayString;
  readonly currentContent = signal('');
  readonly allNoteDates = signal<Set<string>>(new Set());
  readonly allTodoDates = signal<Set<string>>(new Set());
  readonly saveStatus = signal<SaveStatus>('idle');
  readonly showSettings = signal(false);
  readonly activeView = signal<ActiveView>('editor');
  readonly previousView = signal<'calendar' | null>(null);
  readonly previewDate = signal<string | null>(null);
  readonly previewContent = signal<string>('');
  readonly previewTodoItems = signal<{ text: string; checked: boolean }[]>([]);
  readonly previewLoading = signal<boolean>(false);
  readonly calendarAlwaysVisible = signal<boolean>(
    localStorage.getItem(CALENDAR_ALWAYS_VISIBLE_KEY) === 'true',
  );
  readonly todosPanelHeight = signal(220);
  readonly sidebarWidth = signal(208);
  readonly sidebarIconOnly = computed(() => this.sidebarWidth() < 100);
  private sidebarPrevWidth = 208;

  toggleSidebar(): void {
    if (this.sidebarIconOnly()) {
      this.sidebarWidth.set(this.sidebarPrevWidth);
    } else {
      this.sidebarPrevWidth = this.sidebarWidth();
      this.sidebarWidth.set(48);
    }
  }

  readonly formattedDate = computed(() => {
    const [y, m, d] = this.currentDate().split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  });

  readonly formattedPreviewDate = computed(() => {
    const date = this.previewDate();
    if (!date) return '';
    const [y, m, d] = date.split('-').map(Number);
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

  private sidebarDragStartX = 0;
  private sidebarDragStartWidth = 0;
  private readonly onSidebarMouseMove = (e: MouseEvent) => {
    const delta = e.clientX - this.sidebarDragStartX;
    const newWidth = Math.min(208, Math.max(48, this.sidebarDragStartWidth + delta));
    this.sidebarWidth.set(newWidth);
  };
  private readonly onSidebarMouseUp = () => {
    document.removeEventListener('mousemove', this.onSidebarMouseMove);
    document.removeEventListener('mouseup', this.onSidebarMouseUp);
    document.documentElement.classList.remove('is-resizing');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  startSidebarResize(e: MouseEvent): void {
    this.sidebarDragStartX = e.clientX;
    this.sidebarDragStartWidth = this.sidebarWidth();
    this.sidebarPrevWidth = this.sidebarWidth();
    document.documentElement.classList.add('is-resizing');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', this.onSidebarMouseMove);
    document.addEventListener('mouseup', this.onSidebarMouseUp);
  }

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

  goToToday(): void {
    this.currentDate.set(todayString());
    this.activeView.set('editor');
    this.previousView.set(null);
  }

  onCalendarDateSelected(date: string): void {
    this.currentDate.set(date);
    this.previousView.set('calendar');
    this.activeView.set('editor');
  }

  onCalendarPreviewDate(date: string): void {
    if (this.previewDate() === date) {
      this.currentDate.set(date);
      this.previousView.set('calendar');
      this.activeView.set('editor');
      return;
    }
    this.previewDate.set(date);
    this.previewContent.set('');
    this.previewTodoItems.set([]);
    this.previewLoading.set(true);
    void Promise.all([
      this.storage.readNote(date),
      this.storage.readTodos(date),
    ]).then(([content, todosRaw]) => {
      if (this.previewDate() !== date) return;
      this.previewContent.set(content);
      this.previewTodoItems.set(this.parseTodos(todosRaw));
      this.previewLoading.set(false);
    });
  }

  closePreview(): void {
    this.previewDate.set(null);
    this.previewContent.set('');
    this.previewTodoItems.set([]);
  }

  private parseTodos(raw: string): { text: string; checked: boolean }[] {
    return raw
      .split('\n')
      .filter(line => /^- \[.\]/.test(line))
      .map(line => ({
        checked: line.startsWith('- [x]') || line.startsWith('- [X]'),
        text: line.replace(/^- \[.\]\s*/, ''),
      }));
  }

  openPreviewInEditor(): void {
    const date = this.previewDate();
    if (!date) return;
    this.currentDate.set(date);
    this.previousView.set('calendar');
    this.activeView.set('editor');
  }

  onViewDateSelected(date: string): void {
    this.currentDate.set(date);
    this.previousView.set(null);
    this.activeView.set('editor');
  }

  onCalendarAlwaysVisibleChange(value: boolean): void {
    this.calendarAlwaysVisible.set(value);
    localStorage.setItem(CALENDAR_ALWAYS_VISIBLE_KEY, String(value));
    if (value && this.activeView() === 'calendar') {
      this.activeView.set('editor');
    }
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

