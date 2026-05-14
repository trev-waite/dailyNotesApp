export interface DailyNote {
  date: string;
  content: string;
}

export interface TodoItem {
  text: string;
  checked: boolean;
  date: string;
  lineIndex: number;
  children?: TodoItem[];
}

export interface NotePreview {
  date: string;
  preview: string;
  hasTodos: boolean;
}

export interface SearchResult {
  date: string;
  kind: 'note' | 'todo';
  snippet: string;
}
