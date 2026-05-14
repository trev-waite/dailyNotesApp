import { Component, HostListener, Input, inject, output } from '@angular/core';
import { NoteStorageService } from '../../services/note-storage.service';
import { ThemeService } from '../../services/theme.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  templateUrl: './settings.component.html',
})
export class SettingsComponent {
  readonly storage = inject(NoteStorageService);
  readonly theme = inject(ThemeService);

  @Input() calendarAlwaysVisible = false;

  readonly closed = output<void>();
  readonly calendarAlwaysVisibleChange = output<boolean>();

  async changeFolder(): Promise<void> {
    await this.storage.pickFolder();
  }

  toggleCalendarAlwaysVisible(): void {
    this.calendarAlwaysVisibleChange.emit(!this.calendarAlwaysVisible);
  }

  close(): void {
    this.closed.emit();
  }

  @HostListener('document:keydown.Escape')
  onEscape(): void {
    this.close();
  }
}
