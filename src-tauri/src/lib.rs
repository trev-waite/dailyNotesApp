use rayon::prelude::*;
use std::path::PathBuf;

#[derive(serde::Serialize)]
struct NotePreview {
    date: String,
    preview: String,
    has_todos: bool,
}

#[derive(serde::Serialize)]
struct SearchResult {
    date: String,
    kind: String,
    snippet: String,
}

/// Extracts a ~`max_len`-char snippet from `content` centred on `byte_pos`.
fn extract_snippet(content: &str, byte_pos: usize, max_len: usize) -> String {
    let half = max_len / 2;
    let raw_start = byte_pos.saturating_sub(half);
    let start = (0..=raw_start)
        .rev()
        .find(|&i| content.is_char_boundary(i))
        .unwrap_or(0);
    let raw_end = (start + max_len).min(content.len());
    let end = (raw_end..=content.len())
        .find(|&i| content.is_char_boundary(i))
        .unwrap_or(content.len());
    let snippet = &content[start..end];
    let prefix = if start > 0 { "…" } else { "" };
    let suffix = if end < content.len() { "…" } else { "" };
    format!("{}{}{}", prefix, snippet.trim(), suffix)
}

/// Validates that `date` is exactly in YYYY-MM-DD format (digits only, correct separators).
fn validate_date(date: &str) -> bool {
    let bytes = date.as_bytes();
    bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes[..4].iter().all(u8::is_ascii_digit)
        && bytes[5..7].iter().all(u8::is_ascii_digit)
        && bytes[8..].iter().all(u8::is_ascii_digit)
}

fn note_path(notes_dir: &str, date: &str) -> Result<PathBuf, String> {
    resolve_path(notes_dir, &format!("{date}.md"))
}

fn todos_path(notes_dir: &str, date: &str) -> Result<PathBuf, String> {
    resolve_path(notes_dir, &format!("{date}.todos.md"))
}

fn resolve_path(notes_dir: &str, filename: &str) -> Result<PathBuf, String> {
    let base = PathBuf::from(notes_dir);
    let path = base.join(filename);
    let canonical_base = base.canonicalize().map_err(|e| e.to_string())?;
    let canonical_path = path
        .parent()
        .ok_or("No parent")?
        .canonicalize()
        .unwrap_or_else(|_| canonical_base.clone());
    if !canonical_path.starts_with(&canonical_base) {
        return Err("Path traversal detected".into());
    }
    Ok(path)
}

fn validate_note_path(notes_dir: &str, date: &str) -> Result<PathBuf, String> {
    if !validate_date(date) {
        return Err(format!("Invalid date format: {date}"));
    }
    note_path(notes_dir, date)
}

fn validate_todos_path(notes_dir: &str, date: &str) -> Result<PathBuf, String> {
    if !validate_date(date) {
        return Err(format!("Invalid date format: {date}"));
    }
    todos_path(notes_dir, date)
}

#[tauri::command]
async fn pick_notes_folder(app: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;
    let folder = app
        .dialog()
        .file()
        .blocking_pick_folder();
    match folder {
        Some(path) => Ok(path.to_string()),
        None => Err("No folder selected".into()),
    }
}

#[tauri::command]
async fn read_note(notes_dir: String, date: String) -> Result<String, String> {
    let path = validate_note_path(&notes_dir, &date)?;
    if !path.exists() {
        return Ok(String::new());
    }
    let canonical_base = PathBuf::from(&notes_dir)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let canonical_path = path.canonicalize().map_err(|e| e.to_string())?;
    if !canonical_path.starts_with(&canonical_base) {
        return Err("Path traversal detected".into());
    }
    std::fs::read_to_string(&canonical_path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn write_note(notes_dir: String, date: String, content: String) -> Result<(), String> {
    let path = validate_note_path(&notes_dir, &date)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_notes(notes_dir: String) -> Result<Vec<String>, String> {
    list_files_by_suffix(&notes_dir, ".md")
}

#[tauri::command]
async fn read_todos(notes_dir: String, date: String) -> Result<String, String> {
    let path = validate_todos_path(&notes_dir, &date)?;
    if !path.exists() {
        return Ok(String::new());
    }
    let canonical_base = PathBuf::from(&notes_dir)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let canonical_path = path.canonicalize().map_err(|e| e.to_string())?;
    if !canonical_path.starts_with(&canonical_base) {
        return Err("Path traversal detected".into());
    }
    std::fs::read_to_string(&canonical_path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn write_todos(notes_dir: String, date: String, content: String) -> Result<(), String> {
    let path = validate_todos_path(&notes_dir, &date)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_todo_files(notes_dir: String) -> Result<Vec<String>, String> {
    list_files_by_suffix(&notes_dir, ".todos.md")
}

fn list_files_by_suffix(notes_dir: &str, suffix: &str) -> Result<Vec<String>, String> {
    let base = PathBuf::from(notes_dir);
    if !base.exists() {
        return Ok(vec![]);
    }
    let suffix_len = suffix.len();
    let mut dates: Vec<String> = std::fs::read_dir(&base)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let name = entry.file_name().into_string().ok()?;
            if name.ends_with(suffix) {
                let stem = &name[..name.len() - suffix_len];
                if validate_date(stem) {
                    return Some(stem.to_string());
                }
            }
            None
        })
        .collect();
    dates.sort();
    Ok(dates)
}

#[tauri::command]
async fn list_notes_with_previews(
    notes_dir: String,
    preview_len: usize,
) -> Result<Vec<NotePreview>, String> {
    let capped_len = preview_len.min(500);
    let base = PathBuf::from(&notes_dir);
    if !base.exists() {
        return Ok(vec![]);
    }
    let canonical_base = base.canonicalize().map_err(|e| e.to_string())?;
    let dates = list_files_by_suffix(&notes_dir, ".md")?;

    let mut previews: Vec<NotePreview> = dates
        .par_iter()
        .filter_map(|date| {
            let note_path = base.join(format!("{date}.md"));
            let todos_path = base.join(format!("{date}.todos.md"));
            let canonical = note_path.parent()?.canonicalize().ok()?;
            if !canonical.starts_with(&canonical_base) {
                return None;
            }
            let content = std::fs::read_to_string(&note_path).unwrap_or_default();
            let preview: String = content.chars().take(capped_len).collect();
            let has_todos = todos_path.exists();
            Some(NotePreview { date: date.clone(), preview, has_todos })
        })
        .collect();

    previews.sort_by(|a, b| b.date.cmp(&a.date));
    Ok(previews)
}

#[tauri::command]
async fn search_notes(notes_dir: String, query: String) -> Result<Vec<SearchResult>, String> {
    if query.is_empty() {
        return Ok(vec![]);
    }
    if query.len() > 500 {
        return Err("Query too long".into());
    }
    let base = PathBuf::from(&notes_dir);
    if !base.exists() {
        return Ok(vec![]);
    }
    let canonical_base = base.canonicalize().map_err(|e| e.to_string())?;
    let query_lower = query.to_lowercase();

    let note_dates = list_files_by_suffix(&notes_dir, ".md")?;
    let todo_dates = list_files_by_suffix(&notes_dir, ".todos.md")?;

    let note_results: Vec<SearchResult> = note_dates
        .par_iter()
        .filter_map(|date| {
            let path = base.join(format!("{date}.md"));
            let canonical = path.parent()?.canonicalize().ok()?;
            if !canonical.starts_with(&canonical_base) {
                return None;
            }
            let content = std::fs::read_to_string(&path).ok()?;
            let content_lower = content.to_lowercase();
            let byte_pos = content_lower.find(&query_lower)?;
            let snippet = extract_snippet(&content, byte_pos, 150);
            Some(SearchResult { date: date.clone(), kind: "note".into(), snippet })
        })
        .collect();

    let todo_results: Vec<SearchResult> = todo_dates
        .par_iter()
        .filter_map(|date| {
            let path = base.join(format!("{date}.todos.md"));
            let canonical = path.parent()?.canonicalize().ok()?;
            if !canonical.starts_with(&canonical_base) {
                return None;
            }
            let content = std::fs::read_to_string(&path).ok()?;
            let content_lower = content.to_lowercase();
            let byte_pos = content_lower.find(&query_lower)?;
            let snippet = extract_snippet(&content, byte_pos, 150);
            Some(SearchResult { date: date.clone(), kind: "todo".into(), snippet })
        })
        .collect();

    let mut results = note_results;
    results.extend(todo_results);
    results.sort_by(|a, b| b.date.cmp(&a.date));
    Ok(results)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            pick_notes_folder,
            read_note,
            write_note,
            list_notes,
            read_todos,
            write_todos,
            list_todo_files,
            list_notes_with_previews,
            search_notes,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
