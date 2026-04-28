import { Injectable } from '@angular/core';
import { SlashCommand } from '../models/types';

@Injectable({ providedIn: 'root' })
export class SlashCommandService {
  readonly commands: SlashCommand[] = [
    {
      id: 'h1',
      label: '/h1',
      description: 'Heading 1',
      snippet: '# ',
    },
    {
      id: 'h2',
      label: '/h2',
      description: 'Heading 2',
      snippet: '## ',
    },
    {
      id: 'h3',
      label: '/h3',
      description: 'Heading 3',
      snippet: '### ',
    },
    {
      id: 'collapsible',
      label: '/collapsible',
      description: 'Collapsible section',
      snippet: '<details>\n<summary>Section Title</summary>\n\nContent here\n\n</details>',
      // Select "Section Title" (chars 18–30 within snippet)
      selectRange: [18, 31],
    },
    {
      id: 'divider',
      label: '/divider',
      description: 'Horizontal rule',
      snippet: '\n---\n',
    },
    {
      id: 'quote',
      label: '/quote',
      description: 'Blockquote',
      snippet: '> ',
    },
    {
      id: 'code-block',
      label: '/code-block',
      description: 'Fenced code block',
      snippet: '```\n\n```',
      // Place cursor on the blank middle line (index 4)
      selectRange: [4, 4],
    },
    {
      id: 'bold',
      label: '/bold',
      description: 'Bold text',
      snippet: '**bold**',
      selectRange: [2, 6],
    },
    {
      id: 'italic',
      label: '/italic',
      description: 'Italic text',
      snippet: '*italic*',
      selectRange: [1, 7],
    },
    {
      id: 'todo',
      label: '/todo',
      description: 'Checklist item',
      snippet: '- [ ] ',
    },
  ];

  filter(query: string): SlashCommand[] {
    const q = query.toLowerCase();
    return this.commands.filter(
      (c) => c.id.includes(q) || c.description.toLowerCase().includes(q),
    );
  }
}
