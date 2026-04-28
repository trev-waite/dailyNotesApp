import { Injectable, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked, Renderer } from 'marked';
import DOMPurify from 'dompurify';
import { TodoItem } from '../models/types';

@Injectable({ providedIn: 'root' })
export class MarkdownService {
  private readonly sanitizer = inject(DomSanitizer);

  constructor() {
    const renderer = new Renderer();
    const originalListitem = renderer.listitem.bind(renderer);
    renderer.listitem = (item) => {
      if (item.task) {
        const checked = item.checked ? 'checked' : '';
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
      const match = unchecked ?? checked;
      if (!match) return acc;
      const item: TodoItem = {
        text: match[2].trim(),
        checked: !!checked,
        date,
        lineIndex: index,
      };
      if (match[1].length > 0 && acc.length > 0) {
        (acc[acc.length - 1].children ??= []).push(item);
      } else {
        acc.push(item);
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

  /** Serialize a contenteditable div's HTML back to markdown source. */
  toMarkdown(element: HTMLElement): string {
    const result = Array.from(element.childNodes)
      .map(n => this.nodeToMd(n, ''))
      .join('');
    return result.replace(/\n{3,}/g, '\n\n').trim();
  }

  private nodeToMd(node: Node, parentTag: string): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent ?? '';
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    const inner = () =>
      Array.from(el.childNodes).map(n => this.nodeToMd(n, tag)).join('');

    switch (tag) {
      case 'h1': return `# ${inner().trim()}\n\n`;
      case 'h2': return `## ${inner().trim()}\n\n`;
      case 'h3': return `### ${inner().trim()}\n\n`;
      case 'h4': return `#### ${inner().trim()}\n\n`;
      case 'h5': return `##### ${inner().trim()}\n\n`;
      case 'h6': return `###### ${inner().trim()}\n\n`;
      case 'p': return `${inner()}\n\n`;
      case 'div': return `${inner()}\n`;      // browser editing wraps lines in divs
      case 'br': return parentTag === 'div' ? '' : '\n';
      case 'b': case 'strong': return `**${inner()}**`;
      case 'i': case 'em': return `*${inner()}*`;
      case 's': case 'strike': case 'del': return `~~${inner()}~~`;
      case 'a': return `[${inner()}](${el.getAttribute('href') ?? ''})`;
      case 'code': return parentTag === 'pre' ? inner() : `\`${inner()}\``;
      case 'pre': return `\`\`\`\n${inner().trim()}\n\`\`\`\n\n`;
      case 'blockquote': {
        const lines = inner().trim().split('\n');
        return lines.map(l => `> ${l}`).join('\n') + '\n\n';
      }
      case 'hr': return `---\n\n`;
      case 'ul': return this.listToMd(el, false) + '\n';
      case 'ol': return this.listToMd(el, true) + '\n';
      case 'li': return this.liToMd(el, '-', '');
      case 'table': return this.tableToMd(el);
      case 'details': {
        const summary = el.querySelector('summary')?.textContent?.trim() ?? 'Summary';
        const content = Array.from(el.childNodes)
          .filter(n => (n as HTMLElement).tagName?.toLowerCase() !== 'summary')
          .map(n => this.nodeToMd(n, 'details'))
          .join('')
          .trim();
        return `<details>\n<summary>${summary}</summary>\n\n${content}\n\n</details>\n\n`;
      }
      case 'summary': return '';   // handled inside details
      case 'input': return '';     // checkboxes handled inside li
      default: return inner();
    }
  }

  private listToMd(el: HTMLElement, ordered: boolean): string {
    return Array.from(el.children)
      .map((li, i) => this.liToMd(li as HTMLElement, ordered ? `${i + 1}.` : '-', ''))
      .join('');
  }

  private liToMd(li: HTMLElement, bullet: string, indent: string): string {
    const checkbox = li.querySelector(':scope > input[type="checkbox"]');
    const nestedUl = li.querySelector(':scope > ul');
    const nestedOl = li.querySelector(':scope > ol');
    const nestedList = (nestedUl ?? nestedOl) as HTMLElement | null;

    const textContent = Array.from(li.childNodes)
      .filter(n => n !== checkbox && n !== nestedList)
      .map(n => this.nodeToMd(n, 'li'))
      .join('')
      .trim();

    const nestedMd = nestedList
      ? this.listToMd(nestedList, nestedList.tagName.toLowerCase() === 'ol')
          .split('\n')
          .filter(l => l)
          .map(l => `  ${l}`)
          .join('\n') + '\n'
      : '';

    if (checkbox) {
      const checked = (checkbox as HTMLInputElement).checked ? 'x' : ' ';
      return `${indent}- [${checked}] ${textContent}\n${nestedMd}`;
    }
    return `${indent}${bullet} ${textContent}\n${nestedMd}`;
  }

  private tableToMd(table: HTMLElement): string {
    const rows = Array.from(table.querySelectorAll('tr'));
    if (rows.length === 0) return '';
    const cells = rows.map(row =>
      Array.from(row.querySelectorAll('th, td')).map(c => c.textContent?.trim() ?? '')
    );
    const header = `| ${cells[0].join(' | ')} |`;
    const sep = `| ${cells[0].map(() => '---').join(' | ')} |`;
    const body = cells.slice(1).map(row => `| ${row.join(' | ')} |`).join('\n');
    return [header, sep, body].filter(Boolean).join('\n') + '\n\n';
  }
}
