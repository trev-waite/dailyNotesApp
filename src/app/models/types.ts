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
