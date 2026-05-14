import { AfterViewInit, Component, ElementRef, inject, output, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Subject, debounceTime } from 'rxjs';
import { NoteStorageService } from '../../services/note-storage.service';
import { SearchResult } from '../../models/types';

@Component({
  selector: 'app-search-panel',
  standalone: true,
  templateUrl: './search-panel.component.html',
})
export class SearchPanelComponent implements AfterViewInit {
  private readonly storage = inject(NoteStorageService);
  private readonly sanitizer = inject(DomSanitizer);

  readonly searchInputRef = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  readonly dateSelected = output<string>();
  readonly query = signal('');
  readonly loading = signal(false);
  readonly noteResults = signal<SearchResult[]>([]);
  readonly todoResults = signal<SearchResult[]>([]);

  private readonly searchSubject = new Subject<string>();

  constructor() {
    this.searchSubject
      .pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(q => void this.runSearch(q));
  }

  ngAfterViewInit(): void {
    this.searchInputRef()?.nativeElement.focus();
  }

  onQueryChange(value: string): void {
    this.query.set(value);
    if (!value.trim()) {
      this.noteResults.set([]);
      this.todoResults.set([]);
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.searchSubject.next(value.trim());
  }

  private async runSearch(q: string): Promise<void> {
    const results = await this.storage.searchNotes(q);
    this.noteResults.set(results.filter(r => r.kind === 'note'));
    this.todoResults.set(results.filter(r => r.kind === 'todo'));
    this.loading.set(false);
  }

  select(date: string): void {
    this.dateSelected.emit(date);
  }

  formatDate(dateStr: string): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    });
  }

  highlight(snippet: string, query: string): SafeHtml {
    const escaped = snippet.replace(
      /[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
    );
    const safeQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const highlighted = escaped.replace(
      new RegExp(`(${safeQuery})`, 'gi'),
      '<mark class="bg-yellow-200 dark:bg-yellow-800/60 text-inherit rounded-sm px-0.5">$1</mark>',
    );
    return this.sanitizer.bypassSecurityTrustHtml(highlighted);
  }
}
