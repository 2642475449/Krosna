use super::{
    compare_search_matches, display_path, project_entry_match_score, push_search_match,
    FileTreeEntry, FileTreeEntryKind, ProjectEntrySearchMatch,
};
use rusqlite::Connection;
use std::collections::HashSet;
use std::path::{Component, Path};

// 复用路径表而不是全文 FTS，支持中文短词、模糊名称及跳过正文索引的二进制文件。
// 此函数不访问项目文件系统，变更统一由现有索引后台更新器维护。
pub(super) fn search(
    connection: &Connection,
    root: &Path,
    query: &str,
) -> Result<Vec<FileTreeEntry>, String> {
    let keyword = query.trim().to_lowercase().replace('\\', "/");
    if keyword.is_empty() {
        return Ok(Vec::new());
    }
    let mut matches = Vec::new();
    let mut directories = HashSet::new();
    let mut consider = |relative: &str, kind: FileTreeEntryKind| {
        let name = relative.rsplit('/').next().unwrap_or(relative);
        let Some(score) = project_entry_match_score(name, relative, &keyword) else {
            return;
        };
        push_search_match(
            &mut matches,
            ProjectEntrySearchMatch {
                entry: FileTreeEntry {
                    name: name.to_string(),
                    path: display_path(&root.join(relative)),
                    has_children: matches!(kind, FileTreeEntryKind::Directory),
                    kind,
                    ignored: false,
                },
                score,
                depth: relative.matches('/').count(),
            },
        );
    };
    let mut statement = connection
        .prepare("SELECT relative_path FROM indexed_files")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    for relative in rows {
        let relative = relative.map_err(|error| error.to_string())?;
        // 异常索引记录不能越出项目，无需逐文件 stat。
        if relative.is_empty()
            || relative.contains('\\')
            || !Path::new(&relative)
                .components()
                .all(|part| matches!(part, Component::Normal(_)))
        {
            continue;
        }
        consider(&relative, FileTreeEntryKind::File);
        // 父目录从索引路径派生，不再 read_dir 或检查 has_children。
        let mut parent = relative.as_str();
        while let Some((directory, _)) = parent.rsplit_once('/') {
            if !directories.insert(directory.to_string()) {
                break;
            }
            consider(directory, FileTreeEntryKind::Directory);
            parent = directory;
        }
    }
    matches.sort_by(compare_search_matches);
    Ok(matches.into_iter().map(|result| result.entry).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn index(paths: &[&str]) -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch("CREATE TABLE indexed_files(relative_path TEXT UNIQUE, status TEXT);")
            .unwrap();
        for path in paths {
            connection
                .execute("INSERT INTO indexed_files VALUES (?1, 'skipped')", [path])
                .unwrap();
        }
        connection
    }

    #[test]
    fn searches_saved_index_without_accessing_project_files() {
        let connection = index(&[
            "资料/问题.md",
            "资料/问题截图.png",
            "src/TitleBarQuickSearch.tsx",
        ]);
        let root = Path::new("/project-that-does-not-exist");
        let results = search(&connection, root, "问题").unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].name, "问题.md");
        assert_eq!(
            search(&connection, root, "tbqs").unwrap()[0].name,
            "TitleBarQuickSearch.tsx"
        );
        assert_eq!(search(&connection, root, "资料/问题").unwrap().len(), 2);
        let results = search(&connection, root, "资料").unwrap();
        let folders: Vec<_> = results
            .iter()
            .filter(|entry| entry.kind == FileTreeEntryKind::Directory)
            .collect();
        assert_eq!(folders.len(), 1);
        assert!(folders[0].has_children);
    }

    #[test]
    fn index_changes_are_visible_on_next_query_without_separate_cache() {
        let connection = index(&["old.md"]);
        let root = Path::new("/missing-project");
        assert_eq!(search(&connection, root, "old").unwrap().len(), 1);
        connection
            .execute("UPDATE indexed_files SET relative_path = 'new.md'", [])
            .unwrap();
        assert!(search(&connection, root, "old").unwrap().is_empty());
        assert_eq!(search(&connection, root, "new").unwrap().len(), 1);
        connection.execute("DELETE FROM indexed_files", []).unwrap();
        assert!(search(&connection, root, "new").unwrap().is_empty());
    }

    #[test]
    fn rejects_paths_outside_project_and_keeps_result_limit() {
        let connection = index(&["../outside.txt", "/outside.txt", "C:\\outside.txt"]);
        assert!(search(&connection, Path::new("/project"), "outside")
            .unwrap()
            .is_empty());
        for index in 0..250 {
            connection
                .execute(
                    "INSERT INTO indexed_files VALUES (?1, 'indexed')",
                    [format!("file-{index}.ts")],
                )
                .unwrap();
        }
        assert_eq!(
            search(&connection, Path::new("/project"), "file")
                .unwrap()
                .len(),
            200
        );
    }
}
