use std::path::PathBuf;

/// Defines a rule for excluding files or directories from a scan.
#[derive(Debug, Clone, Hash, Eq, PartialEq, PartialOrd, Ord)]
pub enum Exclusion {
    /// Exclude a specific file or directory path.
    Path(PathBuf),
    /// Exclude paths matching a glob pattern.
    Pattern(String),
}
