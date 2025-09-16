use std::str::FromStr;

use serde_json::Error;
use serde_json::from_str;

pub use crate::schema::*;

pub mod schema;

impl FromStr for ComposerPackage {
    type Err = Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        from_str(s)
    }
}
