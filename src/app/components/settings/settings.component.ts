import { Component, inject, output } from '@angular/core';
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

  readonly closed = output<void>();

  async changeFolder(): Promise<void> {
    await this.storage.pickFolder();
  }

  close(): void {
    this.closed.emit();
  }
}
