//! Utilities for loading files into the `mago_database`.
//!
//! This module provides high-level functions for creating a `Database` instance
//! from either a `SourceConfiguration` or a direct list of file paths.

use std::mem;
use std::path::Path;
use std::path::PathBuf;

use mago_database::Database;
use mago_database::exclusion::Exclusion;
use mago_database::loader::DatabaseLoader;

use crate::config::source::SourceConfiguration;
use crate::error::Error;

/// Loads files into a `Database` from a list of specified paths.
///
/// This function is useful for one-off analysis of specific files provided
/// via the command line.
///
/// # Arguments
///
/// * `configuration`: The source configuration, used for workspace root and extensions.
/// * `paths`: An explicit list of file or directory paths to load.
/// * `existing_db`: An optional existing `Database` to extend.
pub fn load_from_paths(
    configuration: &mut SourceConfiguration,
    paths: Vec<PathBuf>,
    existing_db: Option<Database>,
) -> Result<Database, Error> {
    let mut loader = DatabaseLoader::new(
        configuration.workspace.clone(),
        paths,
        vec![],
        vec![],
        mem::take(&mut configuration.extensions),
    );

    if let Some(db) = existing_db {
        loader = loader.with_database(db);
    }

    loader.load().map_err(Error::Database)
}

/// Loads files into a `Database` based on the full source configuration.
///
/// This is the primary function for loading a project according to the rules
/// defined in a `mago.toml` file. To avoid expensive clones, this function
/// takes ownership of the vector fields from the configuration.
///
/// # Arguments
///
/// * `configuration`: A mutable reference to the source configuration.
/// * `include_externals`: Whether to include paths from the `includes` configuration.
/// * `existing_db`: An optional existing `Database` to extend.
pub fn load_from_configuration(
    configuration: &mut SourceConfiguration,
    include_externals: bool,
    existing_db: Option<Database>,
) -> Result<Database, Error> {
    let mut loader = DatabaseLoader::new(
        configuration.workspace.clone(),
        mem::take(&mut configuration.paths),
        if include_externals { mem::take(&mut configuration.includes) } else { vec![] },
        create_excludes_from_patterns(mem::take(&mut configuration.excludes), &configuration.workspace),
        mem::take(&mut configuration.extensions),
    );

    if let Some(db) = existing_db {
        loader = loader.with_database(db);
    }

    loader.load().map_err(Error::Database)
}

/// Converts string patterns from the configuration into `Exclusion` types.
fn create_excludes_from_patterns(patterns: Vec<String>, root: &Path) -> Vec<Exclusion> {
    patterns
        .into_iter()
        .map(|pattern| {
            if pattern.contains('*') {
                if let Some(stripped) = pattern.strip_prefix("./") {
                    let rooted_pattern = root.join(stripped).to_string_lossy().into_owned();

                    Exclusion::Pattern(rooted_pattern)
                } else {
                    Exclusion::Pattern(pattern)
                }
            } else {
                let path = PathBuf::from(pattern);
                let path_buf = if path.is_absolute() { path } else { root.join(path) };

                Exclusion::Path(path_buf.canonicalize().unwrap_or(path_buf))
            }
        })
        .collect()
}
