use serde::Serialize;

use mago_span::HasSpan;
use mago_span::Span;

use crate::token::TypeToken;

#[derive(Debug, Clone, Copy, Eq, PartialEq, Hash, Serialize, PartialOrd, Ord)]
pub struct Identifier<'input> {
    pub span: Span,
    pub value: &'input str,
}

impl HasSpan for Identifier<'_> {
    fn span(&self) -> Span {
        self.span
    }
}

impl<'input> From<TypeToken<'input>> for Identifier<'input> {
    #[inline]
    fn from(token: TypeToken<'input>) -> Self {
        Identifier { span: token.span, value: token.value }
    }
}

impl std::fmt::Display for Identifier<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.value)
    }
}
