use std::sync::atomic::{AtomicU64, Ordering};

use sha2::{Digest, Sha256};

static UNIQUE_HASH_SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub fn hash_text(value: &str) -> String {
    let digest = Sha256::digest(value.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub fn unique_hash(value: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    hash_text(&format!(
        "{value}:{nanos}:{}",
        UNIQUE_HASH_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ))
}

#[cfg(test)]
mod tests {
    use super::unique_hash;

    #[test]
    fn unique_hashes_do_not_collide_for_the_same_value() {
        assert_ne!(unique_hash("note"), unique_hash("note"));
    }
}
