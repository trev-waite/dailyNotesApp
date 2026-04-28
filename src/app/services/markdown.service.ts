import { Injectable, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked, Renderer } from 'marked';
import DOMPurify from 'dompurify';
import { TodoItem } from '../models/types';

@Injectable({ providedIn: 'root' })
export class MarkdownService {
  private readonly sanitizer = inject(DomSanitizer);

  constructor() {
    // Configure marked with a custom renderer that preserves checkbox state
    const renderer = new Renderer();
    const originalListitem = renderer.listitem.bind(renderer);
    renderer.listitem = (item) => {
      // marked passes the raw token; handle task items
      if (item.task) {
        const checked = item.checked ? 'checked' : '';
        // Replace the default checkbox with a styled one (non-interactive in preview)
        const inner = item.text.replace(/^\[[ xX]\] /, '');
        return `<li class="task-item"><input type="checkbox" disabled ${checked} class="task-checkbox"> ${inner}</li>`;
      }
      return originalListitem(item);
    };
    marked.use({ renderer, gfm: true, breaks: true });
  }

  render(markdown: string): SafeHtml {
    const raw = marked.parse(markdown) as string;
    const clean = DOMPurify.sanitize(raw, {
      ALLOWED_TAGS: [
        'p', 'br', 'strong', 'em', 'del', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'a', 'hr', 'table',
        'thead', 'tbody', 'tr', 'th', 'td', 'input', 'details', 'summary',
      ],
      ALLOWED_ATTR: ['href', 'type', 'checked', 'disabled', 'class', 'open'],
    });
    return this.sanitizer.bypassSecurityTrustHtml(clean);
  }

  extractTodos(date: string, content: string): TodoItem[] {
    return content.split('\n').reduce<TodoItem[]>((acc, line, index) => {
      const unchecked = /^(\s*)-\s\[ \]\s(.+)/.exec(line);
      const checked = /^(\s*)-\s\[[xX]\]\s(.+)/.exec(line);
      if (unchecked) {
        acc.push({ text: unchecked[2].trim(), checked: false, date, lineIndex: index });
      } else if (checked) {
        acc.push({ text: checked[2].trim(), checked: true, date, lineIndex: index });
      }
      return acc;
    }, []);
  }

  toggleCheckbox(content: string, lineIndex: number): string {
    const lines = content.split('\n');
    const line = lines[lineIndex] ?? '';
    if (/- \[ \]/.test(line)) {
      lines[lineIndex] = line.replace('- [ ]', '- [x]');
    } else if (/- \[[xX]\]/.test(line)) {
      lines[lineIndex] = line.replace(/- \[[xX]\]/, '- [ ]');
    }
    return lines.join('\n');
  }
}
