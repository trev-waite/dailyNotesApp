import { Component, OnInit, inject, output, signal } from '@angular/core';
import { NoteStorageService } from '../../services/note-storage.service';
import { NotePreview } from '../../models/types';

@Component({
  selector: 'app-history-timeline',
  standalone: true,
  templateUrl: './history-timeline.component.html',
})
export class HistoryTimelineComponent implements OnInit {
  private readonly storage = inject(NoteStorageService);

  readonly dateSelected = output<string>();
  readonly loading = signal(true);
  readonly entries = signal<NotePreview[]>([]);

  private readonly todayStr = new Date().toISOString().slice(0, 10);

  async ngOnInit(): Promise<void> {
    const previews = await this.storage.listNotesWithPreviews(200);
    this.entries.set(previews);
    this.loading.set(false);
  }

  select(date: string): void {
    this.dateSelected.emit(date);
  }

  formatDate(dateStr: string): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  }

  isToday(dateStr: string): boolean {
    return dateStr === this.todayStr;
  }
}
