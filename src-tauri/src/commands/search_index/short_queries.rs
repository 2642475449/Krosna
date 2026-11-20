use rusqlite::{params, Connection};
use std::collections::BTreeSet;

fn is_cjk(character: char) -> bool {
    matches!(character as u32, 0x3400..=0x4dbf | 0x4e00..=0x9fff | 0xf900..=0xfaff | 0x20000..=0x323af)
}

pub(super) fn token(query: &str) -> Option<String> {
    let mut chars = query.chars();
    let first = chars.next()?;
    let second = chars.next()?;
    if chars.next().is_some() || !is_cjk(first) || !is_cjk(second) {
        return None;
    }
    Some(format!("u{:x}z{:x}", first as u32, second as u32))
}

pub(super) fn create(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch(
        "CREATE VIRTUAL TABLE IF NOT EXISTS content_cjk_bigrams USING fts5(
        tokens, content='', contentless_delete=1, tokenize='ascii'
    );",
    )
}

pub(super) fn ready(connection: &Connection) -> bool {
    connection
        .query_row(
            "SELECT value = '1' FROM index_meta WHERE key = 'cjk_bigrams_version'",
            [],
            |row| row.get::<_, bool>(0),
        )
        .unwrap_or(false)
}

pub(super) fn mark_ready(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT OR REPLACE INTO index_meta(key, value) VALUES ('cjk_bigrams_version', '1')",
        [],
    )?;
    Ok(())
}

pub(super) fn insert(connection: &Connection, row_id: i64, content: &str) -> rusqlite::Result<()> {
    let mut tokens = BTreeSet::new();
    let mut previous = None;
    for current in content.chars() {
        if let Some(first) = previous {
            if is_cjk(first) && is_cjk(current) {
                tokens.insert(format!("u{:x}z{:x}", first as u32, current as u32));
            }
        }
        previous = Some(current);
    }
    if !tokens.is_empty() {
        connection.execute(
            "INSERT INTO content_cjk_bigrams(rowid, tokens) VALUES (?1, ?2)",
            params![row_id, tokens.into_iter().collect::<Vec<_>>().join(" ")],
        )?;
    }
    Ok(())
}

pub(super) fn remove(connection: &Connection, row_id: i64) -> rusqlite::Result<()> {
    connection.execute("DELETE FROM content_cjk_bigrams WHERE rowid = ?1", [row_id])?;
    Ok(())
}

pub(super) fn query(
    connection: &Connection,
    token: &str,
    limit: usize,
) -> rusqlite::Result<Vec<String>> {
    let mut statement = connection.prepare(
        "SELECT indexed_files.relative_path FROM content_cjk_bigrams
        JOIN indexed_files ON indexed_files.id = content_cjk_bigrams.rowid
        WHERE content_cjk_bigrams MATCH ?1 LIMIT ?2",
    )?;
    let rows = statement.query_map(params![token, (limit + 1) as i64], |row| {
        row.get::<_, String>(0)
    })?;
    rows.collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_queries_match_adjacent_chinese_characters_only() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("CREATE TABLE indexed_files(id INTEGER PRIMARY KEY, relative_path TEXT);
            CREATE TABLE index_meta(key TEXT PRIMARY KEY, value TEXT);
            INSERT INTO indexed_files VALUES (1, 'two.txt'), (2, 'long.txt'), (3, 'separated.txt');").unwrap();
        create(&connection).unwrap();
        insert(&connection, 1, "问题").unwrap();
        insert(&connection, 2, "这是问题，另一个问题").unwrap();
        insert(&connection, 3, "问 题").unwrap();
        let needle = token("问题").unwrap();
        assert_eq!(
            query(&connection, &needle, 10).unwrap(),
            vec!["two.txt", "long.txt"]
        );
        assert_eq!(query(&connection, &needle, 1).unwrap().len(), 2);
        remove(&connection, 1).unwrap();
        insert(&connection, 1, "答案").unwrap();
        assert_eq!(query(&connection, &needle, 10).unwrap(), vec!["long.txt"]);
        assert_eq!(
            query(&connection, &token("答案").unwrap(), 10).unwrap(),
            vec!["two.txt"]
        );
        assert!(!ready(&connection));
        mark_ready(&connection).unwrap();
        assert!(ready(&connection));
    }

    #[test]
    fn short_query_classification_handles_unicode_boundaries() {
        assert!(token("𠀀题").is_some());
        for value in ["问", "问题多", "a题", "ab", "问\n题"] {
            assert!(token(value).is_none());
        }
    }
}
