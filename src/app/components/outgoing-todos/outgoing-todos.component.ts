import {
  Component,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { NoteStorageService } from '../../services/note-storage.service';
import { MarkdownService } from '../../services/markdown.service';
import { TodoItem } from '../../models/types';

@Component({
  selector: 'app-outgoing-todos',
  standalone: true,
  imports: [NgTemplateOutlet],
  templateUrl: './outgoing-todos.component.html',
})
export class OutgoingTodosComponent implements OnInit {
  private readonly storage = inject(NoteStorageService);
  private readonly markdown = inject(MarkdownService);

  readonly currentDate = input.required<string>();
  readonly todoAdded = output<void>();

  private readonly todoContents = signal<Map<string, string>>(new Map());

  readonly currentLineIndented = signal(false);

  updateIndentIndicator(el: HTMLTextAreaElement): void {
    const lineStart = el.value.lastIndexOf('\n', el.selectionStart - 1) + 1;
    this.currentLineIndented.set(el.value.slice(lineStart, lineStart + 2) === '  ');
  }

  readonly todos = computed<TodoItem[]>(() => {
    const today = this.currentDate();
    const isVisible = (t: TodoItem) =>
      t.date <= today && (!t.checked || t.date === today);

    const result: TodoItem[] = [];
    this.todoContents().forEach((content, date) => {
      for (const todo of this.markdown.extractTodos(date, content)) {
        if (!isVisible(todo)) continue;
        if (todo.children?.length) {
          todo.children = todo.children.filter(isVisible);
        }
        result.push(todo);
      }
    });
    return result.sort((a, b) => a.date.localeCompare(b.date));
  });

  readonly checkedCount = computed(() => this.todos().filter((t) => t.checked).length);
  readonly totalCount = computed(() => this.todos().length);

  async ngOnInit(): Promise<void> {
    await this.loadAll();
  }

  async loadAll(): Promise<void> {
    const dates = await this.storage.listTodoFiles();
    const map = new Map<string, string>();
    await Promise.all(
      dates.map(async (date) => {
        const content = await this.storage.readTodos(date);
        map.set(date, content);
      }),
    );
    this.todoContents.set(map);
  }

  async toggleTodo(todo: TodoItem): Promise<void> {
    const contents = new Map(this.todoContents());
    const content = contents.get(todo.date) ?? '';
    const updated = this.markdown.toggleCheckbox(content, todo.lineIndex);
    contents.set(todo.date, updated);
    this.todoContents.set(contents);
    await this.storage.writeTodos(todo.date, updated);
  }

  /** Reload after external changes (called by AppComponent after saves) */
  async refresh(date: string, content: string): Promise<void> {
    const contents = new Map(this.todoContents());
    contents.set(date, content);
    this.todoContents.set(contents);
  }

  onInputKeydown(e: KeyboardEvent): void {
    const el = e.target as HTMLTextAreaElement;
    if (e.key === 'Enter') {
      e.preventDefault();
      void this.flushTodos(el);
      return;
    }
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const { selectionStart, value } = el;
    const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
    const indented = value.slice(lineStart, lineStart + 2) === '  ';
    el.value = indented
      ? value.slice(0, lineStart) + value.slice(lineStart + 2)
      : value.slice(0, lineStart) + '  ' + value.slice(lineStart);
    const next = Math.max(lineStart, selectionStart + (indented ? -2 : 2));
    el.selectionStart = next;
    el.selectionEnd = next;
  }

  async flushTodos(el: HTMLTextAreaElement): Promise<void> {
    const lines = el.value.split('\n').filter(l => l.trim());
    if (!lines.length) return;
    const date = this.currentDate();
    const contents = new Map(this.todoContents());
    const existing = contents.get(date) ?? '';
    const newLines = lines.map(line => {
      const indented = line.startsWith('  ');
      return `${indented ? '  ' : ''}- [ ] ${line.trim()}`;
    });
    const updated = existing ? `${existing}\n${newLines.join('\n')}` : newLines.join('\n');
    contents.set(date, updated);
    this.todoContents.set(contents);
    await this.storage.writeTodos(date, updated);
    this.todoAdded.emit();
    el.value = '';
    this.currentLineIndented.set(false);
  }
}
