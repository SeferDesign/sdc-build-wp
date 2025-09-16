use std::error::Error;
use std::num::ParseIntError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParsingError {
    InvalidFormat,
    ParseIntError(ParseIntError),
}

impl std::fmt::Display for ParsingError {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            Self::InvalidFormat => write!(f, "Invalid version format, expected 'major.minor.patch'."),
            Self::ParseIntError(e) => write!(f, "Failed to parse integer component of version: {e}."),
        }
    }
}

impl Error for ParsingError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::ParseIntError(e) => Some(e),
            _ => None,
        }
    }
}

impl From<ParseIntError> for ParsingError {
    fn from(e: ParseIntError) -> Self {
        Self::ParseIntError(e)
    }
}
