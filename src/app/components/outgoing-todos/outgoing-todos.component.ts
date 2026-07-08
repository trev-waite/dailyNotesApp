import {
  Component,
  HostListener,
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
  readonly todoToggled = output<void>();

  readonly todoContents = signal<Map<string, string>>(new Map());

  readonly currentLineIndented = signal(false);

  updateIndentIndicator(el: HTMLTextAreaElement): void {
    const lineStart = el.value.lastIndexOf('\n', el.selectionStart - 1) + 1;
    this.currentLineIndented.set(el.value.slice(lineStart, lineStart + 2) === '  ');
  }

  readonly todos = computed<TodoItem[]>(() => {
    const today = this.currentDate();
    const isVisible = (t: TodoItem): boolean =>
      t.date === today || (t.date < today && !t.checked);

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

  readonly editingKey = signal<string | null>(null);
  readonly editingText = signal('');

  todoKey(todo: TodoItem): string {
    return `${todo.date}:${todo.lineIndex}`;
  }

  private pendingEditTodo: TodoItem | null = null;
  private pendingSubtaskTodo: TodoItem | null = null;

  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.pendingEditTodo) void this.saveEdit(this.pendingEditTodo);
    if (this.pendingSubtaskTodo) void this.finishAddSubtask(this.pendingSubtaskTodo);
  }

  startEdit(todo: TodoItem): void {
    this.editingKey.set(this.todoKey(todo));
    this.editingText.set(todo.text);
    this.pendingEditTodo = todo;
  }

  cancelEdit(): void {
    this.editingKey.set(null);
    this.editingText.set('');
    this.pendingEditTodo = null;
  }

  async saveEdit(todo: TodoItem): Promise<void> {
    if (this.editingKey() !== this.todoKey(todo)) return;
    this.pendingEditTodo = null;
    const newText = this.editingText().trim();
    this.editingKey.set(null);
    if (!newText || newText === todo.text) return;

    const contents = new Map(this.todoContents());
    const content = contents.get(todo.date) ?? '';
    const updated = this.markdown.editTodoText(content, todo.lineIndex, newText);
    contents.set(todo.date, updated);
    this.todoContents.set(contents);
    await this.storage.writeTodos(todo.date, updated);
  }

  readonly addingSubtaskFor = signal<string | null>(null);
  readonly newSubtaskText = signal('');

  startAddSubtask(todo: TodoItem): void {
    this.addingSubtaskFor.set(this.todoKey(todo));
    this.newSubtaskText.set('');
    this.pendingSubtaskTodo = todo;
  }

  cancelAddSubtask(): void {
    this.addingSubtaskFor.set(null);
    this.newSubtaskText.set('');
    this.pendingSubtaskTodo = null;
  }

  async saveSubtask(todo: TodoItem): Promise<void> {
    const text = this.newSubtaskText().trim();
    this.newSubtaskText.set('');
    if (!text) return;

    const contents = new Map(this.todoContents());
    const lines = (contents.get(todo.date) ?? '').split('\n');
    let insertAt = todo.lineIndex + 1;
    while (insertAt < lines.length && this.markdown.isChildTodoLine(lines[insertAt])) {
      insertAt++;
    }
    lines.splice(insertAt, 0, `  - [ ] ${text}`);
    const updated = lines.join('\n');
    contents.set(todo.date, updated);
    this.todoContents.set(contents);
    await this.storage.writeTodos(todo.date, updated);
  }

  async finishAddSubtask(todo: TodoItem): Promise<void> {
    this.pendingSubtaskTodo = null;
    await this.saveSubtask(todo);
    this.addingSubtaskFor.set(null);
  }

  async deleteTodo(todo: TodoItem): Promise<void> {
    this.cancelEdit();
    if (this.addingSubtaskFor() === this.todoKey(todo)) this.cancelAddSubtask();

    const contents = new Map(this.todoContents());
    const content = contents.get(todo.date) ?? '';
    const updated = this.markdown.deleteTodoLine(content, todo.lineIndex);
    contents.set(todo.date, updated);
    this.todoContents.set(contents);
    await this.storage.writeTodos(todo.date, updated);
    this.todoToggled.emit();
  }

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
    const today = this.currentDate();
    const contents = new Map(this.todoContents());

    if (!todo.checked && todo.date < today) {
      // Checking off a carry-forward todo: move it (and its children) to today
      // so it stays visible as checked and contributes to today's progress bar,
      // mirroring the behaviour of same-day todos.
      const originalLines = (contents.get(todo.date) ?? '').split('\n');
      const linesToMove = [todo.lineIndex];
      for (let i = todo.lineIndex + 1; i < originalLines.length; i++) {
        if (this.markdown.isChildTodoLine(originalLines[i])) {
          linesToMove.push(i);
        } else {
          break;
        }
      }

      const movedLines = linesToMove.map(i => originalLines[i]);
      movedLines[0] = movedLines[0].replace('- [ ]', '- [x]');

      for (const idx of [...linesToMove].reverse()) {
        originalLines.splice(idx, 1);
      }
      const updatedOriginal = originalLines.join('\n');
      contents.set(todo.date, updatedOriginal);
      await this.storage.writeTodos(todo.date, updatedOriginal);

      const currentContent = contents.get(today) ?? '';
      const updatedCurrent = currentContent
        ? `${currentContent}\n${movedLines.join('\n')}`
        : movedLines.join('\n');
      contents.set(today, updatedCurrent);
      await this.storage.writeTodos(today, updatedCurrent);

      this.todoContents.set(contents);
      this.todoToggled.emit();
      return;
    }

    const content = contents.get(todo.date) ?? '';
    const updated = this.markdown.toggleCheckbox(content, todo.lineIndex);
    contents.set(todo.date, updated);
    this.todoContents.set(contents);
    await this.storage.writeTodos(todo.date, updated);
    this.todoToggled.emit();
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
