use serde::Serialize;

use mago_span::HasSpan;
use mago_span::Span;

use crate::ast::generics::SingleGenericParameter;
use crate::ast::keyword::Keyword;

#[derive(Debug, Clone, Eq, PartialEq, Hash, Serialize, PartialOrd, Ord)]
pub struct ClassStringType<'input> {
    pub keyword: Keyword<'input>,
    pub parameter: Option<SingleGenericParameter<'input>>,
}

#[derive(Debug, Clone, Eq, PartialEq, Hash, Serialize, PartialOrd, Ord)]
pub struct InterfaceStringType<'input> {
    pub keyword: Keyword<'input>,
    pub parameter: Option<SingleGenericParameter<'input>>,
}

#[derive(Debug, Clone, Eq, PartialEq, Hash, Serialize, PartialOrd, Ord)]
pub struct EnumStringType<'input> {
    pub keyword: Keyword<'input>,
    pub parameter: Option<SingleGenericParameter<'input>>,
}

#[derive(Debug, Clone, Eq, PartialEq, Hash, Serialize, PartialOrd, Ord)]
pub struct TraitStringType<'input> {
    pub keyword: Keyword<'input>,
    pub parameter: Option<SingleGenericParameter<'input>>,
}

impl HasSpan for ClassStringType<'_> {
    fn span(&self) -> Span {
        match &self.parameter {
            Some(parameter) => self.keyword.span.join(parameter.span()),
            None => self.keyword.span,
        }
    }
}

impl HasSpan for InterfaceStringType<'_> {
    fn span(&self) -> Span {
        match &self.parameter {
            Some(parameter) => self.keyword.span.join(parameter.span()),
            None => self.keyword.span,
        }
    }
}

impl HasSpan for EnumStringType<'_> {
    fn span(&self) -> Span {
        match &self.parameter {
            Some(parameter) => self.keyword.span.join(parameter.span()),
            None => self.keyword.span,
        }
    }
}

impl HasSpan for TraitStringType<'_> {
    fn span(&self) -> Span {
        match &self.parameter {
            Some(parameter) => self.keyword.span.join(parameter.span()),
            None => self.keyword.span,
        }
    }
}

impl std::fmt::Display for ClassStringType<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if let Some(parameter) = &self.parameter {
            write!(f, "{}<{}>", self.keyword, parameter)
        } else {
            write!(f, "{}", self.keyword)
        }
    }
}

impl std::fmt::Display for InterfaceStringType<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if let Some(parameter) = &self.parameter {
            write!(f, "{}<{}>", self.keyword, parameter)
        } else {
            write!(f, "{}", self.keyword)
        }
    }
}

impl std::fmt::Display for EnumStringType<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if let Some(parameter) = &self.parameter {
            write!(f, "{}<{}>", self.keyword, parameter)
        } else {
            write!(f, "{}", self.keyword)
        }
    }
}

impl std::fmt::Display for TraitStringType<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if let Some(parameter) = &self.parameter {
            write!(f, "{}<{}>", self.keyword, parameter)
        } else {
            write!(f, "{}", self.keyword)
        }
    }
}
