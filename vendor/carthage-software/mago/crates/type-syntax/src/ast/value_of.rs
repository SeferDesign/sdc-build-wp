use serde::Serialize;

use mago_span::HasSpan;
use mago_span::Span;

use crate::ast::generics::SingleGenericParameter;
use crate::ast::keyword::Keyword;

#[derive(Debug, Clone, Eq, PartialEq, Hash, Serialize, PartialOrd, Ord)]
pub struct ValueOfType<'input> {
    pub keyword: Keyword<'input>,
    pub parameter: SingleGenericParameter<'input>,
}

impl HasSpan for ValueOfType<'_> {
    fn span(&self) -> Span {
        self.keyword.span().join(self.parameter.span())
    }
}

impl std::fmt::Display for ValueOfType<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}<{}>", self.keyword, self.parameter)
    }
}
