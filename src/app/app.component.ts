import {
  Component,
  OnInit,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Subject, debounceTime, switchMap, from, tap } from 'rxjs';

import { NoteStorageService } from './services/note-storage.service';
import { ThemeService } from './services/theme.service';
import { DayEditorComponent } from './components/day-editor/day-editor.component';
import { OutgoingTodosComponent } from './components/outgoing-todos/outgoing-todos.component';
import { SettingsComponent } from './components/settings/settings.component';

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

type SaveStatus = 'idle' | 'saving' | 'saved';
type Section = 'today' | 'timeline' | 'calendar' | 'search';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [DayEditorComponent, OutgoingTodosComponent, SettingsComponent],
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

  startResize(e: MouseEvent): void {
    this.dragStartY = e.clientY;
    this.dragStartHeight = this.todosPanelHeight();
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mouseup', this.onMouseUp);
  }

  navigateDay(delta: number): void {
    const [y, m, d] = this.currentDate().split('-').map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + delta);
    this.currentDate.set(date.toISOString().slice(0, 10));
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
    this.currentContent.set(content);
    this.saveStatus.set('idle');
  }

  private async refreshNotesList(): Promise<void> {
    const dates = await this.storage.listNotes();
    this.allNoteDates.set(new Set(dates));
  }
}

