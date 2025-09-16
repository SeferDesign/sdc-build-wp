use std::borrow::Cow;
use std::collections::HashSet;
use std::ffi::OsString;
use std::path::Path;
use std::path::PathBuf;

use globset::Glob;
use globset::GlobSet;
use globset::GlobSetBuilder;
use rayon::prelude::*;
use walkdir::WalkDir;

use crate::Database;
use crate::error::DatabaseError;
use crate::exclusion::Exclusion;
use crate::file::File;
use crate::file::FileType;
use crate::utils::read_file;

/// Configures and builds a `Database` by scanning the filesystem and memory.
pub struct DatabaseLoader {
    database: Option<Database>,
    workspace: PathBuf,
    paths: Vec<PathBuf>,
    includes: Vec<PathBuf>,
    excludes: Vec<Exclusion>,
    memory_sources: Vec<(&'static str, &'static str, FileType)>,
    extensions: Vec<String>,
}

impl DatabaseLoader {
    /// Creates a new loader with the given configuration.
    ///
    /// All provided exclusion paths are canonicalized relative to the workspace
    /// upon creation to ensure they are matched correctly.
    pub fn new(
        workspace: PathBuf,
        paths: Vec<PathBuf>,
        includes: Vec<PathBuf>,
        excludes: Vec<Exclusion>,
        extensions: Vec<String>,
    ) -> Self {
        let paths = canonicalize_paths(&workspace, paths);
        let includes = canonicalize_paths(&workspace, includes);

        let excludes = excludes
            .into_iter()
            .filter_map(|exclusion| match exclusion {
                Exclusion::Path(p) => {
                    let absolute_path = if p.is_absolute() { p } else { workspace.join(p) };
                    match absolute_path.canonicalize() {
                        Ok(canonical_p) => Some(Exclusion::Path(canonical_p)),
                        Err(_) => {
                            tracing::warn!("Ignoring invalid exclusion path: {}", absolute_path.display());
                            None
                        }
                    }
                }
                Exclusion::Pattern(pat) => Some(Exclusion::Pattern(pat)),
            })
            .collect();

        Self { workspace, paths, includes, excludes, memory_sources: vec![], extensions, database: None }
    }

    /// Sets a pre-existing database to populate.
    pub fn with_database(mut self, database: Database) -> Self {
        self.database = Some(database);
        self
    }

    /// Adds a memory source to the loader.
    ///
    /// This allows you to include files that are not on the filesystem but should be part of the database.
    ///
    /// # Arguments
    ///
    /// * `name` - The logical name of the file, typically its path relative to the workspace.
    /// * `contents` - The contents of the file as a string.
    /// * `file_type` - The type of the file, indicating whether it's a host file or a vendored file.
    pub fn add_memory_source(&mut self, name: &'static str, contents: &'static str, file_type: FileType) {
        self.memory_sources.push((name, contents, file_type));
    }

    /// Scans sources according to the configuration and builds a `Database`.
    pub fn load(mut self) -> Result<Database, DatabaseError> {
        let mut db = self.database.take().unwrap_or_default();
        let extensions_set: HashSet<OsString> = self.extensions.iter().map(OsString::from).collect();

        let mut glob_builder = GlobSetBuilder::new();
        for ex in &self.excludes {
            if let Exclusion::Pattern(pat) = ex {
                glob_builder.add(Glob::new(pat)?);
            }
        }

        let glob_excludes = glob_builder.build()?;

        let path_excludes: HashSet<_> = self
            .excludes
            .iter()
            .filter_map(|ex| match ex {
                Exclusion::Path(p) => Some(p),
                _ => None,
            })
            .collect();

        let host_files =
            self.load_paths(&self.paths, FileType::Host, &extensions_set, &glob_excludes, &path_excludes)?;
        let vendored_files =
            self.load_paths(&self.includes, FileType::Vendored, &extensions_set, &glob_excludes, &path_excludes)?;

        for file in host_files.into_iter().chain(vendored_files.into_iter()) {
            db.add(file);
        }

        for (name, contents, file_type) in self.memory_sources {
            let file = File::new(Cow::Borrowed(name), file_type, None, Cow::Borrowed(contents));

            db.add(file);
        }

        Ok(db)
    }

    /// Discovers and reads all files from a set of root paths in parallel.
    fn load_paths(
        &self,
        roots: &[PathBuf],
        file_type: FileType,
        extensions: &HashSet<OsString>,
        glob_excludes: &GlobSet,
        path_excludes: &HashSet<&PathBuf>,
    ) -> Result<Vec<File>, DatabaseError> {
        let mut paths_to_process = Vec::new();
        for root in roots {
            for entry in WalkDir::new(root).into_iter().filter_map(Result::ok) {
                if entry.file_type().is_file() {
                    paths_to_process.push(entry.into_path());
                }
            }
        }

        let files: Vec<File> = paths_to_process
            .into_par_iter()
            .filter_map(|path| {
                if glob_excludes.is_match(&path) {
                    return None;
                }

                if let Ok(canonical_path) = path.canonicalize()
                    && path_excludes.iter().any(|excluded| canonical_path.starts_with(excluded))
                {
                    return None;
                }

                if let Some(ext) = path.extension() {
                    if !extensions.contains(ext) {
                        return None;
                    }
                } else {
                    return None;
                }

                match read_file(&self.workspace, &path, file_type) {
                    Ok(file) => Some(Ok(file)),
                    Err(e) => Some(Err(e)),
                }
            })
            .collect::<Result<Vec<File>, _>>()?;

        Ok(files)
    }
}

/// A helper function to canonicalize a vector of paths relative to a workspace.
///
/// It handles both absolute and relative paths and logs a warning for any
/// path that cannot be resolved, filtering it out from the final result.
fn canonicalize_paths(workspace: &Path, paths: Vec<PathBuf>) -> Vec<PathBuf> {
    paths
        .into_iter()
        .filter_map(|p| {
            let absolute_path = if p.is_absolute() { p } else { workspace.join(p) };

            match absolute_path.canonicalize() {
                Ok(canonical_p) => Some(canonical_p),
                Err(_) => {
                    tracing::warn!("Ignoring invalid or non-existent path: {}", absolute_path.display());
                    None
                }
            }
        })
        .collect()
}
