//! Native SQLite for the Noted Desktop webview.
//!
//! WebKitGTK exposes no Storage API (`navigator.storage` is missing altogether, see
//! `docs/desktop-audio.mdx`), so the web build's SQLite-on-OPFS cannot open there.
//! This gives the SAME app the SAME SQLite, held by Rust instead: the web app's
//! local store engine (`lib/db/client-engine.ts`) runs unchanged and reaches these
//! commands through a driver (`lib/db/desktop-driver.ts`).
//!
//! One connection per database name, behind one lock. That is deliberate, and it is
//! why this is not `tauri-plugin-sql`: the engine opens a transaction with
//! `BEGIN IMMEDIATE`, runs statements across several awaited calls and then commits,
//! which only works if every call reaches the SAME connection. A connection pool
//! would send them to different ones.
//!
//! The functions below the Tauri commands take a plain `Connection`, so they are
//! tested here without a window.

use rusqlite::{params_from_iter, types::Value, types::ValueRef, Connection};
use serde::Serialize;
use serde_json::{Map, Value as Json};
use std::{collections::HashMap, fs, path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Manager, State};

/// Open connections by database name.
#[derive(Default)]
pub struct Databases(Mutex<HashMap<String, Connection>>);

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
    pub changes: usize,
    pub last_insert_row_id: i64,
}

/// A database name becomes a file name, and the webview can send any string, so
/// only a safe set gets through: no separators, no leading dot, bounded length.
pub fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && !name.starts_with('.')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
}

fn to_sql(value: &Json) -> Result<Value, String> {
    match value {
        Json::Null => Ok(Value::Null),
        Json::Bool(flag) => Ok(Value::Integer(i64::from(*flag))),
        Json::Number(number) => match number.as_i64() {
            Some(integer) => Ok(Value::Integer(integer)),
            None => number
                .as_f64()
                .map(Value::Real)
                .ok_or_else(|| "number out of range".to_string()),
        },
        Json::String(text) => Ok(Value::Text(text.clone())),
        Json::Array(_) | Json::Object(_) => {
            Err("only null, booleans, numbers and strings can be bound".to_string())
        }
    }
}

fn to_json(value: ValueRef<'_>) -> Result<Json, String> {
    match value {
        ValueRef::Null => Ok(Json::Null),
        ValueRef::Integer(integer) => Ok(Json::from(integer)),
        ValueRef::Real(real) => Ok(Json::from(real)),
        ValueRef::Text(bytes) => String::from_utf8(bytes.to_vec())
            .map(Json::String)
            .map_err(|_| "text column is not valid UTF-8".to_string()),
        // Noted's schema has no blob columns; failing loudly beats guessing an encoding.
        ValueRef::Blob(_) => Err("blob columns are not supported".to_string()),
    }
}

fn bind(params: &[Json]) -> Result<Vec<Value>, String> {
    params.iter().map(to_sql).collect()
}

/// Open (creating if needed) the database file at `path`.
pub fn open_at(path: &PathBuf) -> Result<Connection, String> {
    Connection::open(path).map_err(|error| error.to_string())
}

/// Run one or more statements and discard any rows (`PRAGMA`, `BEGIN`, DDL…).
pub fn exec(connection: &Connection, sql: &str) -> Result<(), String> {
    connection
        .execute_batch(sql)
        .map_err(|error| error.to_string())
}

/// Run one write statement and report how many rows it changed.
pub fn run(connection: &Connection, sql: &str, params: &[Json]) -> Result<RunResult, String> {
    let values = bind(params)?;
    let changes = connection
        .execute(sql, params_from_iter(values.iter()))
        .map_err(|error| error.to_string())?;
    Ok(RunResult {
        changes,
        last_insert_row_id: connection.last_insert_rowid(),
    })
}

/// Run a query and return its rows as objects keyed by column name.
pub fn all(
    connection: &Connection,
    sql: &str,
    params: &[Json],
) -> Result<Vec<Map<String, Json>>, String> {
    let values = bind(params)?;
    let mut statement = connection.prepare(sql).map_err(|error| error.to_string())?;
    let columns: Vec<String> = statement
        .column_names()
        .iter()
        .map(|name| (*name).to_string())
        .collect();
    let mut rows = statement
        .query(params_from_iter(values.iter()))
        .map_err(|error| error.to_string())?;

    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|error| error.to_string())? {
        let mut object = Map::new();
        for (index, column) in columns.iter().enumerate() {
            let value = row.get_ref(index).map_err(|error| error.to_string())?;
            object.insert(column.clone(), to_json(value)?);
        }
        out.push(object);
    }
    Ok(out)
}

fn database_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    if !valid_name(name) {
        return Err("invalid database name".to_string());
    }
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("databases");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join(name))
}

fn with_connection<T>(
    databases: &State<'_, Databases>,
    name: &str,
    work: impl FnOnce(&Connection) -> Result<T, String>,
) -> Result<T, String> {
    let guard = databases.0.lock().map_err(|_| "database lock poisoned".to_string())?;
    let connection = guard
        .get(name)
        .ok_or_else(|| "database is not open".to_string())?;
    work(connection)
}

#[tauri::command]
pub async fn db_open(
    app: AppHandle,
    databases: State<'_, Databases>,
    name: String,
) -> Result<(), String> {
    let path = database_path(&app, &name)?;
    let mut guard = databases.0.lock().map_err(|_| "database lock poisoned".to_string())?;
    if !guard.contains_key(&name) {
        guard.insert(name, open_at(&path)?);
    }
    Ok(())
}

#[tauri::command]
pub async fn db_exec(
    databases: State<'_, Databases>,
    name: String,
    sql: String,
) -> Result<(), String> {
    with_connection(&databases, &name, |connection| exec(connection, &sql))
}

#[tauri::command]
pub async fn db_run(
    databases: State<'_, Databases>,
    name: String,
    sql: String,
    params: Vec<Json>,
) -> Result<RunResult, String> {
    with_connection(&databases, &name, |connection| run(connection, &sql, &params))
}

#[tauri::command]
pub async fn db_all(
    databases: State<'_, Databases>,
    name: String,
    sql: String,
    params: Vec<Json>,
) -> Result<Vec<Map<String, Json>>, String> {
    with_connection(&databases, &name, |connection| all(connection, &sql, &params))
}

#[tauri::command]
pub async fn db_close(databases: State<'_, Databases>, name: String) -> Result<(), String> {
    let mut guard = databases.0.lock().map_err(|_| "database lock poisoned".to_string())?;
    guard.remove(&name);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn memory() -> Connection {
        Connection::open_in_memory().expect("in-memory database")
    }

    #[test]
    fn names_are_a_safe_set() {
        assert!(valid_name("noted-user_1.db"));
        for bad in ["", ".hidden", "a/b", "a\\b", "..", "a b", "é.db", &"x".repeat(129)] {
            assert!(!valid_name(bad), "{bad:?} should be refused");
        }
    }

    #[test]
    fn binds_and_reads_back_every_supported_type() {
        let db = memory();
        exec(&db, "CREATE TABLE t (i INTEGER, r REAL, s TEXT, n TEXT)").unwrap();
        let result = run(
            &db,
            "INSERT INTO t (i, r, s, n) VALUES (?, ?, ?, ?)",
            &[json!(7), json!(1.5), json!("héllo"), Json::Null],
        )
        .unwrap();
        assert_eq!(result.changes, 1);

        let rows = all(&db, "SELECT i, r, s, n FROM t", &[]).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["i"], json!(7));
        assert_eq!(rows[0]["r"], json!(1.5));
        assert_eq!(rows[0]["s"], json!("héllo"));
        assert_eq!(rows[0]["n"], Json::Null);
    }

    #[test]
    fn booleans_bind_as_integers_like_the_engine_expects() {
        let db = memory();
        exec(&db, "CREATE TABLE t (flag INTEGER)").unwrap();
        run(&db, "INSERT INTO t VALUES (?)", &[json!(true)]).unwrap();
        let rows = all(&db, "SELECT flag FROM t", &[]).unwrap();
        assert_eq!(rows[0]["flag"], json!(1));
    }

    #[test]
    fn refuses_values_it_cannot_bind_faithfully() {
        let db = memory();
        exec(&db, "CREATE TABLE t (x)").unwrap();
        assert!(run(&db, "INSERT INTO t VALUES (?)", &[json!([1, 2])]).is_err());
        assert!(run(&db, "INSERT INTO t VALUES (?)", &[json!({"a": 1})]).is_err());
    }

    #[test]
    fn reports_changes_so_a_conditional_write_can_be_checked() {
        let db = memory();
        exec(&db, "CREATE TABLE t (id TEXT PRIMARY KEY, v INTEGER)").unwrap();
        run(&db, "INSERT INTO t VALUES ('a', 1)", &[]).unwrap();
        // The engine's compare-and-swap relies on 0 vs 1 here.
        let missed = run(&db, "UPDATE t SET v = 2 WHERE id = ? AND v = ?", &[json!("a"), json!(9)]).unwrap();
        let hit = run(&db, "UPDATE t SET v = 2 WHERE id = ? AND v = ?", &[json!("a"), json!(1)]).unwrap();
        assert_eq!((missed.changes, hit.changes), (0, 1));
    }

    #[test]
    fn a_transaction_spans_separate_calls_on_one_connection() {
        let db = memory();
        exec(&db, "CREATE TABLE t (v INTEGER)").unwrap();
        // This is the engine's runTransaction, call by call.
        exec(&db, "BEGIN IMMEDIATE").unwrap();
        run(&db, "INSERT INTO t VALUES (1)", &[]).unwrap();
        run(&db, "INSERT INTO t VALUES (2)", &[]).unwrap();
        exec(&db, "ROLLBACK").unwrap();
        assert!(all(&db, "SELECT * FROM t", &[]).unwrap().is_empty());

        exec(&db, "BEGIN IMMEDIATE").unwrap();
        run(&db, "INSERT INTO t VALUES (3)", &[]).unwrap();
        exec(&db, "COMMIT").unwrap();
        assert_eq!(all(&db, "SELECT * FROM t", &[]).unwrap().len(), 1);
    }

    #[test]
    fn pragmas_that_return_rows_do_not_break_exec() {
        let db = memory();
        // The engine issues these through execAsync at open.
        exec(&db, "PRAGMA journal_mode = WAL").unwrap();
        exec(&db, "PRAGMA foreign_keys = ON").unwrap();
        exec(&db, "PRAGMA synchronous = NORMAL").unwrap();
        let rows = all(&db, "PRAGMA user_version", &[]).unwrap();
        assert_eq!(rows[0]["user_version"], json!(0));
    }

    #[test]
    fn sql_errors_come_back_as_messages_not_panics() {
        let db = memory();
        assert!(exec(&db, "NOT SQL").is_err());
        assert!(run(&db, "INSERT INTO missing VALUES (1)", &[]).is_err());
        assert!(all(&db, "SELECT * FROM missing", &[]).is_err());
    }

    #[test]
    fn a_database_persists_on_disk_and_reopens() {
        let path = std::env::temp_dir().join(format!("noted-db-test-{}.db", std::process::id()));
        let _ = fs::remove_file(&path);
        {
            let db = open_at(&path).unwrap();
            exec(&db, "CREATE TABLE t (v TEXT)").unwrap();
            run(&db, "INSERT INTO t VALUES (?)", &[json!("kept")]).unwrap();
        }
        let reopened = open_at(&path).unwrap();
        let rows = all(&reopened, "SELECT v FROM t", &[]).unwrap();
        assert_eq!(rows[0]["v"], json!("kept"));
        drop(reopened);
        let _ = fs::remove_file(&path);
    }
}
