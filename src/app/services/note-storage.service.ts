import { Injectable, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { TodoItem } from '../models/types';

const NOTES_DIR_KEY = 'notesDir';

@Injectable({ providedIn: 'root' })
export class NoteStorageService {
  readonly notesDir = signal<string>(localStorage.getItem(NOTES_DIR_KEY) ?? '');

  async pickFolder(): Promise<boolean> {
    try {
      const dir = await invoke<string>('pick_notes_folder');
      localStorage.setItem(NOTES_DIR_KEY, dir);
      this.notesDir.set(dir);
      return true;
    } catch {
      return false;
    }
  }

  async readNote(date: string): Promise<string> {
    const dir = this.notesDir();
    if (!dir) return '';
    return invoke<string>('read_note', { notesDir: dir, date });
  }

  async writeNote(date: string, content: string): Promise<void> {
    const dir = this.notesDir();
    if (!dir) return;
    await invoke<void>('write_note', { notesDir: dir, date, content });
  }

  async listNotes(): Promise<string[]> {
    const dir = this.notesDir();
    if (!dir) return [];
    return invoke<string[]>('list_notes', { notesDir: dir });
  }

  toggleTodo(content: string, lineIndex: number): string {
    const lines = content.split('\n');
    const line = lines[lineIndex] ?? '';
    if (line.includes('- [ ]')) {
      lines[lineIndex] = line.replace('- [ ]', '- [x]');
    } else if (line.includes('- [x]') || line.includes('- [X]')) {
      lines[lineIndex] = line.replace(/- \[[xX]\]/, '- [ ]');
    }
    return lines.join('\n');
  }
}
