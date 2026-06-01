import { Injectable, inject } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { NoteStorageService } from './note-storage.service';
import { DiagramFile, DiagramSummary } from '../models/diagram.types';

@Injectable({ providedIn: 'root' })
export class DiagramStorageService {
  private readonly noteStorage = inject(NoteStorageService);

  private diagramsDir(): string {
    const base = this.noteStorage.notesDir();
    return base ? `${base}/diagrams` : '';
  }

  async listDiagrams(): Promise<DiagramSummary[]> {
    const dir = this.diagramsDir();
    if (!dir) return [];
    return invoke<DiagramSummary[]>('list_diagrams', { diagramsDir: dir });
  }

  async readDiagram(id: string): Promise<DiagramFile | null> {
    const dir = this.diagramsDir();
    if (!dir) return null;
    const json = await invoke<string>('read_diagram', { diagramsDir: dir, id });
    return JSON.parse(json) as DiagramFile;
  }

  async writeDiagram(diagram: DiagramFile): Promise<void> {
    const dir = this.diagramsDir();
    if (!dir) return;
    await invoke<void>('write_diagram', {
      diagramsDir: dir,
      id: diagram.id,
      content: JSON.stringify(diagram, null, 2),
    });
  }

  async deleteDiagram(id: string): Promise<void> {
    const dir = this.diagramsDir();
    if (!dir) return;
    await invoke<void>('delete_diagram', { diagramsDir: dir, id });
  }

  async renameDiagram(id: string, newName: string): Promise<void> {
    const dir = this.diagramsDir();
    if (!dir) return;
    await invoke<void>('rename_diagram', { diagramsDir: dir, id, newName });
  }
}
