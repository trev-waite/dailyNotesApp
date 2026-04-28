export interface DailyNote {
  date: string;
  content: string;
}

export interface TodoItem {
  text: string;
  checked: boolean;
  date: string;
  lineIndex: number;
}

export interface SlashCommand {
  id: string;
  label: string;
  description: string;
  snippet: string;
  /** Zero-based index range within snippet to select after insertion, relative to snippet start */
  selectRange?: [number, number];
}
