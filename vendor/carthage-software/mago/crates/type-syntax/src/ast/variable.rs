use serde::Serialize;

use mago_span::HasSpan;
use mago_span::Span;

use crate::token::TypeToken;
use crate::token::TypeTokenKind;

#[derive(Debug, Clone, Copy, Eq, PartialEq, Hash, Serialize, PartialOrd, Ord)]
pub struct VariableType<'input> {
    pub span: Span,
    pub value: &'input str,
}

impl HasSpan for VariableType<'_> {
    fn span(&self) -> Span {
        self.span
    }
}

impl<'input> From<TypeToken<'input>> for VariableType<'input> {
    #[inline]
    fn from(token: TypeToken<'input>) -> Self {
        debug_assert_eq!(token.kind, TypeTokenKind::Variable);

        VariableType { span: token.span, value: token.value }
    }
}

impl std::fmt::Display for VariableType<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.value)
    }
}
