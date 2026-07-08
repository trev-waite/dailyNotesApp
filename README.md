# Daily Notes

A minimal desktop app for writing daily markdown notes. One file per day, stored wherever you want on your machine.

Built with Angular 21 and Tauri 2.

---

## Features

- One note per day with a simple date-based navigation
- WYSIWYG markdown editor with live rendering
- Formatting toolbar: H1, H2, Bold, Italic, Code, Bullet List, Link
- Keyboard shortcuts for all toolbar actions
- Todo list panel that tracks unchecked items across past notes
- Dark mode (follows OS preference, toggle in settings)
- Notes saved as plain `.md` files — no lock-in

---

## Prerequisites

- [Bun](https://bun.sh/) 1.0 or later
- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain)
- Tauri CLI (installed automatically via Bun)

On macOS you will also need Xcode Command Line Tools:

```
xcode-select --install
```

### Installing Rust

Use **one** of the following methods — mixing them can leave broken `cargo`/`rustc` symlinks in `~/.cargo/bin`.

**Option A — official installer (recommended):**

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

This adds `~/.cargo/bin` to your `PATH` automatically (via `~/.cargo/env`, sourced from your shell profile).

**Option B — Homebrew:**

```bash
brew install rustup
rustup default stable
```

Homebrew's `rustup` is keg-only and does not touch `~/.cargo/bin`. Add its shims to your `PATH` instead:

```bash
echo 'export PATH="/usr/local/opt/rustup/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

If you previously installed Rust via the official installer and later switched to Homebrew (or vice versa), verify `which cargo` resolves to a working binary — stale symlinks from the old install can shadow the new one.

---

## Setup

```bash
git clone <repo-url>
cd dailyNotesApp
bun install
```

---

## Development

```bash
bun run tauri dev
```

This starts the Angular dev server and opens the Tauri desktop window. Hot reload is enabled for the frontend.

On first launch the app will ask you to pick a folder where notes are stored. This path is saved in localStorage and persists between sessions.

---

## Build

```bash
bun run tauri build
```

Produces a native app bundle in `src-tauri/target/release/bundle/`.

---

## Keyboard Shortcuts

| Action      | Shortcut   |
|-------------|------------|
| Bold        | Cmd+B      |
| Italic      | Cmd+I      |
| Link        | Cmd+K      |
| Heading 1   | Cmd+Alt+1  |
| Heading 2   | Cmd+Alt+2  |
| Bullet list | Cmd+Shift+L|
| Code        | Cmd+Shift+C|

---

## Project Structure

```
src/
  app/
    components/
      day-editor/       # Main markdown editor
      calendar-nav/     # Monthly calendar for date picking
      timeline-nav/     # 7-day horizontal timeline
      outgoing-todos/   # Todo panel showing items from past notes
      settings/         # Theme toggle and folder picker
    services/
      markdown.service.ts       # Markdown parse/render and DOM-to-markdown
      note-storage.service.ts   # Tauri file system bridge
      theme.service.ts          # Dark mode management
    models/
      types.ts          # Shared interfaces (DailyNote, TodoItem)
    utils/
      date.ts           # Date formatting helpers
src-tauri/
  src/                  # Rust backend (file I/O commands)
  tauri.conf.json       # App config, window settings, permissions
```

Notes are stored as plain markdown files named `YYYY-MM-DD.md` in the folder you choose. Todos are tracked in separate `YYYY-MM-DD.todo.md` files in the same folder.
