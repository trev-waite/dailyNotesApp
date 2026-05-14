import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnChanges,
  SimpleChanges,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MarkdownService } from '../../services/markdown.service';
import { SafeHtml } from '@angular/platform-browser';

type SaveStatus = 'idle' | 'saving' | 'saved';

type FormatMark = 'bold' | 'italic' | 'code' | 'h1' | 'h2' | 'ul';

@Component({
  selector: 'app-day-editor',
  standalone: true,
  imports: [],
  templateUrl: './day-editor.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DayEditorComponent implements AfterViewInit, OnChanges {
  private readonly MARKDOWN_SVC = inject(MarkdownService);

  readonly date = input.required<string>();
  readonly content = input.required<string>();
  readonly saveStatus = input<SaveStatus>('idle');

  readonly contentChange = output<string>();

  readonly liveEditorRef = viewChild<ElementRef<HTMLDivElement>>('liveEditor');
  readonly linkUrlInputRef = viewChild<ElementRef<HTMLInputElement>>('linkUrlInput');

  readonly ANIM_KEY = signal(0);
  readonly RENDERED_HTML = signal<SafeHtml>(this.MARKDOWN_SVC.render(''));
  readonly ACTIVE_FORMATS = signal<Set<FormatMark>>(new Set());
  readonly SHOW_LINK_POPOVER = signal(false);
  readonly LINK_TEXT = signal('');
  readonly LINK_URL = signal('');
  readonly COPY_LABEL = signal<'copy' | 'copied'>('copy');

  private isEditing = false;
  private selectionDebounce: ReturnType<typeof setTimeout> | null = null;
  private inputDebounce: ReturnType<typeof setTimeout> | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['date']) {
      this.ANIM_KEY.update(k => k + 1);
      this.isEditing = false;
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
  toggleHeading(level: 1 | 2): void {
    const div = this.liveEditorRef()?.nativeElement;
    if (!div) return;
    this.focusEditor();
    const tag = `h${level}` as 'h1' | 'h2';
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
      const otherHeading = this.getAncestorTag(div, 'h1', 'h2') as HTMLElement | null;
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

  toggleInlineCode(): void {
    this.focusEditor();
    this.toggleInlineWrap('code');
    this.syncMarkdown();
  }

  toggleBulletList(): void {
    this.focusEditor();
    document.execCommand('insertUnorderedList', false);
    this.syncMarkdown();
  }

  openLinkPopover(): void {
    const sel = window.getSelection();
    this.LINK_TEXT.set(sel?.toString().trim() ?? '');
    this.LINK_URL.set('');
    this.SHOW_LINK_POPOVER.set(true);
    setTimeout(() => this.linkUrlInputRef()?.nativeElement.focus());
  }

  closeLinkPopover(): void {
    this.SHOW_LINK_POPOVER.set(false);
  }

  insertLink(): void {
    const url = this.LINK_URL().trim();
    const text = this.LINK_TEXT().trim() || url;
    if (!url) { this.closeLinkPopover(); return; }
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
    const md = this.MARKDOWN_SVC.toMarkdown(div);
    try {
      await navigator.clipboard.writeText(md);
      this.COPY_LABEL.set('copied');
      setTimeout(() => this.COPY_LABEL.set('copy'), 2000);
    } catch {
      // Clipboard access denied — fail silently.
    }
  }

  hasFormat(mark: FormatMark): boolean {
    return this.ACTIVE_FORMATS().has(mark);
  }

  // ─── Live editor event handlers ─────────────────────────────────────────────

  onLiveInput(event: Event): void {
    this.isEditing = true;
    const div = event.target as HTMLDivElement;
    if (this.inputDebounce) clearTimeout(this.inputDebounce);
    this.inputDebounce = setTimeout(() => {
      this.contentChange.emit(this.MARKDOWN_SVC.toMarkdown(div));
    }, 150);
  }

  onLiveKeydown(event: KeyboardEvent): void {
    if (event.metaKey) {
      if (!event.altKey && !event.shiftKey) {
        if (event.key === 'b') { event.preventDefault(); this.toggleBold(); return; }
        if (event.key === 'i') { event.preventDefault(); this.toggleItalic(); return; }
        if (event.key === 'k') { event.preventDefault(); this.openLinkPopover(); return; }
      }
      if (event.altKey && !event.shiftKey) {
        if (event.key === '1') { event.preventDefault(); this.toggleHeading(1); return; }
        if (event.key === '2') { event.preventDefault(); this.toggleHeading(2); return; }
      }
      if (event.shiftKey && !event.altKey) {
        if (event.key === 'l' || event.key === 'L') { event.preventDefault(); this.toggleBulletList(); return; }
        if (event.key === 'c' || event.key === 'C') { event.preventDefault(); this.toggleInlineCode(); return; }
      }
    }

    if (event.key === 'Escape' && this.SHOW_LINK_POPOVER()) {
      this.closeLinkPopover();
      return;
    }

    if (event.key === 'Tab') {
      const div = this.liveEditorRef()?.nativeElement;
      const listItem = div ? this.getAncestorTag(div, 'li') as HTMLElement | null : null;
      if (listItem) {
        event.preventDefault();
        document.execCommand(event.shiftKey ? 'outdent' : 'indent', false);
        this.syncMarkdown();
        return;
      }
    }

    if (event.key === 'ArrowDown') {
      const div = this.liveEditorRef()?.nativeElement;
      const preEl = div ? this.getAncestorTag(div, 'pre') as HTMLElement | null : null;
      if (preEl && this.isCursorOnLastLineOfPre(preEl)) {
        event.preventDefault();
        this.breakOutOfCodeBlock(preEl);
        return;
      }
    }

    if (event.key === 'Enter') {
      const div = this.liveEditorRef()?.nativeElement;
      const headingEl = div ? this.getAncestorTag(div, 'h1', 'h2') as HTMLElement | null : null;
      const listItem  = div ? this.getAncestorTag(div, 'li') as HTMLElement | null : null;
      const preEl     = div ? this.getAncestorTag(div, 'pre') as HTMLElement | null : null;

      if (headingEl) {
        event.preventDefault();
        this.breakOutOfHeading(headingEl, div!);
      } else if (listItem) {
        setTimeout(() => this.syncMarkdown());
      } else if (preEl) {
        event.preventDefault();
        this.insertNewlineInPre();
      } else {
        event.preventDefault();
        document.execCommand('insertLineBreak');
      }
      return;
    }
  }

  onLiveBlur(): void {
    if (!this.isEditing) return;
    // Cancel any pending debounced emit and flush immediately.
    if (this.inputDebounce) { clearTimeout(this.inputDebounce); this.inputDebounce = null; }
    const div = this.liveEditorRef()?.nativeElement;
    if (!div) return;
    this.contentChange.emit(this.MARKDOWN_SVC.toMarkdown(div));
    this.isEditing = false;
    setTimeout(() => this.updateLiveEditor());
  }

  @HostListener('document:mousedown', ['$event'])
  onDocumentMousedown(event: MouseEvent): void {
    if (this.SHOW_LINK_POPOVER()) {
      const target = event.target as HTMLElement;
      if (!target.closest('.link-popover-container')) this.closeLinkPopover();
    }
  }

  // ─── Slash commands ─────────────────────────────────────────────────────────

  // ─── Private helpers ────────────────────────────────────────────────────────

  private updateLiveEditor(): void {
    this.RENDERED_HTML.set(this.MARKDOWN_SVC.render(this.content()));
  }

  /**
   * Walk up from the current cursor position and collect active format tags.
   * Only runs when the selection is inside the contenteditable editor.
   */
  private updateActiveFormats(): void {
    const div = this.liveEditorRef()?.nativeElement;
    if (!div) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) { this.ACTIVE_FORMATS.set(new Set()); return; }
    const node = sel.getRangeAt(0).startContainer;
    if (!div.contains(node)) { this.ACTIVE_FORMATS.set(new Set()); return; }

    const marks = new Set<FormatMark>();
    let current: Node | null = node;
    while (current && current !== div) {
      if (current.nodeType === Node.ELEMENT_NODE) {
        switch ((current as HTMLElement).tagName.toLowerCase()) {
          case 'strong': case 'b': marks.add('bold'); break;
          case 'em':     case 'i': marks.add('italic'); break;
          case 'code':   marks.add('code'); break;
          case 'h1':     marks.add('h1'); break;
          case 'h2':     marks.add('h2'); break;
          case 'ul':     marks.add('ul'); break;
        }
      }
      current = current.parentNode;
    }
    this.ACTIVE_FORMATS.set(marks);
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

  private syncMarkdown(): void {
    this.isEditing = true;
    const div = this.liveEditorRef()?.nativeElement;
    if (!div) return;
    this.contentChange.emit(this.MARKDOWN_SVC.toMarkdown(div));
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
    this.contentChange.emit(this.MARKDOWN_SVC.toMarkdown(div));
  }
}
