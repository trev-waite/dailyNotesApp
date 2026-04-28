import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  OnChanges,
  SimpleChanges,
  ViewChild,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MarkdownService } from '../../services/markdown.service';
import { SlashCommandService } from '../../services/slash-command.service';
import { SlashCommand } from '../../models/types';
import { SafeHtml } from '@angular/platform-browser';

type Tab = 'edit' | 'preview';
type SaveStatus = 'idle' | 'saving' | 'saved';

@Component({
  selector: 'app-day-editor',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './day-editor.component.html',
})
export class DayEditorComponent implements AfterViewInit, OnChanges {
  private readonly markdownSvc = inject(MarkdownService);
  private readonly slashSvc = inject(SlashCommandService);

  readonly date = input.required<string>();
  readonly content = input.required<string>();
  readonly saveStatus = input<SaveStatus>('idle');

  readonly contentChange = output<string>();

  @ViewChild('textarea') textareaRef!: ElementRef<HTMLTextAreaElement>;

  readonly activeTab = signal<Tab>('edit');
  readonly rendered = computed<SafeHtml>(() => this.markdownSvc.render(this.content()));

  // --- Slash command state ---
  readonly slashActive = signal(false);
  readonly slashQuery = signal('');
  readonly slashIndex = signal(0);
  readonly slashCommands = computed(() =>
    this.slashSvc.filter(this.slashQuery()),
  );

  // --- Make Todo state ---
  readonly showMakeTodo = signal(false);

  // Internal: track slash token start position
  private slashStart = -1;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['content']) {
      // When content changes externally (day switch), resize textarea
      setTimeout(() => this.autoResize());
    }
  }

  ngAfterViewInit(): void {
    this.autoResize();
  }

  setTab(tab: Tab): void {
    this.activeTab.set(tab);
    this.dismissSlash();
    this.showMakeTodo.set(false);
    if (tab === 'edit') {
      setTimeout(() => {
        this.textareaRef?.nativeElement.focus();
        this.autoResize();
      });
    }
  }

  onInput(event: Event): void {
    const ta = event.target as HTMLTextAreaElement;
    this.contentChange.emit(ta.value);
    this.autoResize();
    this.detectSlashCommand(ta);
    this.showMakeTodo.set(false);
  }

  onKeydown(event: KeyboardEvent): void {
    if (this.slashActive()) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.slashIndex.update((i) =>
          Math.min(i + 1, this.slashCommands().length - 1),
        );
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.slashIndex.update((i) => Math.max(i - 1, 0));
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        this.selectSlashCommand(this.slashCommands()[this.slashIndex()]);
        return;
      }
      if (event.key === 'Escape') {
        this.dismissSlash();
        return;
      }
    }
    this.showMakeTodo.set(false);
  }

  onMouseup(): void {
    const ta = this.textareaRef?.nativeElement;
    if (!ta) return;
    setTimeout(() => {
      if (ta.selectionStart !== ta.selectionEnd) {
        this.showMakeTodo.set(true);
      } else {
        this.showMakeTodo.set(false);
      }
    });
  }

  @HostListener('document:mousedown', ['$event'])
  onDocumentMousedown(event: MouseEvent): void {
    // Hide slash palette if click is outside
    if (this.slashActive()) {
      this.dismissSlash();
    }
  }

  makeTodo(): void {
    const ta = this.textareaRef?.nativeElement;
    if (!ta) return;
    const { selectionStart, selectionEnd, value } = ta;
    if (selectionStart === selectionEnd) return;

    const selected = value.substring(selectionStart, selectionEnd);
    // Find end of line containing selectionEnd
    const lineEnd = value.indexOf('\n', selectionEnd);
    const insertAt = lineEnd === -1 ? value.length : lineEnd;

    const before = value.substring(0, insertAt);
    const after = value.substring(insertAt);
    const newContent = `${before}\n- [ ] ${selected}${after}`;

    this.contentChange.emit(newContent);
    this.showMakeTodo.set(false);

    setTimeout(() => {
      ta.value = newContent;
      this.autoResize();
    });
  }

  selectSlashCommand(cmd: SlashCommand | undefined): void {
    if (!cmd) return;
    const ta = this.textareaRef?.nativeElement;
    if (!ta) return;

    const value = ta.value;
    const caretPos = ta.selectionStart;
    // Replace from slashStart to caretPos with snippet
    const before = value.substring(0, this.slashStart);
    const after = value.substring(caretPos);
    const newContent = before + cmd.snippet + after;

    this.contentChange.emit(newContent);
    this.dismissSlash();

    setTimeout(() => {
      ta.value = newContent;
      if (cmd.selectRange) {
        const [start, end] = cmd.selectRange;
        ta.setSelectionRange(this.slashStart + start, this.slashStart + end);
      } else {
        const pos = this.slashStart + cmd.snippet.length;
        ta.setSelectionRange(pos, pos);
      }
      ta.focus();
      this.autoResize();
    });
  }

  private detectSlashCommand(ta: HTMLTextAreaElement): void {
    const pos = ta.selectionStart;
    const text = ta.value.substring(0, pos);

    // Look backward for '/' not preceded by non-whitespace
    const match = /(?:^|[\n\s])(\/(\w*))$/.exec(text);
    if (match) {
      // slashStart is the absolute index of '/' in the full value
      this.slashStart = pos - match[1].length;
      this.slashQuery.set(match[2]);
      this.slashIndex.set(0);
      this.slashActive.set(this.slashCommands().length > 0);
    } else {
      this.dismissSlash();
    }
  }

  private dismissSlash(): void {
    this.slashActive.set(false);
    this.slashQuery.set('');
    this.slashStart = -1;
  }

  private autoResize(): void {
    const ta = this.textareaRef?.nativeElement;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }
}
