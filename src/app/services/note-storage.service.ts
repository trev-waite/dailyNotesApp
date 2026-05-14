import { Injectable, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { NotePreview, SearchResult } from '../models/types';

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

  async readTodos(date: string): Promise<string> {
    const dir = this.notesDir();
    if (!dir) return '';
    return invoke<string>('read_todos', { notesDir: dir, date });
  }

  async writeTodos(date: string, content: string): Promise<void> {
    const dir = this.notesDir();
    if (!dir) return;
    await invoke<void>('write_todos', { notesDir: dir, date, content });
  }

  async listTodoFiles(): Promise<string[]> {
    const dir = this.notesDir();
    if (!dir) return [];
    return invoke<string[]>('list_todo_files', { notesDir: dir });
  }

  async listNotesWithPreviews(previewLen = 200): Promise<NotePreview[]> {
    const dir = this.notesDir();
    if (!dir) return [];
    return invoke<NotePreview[]>('list_notes_with_previews', { notesDir: dir, previewLen });
  }

  async searchNotes(query: string): Promise<SearchResult[]> {
    const dir = this.notesDir();
    if (!dir) return [];
    return invoke<SearchResult[]>('search_notes', { notesDir: dir, query });
  }
}
