import {
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { NoteStorageService } from '../../services/note-storage.service';
import { MarkdownService } from '../../services/markdown.service';
import { TodoItem } from '../../models/types';

@Component({
  selector: 'app-outgoing-todos',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './outgoing-todos.component.html',
})
export class OutgoingTodosComponent implements OnInit {
  private readonly storage = inject(NoteStorageService);
  private readonly markdown = inject(MarkdownService);

  /** Map of date → raw content, loaded once and updated on toggle */
  private readonly noteContents = signal<Map<string, string>>(new Map());

  readonly todos = computed<TodoItem[]>(() => {
    const result: TodoItem[] = [];
    this.noteContents().forEach((content, date) => {
      result.push(...this.markdown.extractTodos(date, content));
    });
    return result.sort((a, b) => a.date.localeCompare(b.date));
  });

  readonly checkedCount = computed(() => this.todos().filter((t) => t.checked).length);
  readonly totalCount = computed(() => this.todos().length);

  isCollapsed = signal(false);

  async ngOnInit(): Promise<void> {
    await this.loadAll();
  }

  async loadAll(): Promise<void> {
    const dates = await this.storage.listNotes();
    const map = new Map<string, string>();
    await Promise.all(
      dates.map(async (date) => {
        const content = await this.storage.readNote(date);
        map.set(date, content);
      }),
    );
    this.noteContents.set(map);
  }

  async toggleTodo(todo: TodoItem): Promise<void> {
    const contents = new Map(this.noteContents());
    const content = contents.get(todo.date) ?? '';
    const updated = this.markdown.toggleCheckbox(content, todo.lineIndex);
    contents.set(todo.date, updated);
    this.noteContents.set(contents);
    await this.storage.writeNote(todo.date, updated);
  }

  toggleCollapse(): void {
    this.isCollapsed.update((v) => !v);
  }

  /** Reload after external changes (called by AppComponent after saves) */
  async refresh(date: string, content: string): Promise<void> {
    const contents = new Map(this.noteContents());
    contents.set(date, content);
    this.noteContents.set(contents);
  }
}
