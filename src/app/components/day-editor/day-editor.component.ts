import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnChanges,
  SimpleChanges,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MarkdownService } from '../../services/markdown.service';
import { SlashCommandService } from '../../services/slash-command.service';
import { SlashCommand } from '../../models/types';
import { SafeHtml } from '@angular/platform-browser';

type SaveStatus = 'idle' | 'saving' | 'saved';

/** Toolbar format identifiers used for active-state highlighting. */
type FormatMark = 'bold' | 'italic' | 'strikethrough' | 'code'
  | 'h1' | 'h2' | 'h3' | 'blockquote' | 'ul' | 'ol' | 'pre';

@Component({
  selector: 'app-day-editor',
  standalone: true,
  imports: [],
  templateUrl: './day-editor.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DayEditorComponent implements AfterViewInit, OnChanges {
  private readonly markdownSvc = inject(MarkdownService);
  private readonly slashSvc = inject(SlashCommandService);

  readonly date = input.required<string>();
  readonly content = input.required<string>();
  readonly saveStatus = input<SaveStatus>('idle');

  readonly contentChange = output<string>();

  readonly liveEditorRef = viewChild<ElementRef<HTMLDivElement>>('liveEditor');
  readonly linkUrlInputRef = viewChild<ElementRef<HTMLInputElement>>('linkUrlInput');

  readonly animKey = signal(0);
  readonly renderedHtml = signal<SafeHtml>(this.markdownSvc.render(''));

  // ─── Slash command state ────────────────────────────────────────────────────
  readonly slashActive = signal(false);
  readonly slashQuery = signal('');
  readonly slashIndex = signal(0);
  readonly slashCommands = computed(() => this.slashSvc.filter(this.slashQuery()));
  readonly slashPopupPos = signal<{ top: number; left: number } | null>(null);

  // ─── Toolbar state ──────────────────────────────────────────────────────────
  readonly activeFormats = signal<Set<FormatMark>>(new Set());
  readonly showMakeTodo = signal(false);
  readonly showLinkPopover = signal(false);
  readonly linkText = signal('');
  readonly linkUrl = signal('');
  readonly copyLabel = signal<'copy' | 'copied'>('copy');

  // ─── Private state ──────────────────────────────────────────────────────────
  private slashStart = -1;
  private slashTextOffset = -1;
  /** Prevents external content changes from overwriting the editor while typing. */
  private isEditing = false;
  private selectionDebounce: ReturnType<typeof setTimeout> | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['date']) {
      this.animKey.update(k => k + 1);
      this.isEditing = false;
      setTimeout(() => this.updateLiveEditor());
    }
    if (changes['content'] && !this.isEditing) {
      setTimeout(() => this.updateLiveEditor());
    }
  }

  ngAfterViewInit(): void {
    this.updateLiveEditor();
    // Track selection changes to update toolbar active-state indicators.
    // Debounced at ~50 ms to avoid flooding on rapid caret movement.
    document.addEventListener('selectionchange', () => {
      if (this.selectionDebounce) clearTimeout(this.selectionDebounce);
      this.selectionDebounce = setTimeout(() => this.updateActiveFormats(), 50);
    });
  }

  // ─── Toolbar actions ────────────────────────────────────────────────────────

  /**
   * Toggle a block-level heading (h1–h3).
   * If the cursor is already in this heading level, unwrap it back to a paragraph.
   */
  toggleHeading(level: 1 | 2 | 3): void {
    const div = this.liveEditorRef()?.nativeElement;
    if (!div) return;
    this.focusEditor();
    const tag = `h${level}` as 'h1' | 'h2' | 'h3';
    const headingEl = this.getAncestorTag(div, tag) as HTMLElement | null;
    if (headingEl) {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        // Collapsed cursor inside this heading — break out to a new paragraph
        // below rather than converting the current heading text to plain text.
        this.breakOutOfHeading(headingEl, div);
      } else {
        // Text is selected — toggle the heading off (convert block to paragraph).
        const p = document.createElement('p');
        p.innerHTML = headingEl.innerHTML;
        headingEl.replaceWith(p);
        this.placeCursorInNode(p, 0);
        this.syncMarkdown();
      }
    } else {
      const otherHeading = this.getAncestorTag(div, 'h1', 'h2', 'h3') as HTMLElement | null;
      if (otherHeading) {
        const newH = document.createElement(tag);
        newH.innerHTML = otherHeading.innerHTML;
        otherHeading.replaceWith(newH);
        this.placeCursorInNode(newH, 0);
      } else {
        document.execCommand('formatBlock', false, tag);
      }
      this.syncMarkdown();
    }
  }

  toggleBold(): void {
    this.focusEditor();
    this.toggleInlineWrap('strong');
    this.syncMarkdown();
  }

  toggleItalic(): void {
    this.focusEditor();
    this.toggleInlineWrap('em');
    this.syncMarkdown();
  }

  toggleStrikethrough(): void {
    this.focusEditor();
    this.toggleInlineWrap('del');
    this.syncMarkdown();
  }

  toggleInlineCode(): void {
    this.focusEditor();
    this.toggleInlineWrap('code');
    this.syncMarkdown();
  }

  insertCodeBlock(): void {
    const div = this.liveEditorRef()?.nativeElement;
    if (!div) return;
    this.focusEditor();
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = '\n';
    pre.appendChild(code);
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(pre);
      const innerRange = document.createRange();
      innerRange.setStart(code, 0);
      innerRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(innerRange);
    } else {
      div.appendChild(pre);
    }
    this.syncMarkdown();
  }

  toggleBulletList(): void {
    this.focusEditor();
    document.execCommand('insertUnorderedList', false);
    this.syncMarkdown();
  }

  toggleOrderedList(): void {
    this.focusEditor();
    document.execCommand('insertOrderedList', false);
    this.syncMarkdown();
  }

  insertTodo(): void {
    const div = this.liveEditorRef()?.nativeElement;
    if (!div) return;
    this.focusEditor();
    // Mirrors the structure that marked produces for `- [ ] text`.
    const ul = document.createElement('ul');
    const li = document.createElement('li');
    li.className = 'task-item';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.disabled = true;
    cb.className = 'task-checkbox';
    const textNode = document.createTextNode('\u00A0');
    li.appendChild(cb);
    li.appendChild(textNode);
    ul.appendChild(li);
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(ul);
      const r = document.createRange();
      r.setStartAfter(cb);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    } else {
      div.appendChild(ul);
    }
    this.syncMarkdown();
  }

  toggleBlockquote(): void {
    const div = this.liveEditorRef()?.nativeElement;
    if (!div) return;
    this.focusEditor();
    const existing = this.getAncestorTag(div, 'blockquote') as HTMLElement | null;
    if (existing) {
      const parent = existing.parentNode!;
      while (existing.firstChild) parent.insertBefore(existing.firstChild, existing);
      parent.removeChild(existing);
    } else {
      document.execCommand('formatBlock', false, 'blockquote');
    }
    this.syncMarkdown();
  }

  /** Open the link popover, pre-filling text from any current selection. */
  openLinkPopover(): void {
    const sel = window.getSelection();
    this.linkText.set(sel?.toString().trim() ?? '');
    this.linkUrl.set('');
    this.showLinkPopover.set(true);
    setTimeout(() => this.linkUrlInputRef()?.nativeElement.focus());
  }

  closeLinkPopover(): void {
    this.showLinkPopover.set(false);
  }

  insertLink(): void {
    const url = this.linkUrl().trim();
    const text = this.linkText().trim() || url;
    if (!url) { this.closeLinkPopover(); return; }
    // Security: reject dangerous URL schemes.
    const lower = url.toLowerCase();
    if (lower.startsWith('javascript:') || lower.startsWith('data:')) {
      this.closeLinkPopover();
      return;
    }
    this.focusEditor();
    // Build anchor as a DOM node — never assign raw user input to innerHTML.
    const a = document.createElement('a');
    a.href = url;
    a.textContent = text;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(a);
      const r = document.createRange();
      r.setStartAfter(a);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    } else {
      this.liveEditorRef()?.nativeElement.appendChild(a);
    }
    this.syncMarkdown();
    this.closeLinkPopover();
  }

  async copyAsMarkdown(): Promise<void> {
    const div = this.liveEditorRef()?.nativeElement;
    if (!div) return;
    const md = this.markdownSvc.toMarkdown(div);
    try {
      await navigator.clipboard.writeText(md);
      this.copyLabel.set('copied');
      setTimeout(() => this.copyLabel.set('copy'), 2000);
    } catch {
      // Clipboard access denied — fail silently.
    }
  }

  makeTodo(): void {
    const sel = window.getSelection();
    if (!sel || sel.toString().trim().length === 0) return;
    const selected = sel.toString().trim();
    const div = this.liveEditorRef()?.nativeElement;
    if (!div) return;
    const markdown = this.markdownSvc.toMarkdown(div);
    this.contentChange.emit(`${markdown}\n- [ ] ${selected}`);
    this.showMakeTodo.set(false);
    this.isEditing = false;
    setTimeout(() => this.updateLiveEditor());
  }

  /** Exposed to template for toolbar active-state checks. */
  hasFormat(mark: FormatMark): boolean {
    return this.activeFormats().has(mark);
  }

  // ─── Live editor event handlers ─────────────────────────────────────────────

  onLiveInput(event: Event): void {
    this.isEditing = true;
    const div = event.target as HTMLDivElement;
    const markdown = this.markdownSvc.toMarkdown(div);
    this.contentChange.emit(markdown);
    this.detectSlashInLive(div);
    this.showMakeTodo.set(false);
  }

  onLiveKeydown(event: KeyboardEvent): void {
    if (this.slashActive()) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.slashIndex.update(i => Math.min(i + 1, this.slashCommands().length - 1));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.slashIndex.update(i => Math.max(i - 1, 0));
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
    if (event.key === 'Escape' && this.showLinkPopover()) {
      this.closeLinkPopover();
      return;
    }
    if (event.key === 'ArrowDown' && !this.slashActive()) {
      const div = this.liveEditorRef()?.nativeElement;
      const preEl = div ? this.getAncestorTag(div, 'pre') as HTMLElement | null : null;
      if (preEl && this.isCursorOnLastLineOfPre(preEl)) {
        event.preventDefault();
        this.breakOutOfCodeBlock(preEl);
        return;
      }
    }

    if (event.key === 'Enter') {
      this.showMakeTodo.set(false);
      const div = this.liveEditorRef()?.nativeElement;
      const headingEl = div ? this.getAncestorTag(div, 'h1', 'h2', 'h3') as HTMLElement | null : null;
      const listItem  = div ? this.getAncestorTag(div, 'li') as HTMLElement | null : null;
      const preEl     = div ? this.getAncestorTag(div, 'pre') as HTMLElement | null : null;

      if (headingEl) {
        event.preventDefault();
        this.breakOutOfHeading(headingEl, div!);
      } else if (listItem) {
        // Let the browser create the new <li> naturally.
        // Sync markdown after the browser has processed the keystroke.
        setTimeout(() => this.syncMarkdown());
      } else if (preEl) {
        // Browser default creates a new block element — intercept and insert \n instead.
        event.preventDefault();
        this.insertNewlineInPre();
      } else {
        event.preventDefault();
        document.execCommand('insertLineBreak');
      }
      return;
    }
    this.showMakeTodo.set(false);
  }

  onLiveMouseup(): void {
    const sel = window.getSelection();
    this.showMakeTodo.set(!!(sel && sel.toString().trim().length > 0));
  }

  onLiveBlur(): void {
    if (!this.isEditing) return;
    const div = this.liveEditorRef()?.nativeElement;
    if (!div) return;
    const markdown = this.markdownSvc.toMarkdown(div);
    this.contentChange.emit(markdown);
    this.isEditing = false;
    setTimeout(() => this.updateLiveEditor());
  }

  @HostListener('document:mousedown', ['$event'])
  onDocumentMousedown(event: MouseEvent): void {
    if (this.slashActive()) this.dismissSlash();
    if (this.showLinkPopover()) {
      const target = event.target as HTMLElement;
      if (!target.closest('.link-popover')) this.closeLinkPopover();
    }
  }

  // ─── Slash commands ─────────────────────────────────────────────────────────

  selectSlashCommand(cmd: SlashCommand | undefined): void {
    if (!cmd) return;
    const div = this.liveEditorRef()?.nativeElement;
    if (!div) return;

    const markdown = this.markdownSvc.toMarkdown(div);
    const slashStr = '/' + this.slashQuery();
    const before = markdown.substring(0, this.slashStart);
    const after = markdown.substring(this.slashStart + slashStr.length);
    const newMarkdown = before + cmd.snippet + after;
    const savedTextOffset = this.slashTextOffset;

    this.contentChange.emit(newMarkdown);
    this.dismissSlash();

    setTimeout(() => {
      this.renderedHtml.set(this.markdownSvc.render(newMarkdown));
      this.isEditing = false;
      this.placeCursorAfterSnippet(div, cmd, savedTextOffset);
      div.focus();
    });
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private updateLiveEditor(): void {
    this.renderedHtml.set(this.markdownSvc.render(this.content()));
  }

  /**
   * Walk up from the current cursor position and collect active format tags.
   * Only runs when the selection is inside the contenteditable editor.
   */
  private updateActiveFormats(): void {
    const div = this.liveEditorRef()?.nativeElement;
    if (!div) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) { this.activeFormats.set(new Set()); return; }
    const node = sel.getRangeAt(0).startContainer;
    if (!div.contains(node)) { this.activeFormats.set(new Set()); return; }

    const marks = new Set<FormatMark>();
    let current: Node | null = node;
    while (current && current !== div) {
      if (current.nodeType === Node.ELEMENT_NODE) {
        switch ((current as HTMLElement).tagName.toLowerCase()) {
          case 'strong': case 'b': marks.add('bold'); break;
          case 'em':     case 'i': marks.add('italic'); break;
          case 'del':    case 's': case 'strike': marks.add('strikethrough'); break;
          case 'code':   marks.add('code'); break;
          case 'pre':    marks.add('pre'); break;
          case 'h1':     marks.add('h1'); break;
          case 'h2':     marks.add('h2'); break;
          case 'h3':     marks.add('h3'); break;
          case 'blockquote': marks.add('blockquote'); break;
          case 'ul':     marks.add('ul'); break;
          case 'ol':     marks.add('ol'); break;
        }
      }
      current = current.parentNode;
    }
    this.activeFormats.set(marks);
  }

  /**
   * Wrap the current selection in `tagName`, or unwrap if already wrapped.
   * Works for inline elements: strong, em, del, code.
   *
   * Collapsed cursor (no selection): uses execCommand to toggle the browser's
   * internal typing format, which correctly splits existing nodes at the cursor
   * without blowing away surrounding formatted text.
   */
  private toggleInlineWrap(tagName: string): void {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);

    if (range.collapsed) {
      // No text selected — toggle the "next typed characters" format state.
      // execCommand handles splitting existing <strong>/<em> at the cursor.
      const cmd = tagName === 'strong' ? 'bold'
        : tagName === 'em'  ? 'italic'
        : tagName === 'del' ? 'strikeThrough'
        : null;
      if (cmd) document.execCommand(cmd, false);
      // 'code' has no execCommand equivalent; do nothing for cursor-only case.
      return;
    }

    // Selection exists — DOM wrap/unwrap.
    const ancestor = range.commonAncestorContainer;
    const existingEl = (ancestor.nodeType === Node.ELEMENT_NODE
      ? ancestor as HTMLElement
      : ancestor.parentElement)?.closest(tagName) as HTMLElement | null;

    if (existingEl) {
      const parent = existingEl.parentNode!;
      const frag = document.createDocumentFragment();
      while (existingEl.firstChild) frag.appendChild(existingEl.firstChild);
      parent.insertBefore(frag, existingEl);
      parent.removeChild(existingEl);
    } else {
      const el = document.createElement(tagName);
      try {
        range.surroundContents(el);
      } catch {
        el.appendChild(range.extractContents());
        range.insertNode(el);
      }
      const newRange = document.createRange();
      newRange.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(newRange);
    }
  }

  /**
   * Insert a literal newline inside a <pre> block without creating a new block
   * element (which is what the browser does by default on Enter in contenteditable).
   */
  private insertNewlineInPre(): void {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const nl = document.createTextNode('\n');
    range.insertNode(nl);
    // Place cursor after the inserted newline.
    const r = document.createRange();
    r.setStartAfter(nl);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    this.syncMarkdown();
  }

  /**
   * Returns true when the cursor is on the last line of a <pre> block —
   * used to decide whether Down arrow should escape the block.
   */
  private isCursorOnLastLineOfPre(preEl: HTMLElement): boolean {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0);
    // Collect the text content of the <code> inside the <pre> (or the <pre> itself).
    const codeEl = preEl.querySelector('code') ?? preEl;
    const fullText = codeEl.textContent ?? '';
    // Build a range from the cursor to the end of the code element.
    const tailRange = document.createRange();
    try {
      tailRange.setStart(range.endContainer, range.endOffset);
      tailRange.setEnd(codeEl, codeEl.childNodes.length);
    } catch {
      return true;
    }
    const textAfter = tailRange.toString();
    // If there's no newline after the cursor, we're on the last line.
    return !textAfter.includes('\n') || fullText.trim() === '';
  }

  /** Move cursor out of a <pre> block (Down arrow on last line). */
  private breakOutOfCodeBlock(preEl: HTMLElement): void {
    const p = document.createElement('p');
    p.appendChild(document.createElement('br'));
    preEl.after(p);
    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.setStart(p, 0);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    this.syncMarkdown();
  }

  /** Emit markdown from current editor DOM and mark as editing. */
  private syncMarkdown(): void {
    this.isEditing = true;
    const div = this.liveEditorRef()?.nativeElement;
    if (!div) return;
    this.contentChange.emit(this.markdownSvc.toMarkdown(div));
    this.updateActiveFormats();
  }

  private focusEditor(): void {
    this.liveEditorRef()?.nativeElement.focus();
  }

  private placeCursorInNode(node: Node, offset: number): void {
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  private detectSlashInLive(div: HTMLDivElement): void {
    const textBefore = this.getTextBeforeCursor(div);
    const match = /(?:^|[\n\s])(\/([\w.-]*))$/.exec(textBefore);
    if (match) {
      const query = match[2];
      const slashStr = '/' + query;
      this.slashTextOffset = textBefore.length - match[1].length;
      const markdown = this.markdownSvc.toMarkdown(div);
      const mdIdx = markdown.lastIndexOf(slashStr);
      this.slashStart = mdIdx !== -1 ? mdIdx : this.slashTextOffset;
      this.slashQuery.set(query);
      this.slashIndex.set(0);
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        const divRect = div.getBoundingClientRect();
        this.slashPopupPos.set({
          top: rect.bottom - divRect.top + div.scrollTop + 4,
          left: Math.max(0, rect.left - divRect.left),
        });
      }
      this.slashActive.set(this.slashCommands().length > 0);
    } else {
      this.dismissSlash();
    }
  }

  private placeCursorAfterSnippet(div: HTMLElement, cmd: SlashCommand, textOffset: number): void {
    const sel = window.getSelection();
    if (!sel) return;
    const headingMatch = /^(#{1,6}) $/.exec(cmd.snippet);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headings = div.querySelectorAll(`h${level}`);
      const target = headings[headings.length - 1];
      if (target) {
        const range = document.createRange();
        range.setStart(target, 0);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
    }
    const cursorTextOffset = cmd.selectRange
      ? textOffset + cmd.selectRange[0]
      : textOffset + cmd.snippet.replace(/\n/g, '').length;
    this.setCursorAtTextOffset(div, cursorTextOffset);
  }

  private getTextBeforeCursor(div: HTMLElement): string {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return '';
    const range = document.createRange();
    range.selectNodeContents(div);
    range.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
    return range.toString();
  }

  private setCursorAtTextOffset(div: HTMLElement, offset: number): void {
    const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT);
    let remaining = offset;
    let targetNode: Node = div;
    let targetOffset = 0;
    let node: Node | null;
    while ((node = walker.nextNode()) !== null) {
      const len = node.textContent?.length ?? 0;
      if (remaining <= len) { targetNode = node; targetOffset = remaining; break; }
      remaining -= len;
      targetNode = node;
      targetOffset = node.textContent?.length ?? 0;
    }
    try {
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        range.setStart(targetNode, targetOffset);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } catch { /* node may no longer be in DOM */ }
  }

  private dismissSlash(): void {
    this.slashActive.set(false);
    this.slashQuery.set('');
    this.slashPopupPos.set(null);
    this.slashStart = -1;
    this.slashTextOffset = -1;
  }

  /**
   * Return the first ancestor element matching any of the provided tag names,
   * walking up from the cursor to `boundary`.
   */
  private getAncestorTag(boundary: HTMLElement, ...tags: string[]): Element | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const tagSet = new Set(tags.map(t => t.toUpperCase()));
    let node: Node | null = sel.getRangeAt(0).startContainer;
    while (node && node !== boundary) {
      if (node.nodeType === Node.ELEMENT_NODE && tagSet.has((node as HTMLElement).tagName)) {
        return node as HTMLElement;
      }
      node = node.parentNode;
    }
    return null;
  }

  private breakOutOfHeading(headingEl: HTMLElement, div: HTMLElement): void {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    // Capture and remove any text after the cursor inside the heading.
    const tailRange = document.createRange();
    tailRange.setStart(range.startContainer, range.startOffset);
    tailRange.setEnd(headingEl, headingEl.childNodes.length);
    const tailText = tailRange.toString();
    tailRange.deleteContents();
    // Insert a <p> after the heading. A bare <br> after a block element with
    // Tailwind prose margin-bottom creates a visible double-gap — <p> avoids it.
    const p = document.createElement('p');
    const newRange = document.createRange();
    if (tailText) {
      const textNode = document.createTextNode(tailText);
      p.appendChild(textNode);
      headingEl.after(p);
      newRange.setStart(textNode, 0);
    } else {
      // Use a <br> placeholder — browsers require it to treat an empty <p> as
      // a real editable block boundary and render the cursor at normal size.
      const br = document.createElement('br');
      p.appendChild(br);
      headingEl.after(p);
      newRange.setStartBefore(br);
    }
    sel.removeAllRanges();
    sel.addRange(newRange);
    this.isEditing = true;
    this.contentChange.emit(this.markdownSvc.toMarkdown(div));
  }
}
