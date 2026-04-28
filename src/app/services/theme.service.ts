import { Injectable, signal, effect } from '@angular/core';

const THEME_KEY = 'themeOverride';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

  readonly isDark = signal<boolean>(this.resolveInitial());

  constructor() {
    // Apply class on init
    this.applyClass(this.isDark());

    // Listen for OS theme changes; only apply if no manual override
    this.mediaQuery.addEventListener('change', (e) => {
      if (localStorage.getItem(THEME_KEY) === null) {
        this.isDark.set(e.matches);
        this.applyClass(e.matches);
      }
    });

    // Reactively keep the DOM in sync whenever isDark changes
    effect(() => this.applyClass(this.isDark()));
  }

  toggle(): void {
    const next = !this.isDark();
    this.isDark.set(next);
    localStorage.setItem(THEME_KEY, next ? 'dark' : 'light');
  }

  private resolveInitial(): boolean {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'dark') return true;
    if (stored === 'light') return false;
    return this.mediaQuery.matches;
  }

  private applyClass(dark: boolean): void {
    document.documentElement.classList.toggle('dark', dark);
  }
}
