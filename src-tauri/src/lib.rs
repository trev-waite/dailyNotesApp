use std::path::PathBuf;

fn validate_date(date: &str) -> bool {
    let re = regex::Regex::new(r"^\d{4}-\d{2}-\d{2}$").unwrap();
    re.is_match(date)
}

fn note_path(notes_dir: &str, date: &str) -> Result<PathBuf, String> {
    if !validate_date(date) {
        return Err(format!("Invalid date format: {date}"));
    }
    let base = PathBuf::from(notes_dir);
    let path = base.join(format!("{date}.md"));
    // For a path that may not exist yet, check parent is within base
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
    let path = note_path(&notes_dir, &date)?;
    if !path.exists() {
        return Ok(String::new());
    }
    // Canonicalize now that the file exists
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
    let path = note_path(&notes_dir, &date)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_notes(notes_dir: String) -> Result<Vec<String>, String> {
    let base = PathBuf::from(&notes_dir);
    if !base.exists() {
        return Ok(vec![]);
    }
    let mut dates: Vec<String> = std::fs::read_dir(&base)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let name = entry.file_name().into_string().ok()?;
            if name.ends_with(".md") && validate_date(&name[..name.len() - 3]) {
                Some(name[..name.len() - 3].to_string())
            } else {
                None
            }
        })
        .collect();
    dates.sort();
    Ok(dates)
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
