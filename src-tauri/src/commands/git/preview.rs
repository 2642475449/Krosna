use std::io::Read;
use std::path::Path;

// 两个版本合计最多 16 MiB 原文；在 IPC 和 Monaco 产生副本之前限制读取。
pub(super) const MAX_GIT_PREVIEW_BYTES: usize = 8 * 1024 * 1024;

fn too_large() -> String {
    "FILE_PREVIEW_TOO_LARGE:git:8".to_string()
}

pub(super) fn check_blob_size(repo: &git2::Repository, oid: git2::Oid) -> Result<(), String> {
    // 先查对象头，不能先 find_blob 再检查：后者可能已经解压整个对象。
    let (size, _) = repo
        .odb()
        .and_then(|odb| odb.read_header(oid))
        .map_err(|e| e.to_string())?;
    if size > MAX_GIT_PREVIEW_BYTES {
        return Err(too_large());
    }
    Ok(())
}

pub(super) fn read_blob(repo: &git2::Repository, oid: git2::Oid) -> Result<Vec<u8>, String> {
    check_blob_size(repo, oid)?;
    let blob = repo.find_blob(oid).map_err(|e| e.to_string())?;
    Ok(blob.content().to_vec())
}

fn read_bounded(reader: impl Read) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader
        .take(MAX_GIT_PREVIEW_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > MAX_GIT_PREVIEW_BYTES {
        return Err(too_large());
    }
    Ok(bytes)
}

pub(super) fn read_file(path: &Path) -> Result<Vec<u8>, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() > MAX_GIT_PREVIEW_BYTES as u64 {
        return Err(too_large());
    }
    // 文件可能在 metadata 检查后继续增长，读取也必须带硬上限。
    read_bounded(file)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oversized_sparse_worktree_file_is_rejected_before_reading() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("large.log");
        std::fs::File::create(&path)
            .unwrap()
            .set_len(1024 * 1024 * 1024)
            .unwrap();
        assert_eq!(read_file(&path).unwrap_err(), too_large());
    }

    #[test]
    fn growing_stream_stops_at_the_budget_plus_one_byte() {
        let mut reader = std::io::repeat(b'x').take((MAX_GIT_PREVIEW_BYTES * 2) as u64);
        assert_eq!(read_bounded(&mut reader).unwrap_err(), too_large());
        assert_eq!(reader.limit(), MAX_GIT_PREVIEW_BYTES as u64 - 1);
        assert_eq!(
            read_bounded(std::io::Cursor::new(b"small")).unwrap(),
            b"small"
        );
    }

    #[test]
    fn git_object_headers_reject_large_blobs_and_accept_the_boundary() {
        let dir = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(dir.path()).unwrap();
        let bytes = vec![b'x'; MAX_GIT_PREVIEW_BYTES + 1];
        let large = repo.blob(&bytes).unwrap();
        assert_eq!(read_blob(&repo, large).unwrap_err(), too_large());
        let boundary = repo.blob(&bytes[..MAX_GIT_PREVIEW_BYTES]).unwrap();
        assert_eq!(
            read_blob(&repo, boundary).unwrap().len(),
            MAX_GIT_PREVIEW_BYTES
        );
    }
}
