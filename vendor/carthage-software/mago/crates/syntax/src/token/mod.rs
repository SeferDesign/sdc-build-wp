use serde::Serialize;
use strum::Display;

use mago_span::Span;

use crate::T;

#[derive(Debug, Clone, Copy, Eq, PartialEq, Hash, Serialize, PartialOrd, Ord, Display)]
#[serde(tag = "type", content = "value")]
pub enum DocumentKind {
    Heredoc,
    Nowdoc,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Hash, Serialize, PartialOrd, Ord, Display)]
#[serde(tag = "type", content = "value")]
pub enum Associativity {
    NonAssociative,
    Left,
    Right,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Hash, Serialize, PartialOrd, Ord, Display)]
#[serde(tag = "type", content = "value")]
pub enum Precedence {
    Lowest,
    Print,
    YieldFrom,
    Yield,
    KeyOr,
    KeyXor,
    KeyAnd,
    Assignment,
    ElvisOrConditional,
    NullCoalesce,
    Or,
    And,
    BitwiseOr,
    BitwiseXor,
    BitwiseAnd,
    Equality,
    Comparison,
    // NOTE(azjezz): the RFC does not really specify the precedence of the `|>` operator
    // clearly, the current precedence position handles the examples shown in the RFC,
    // but will need to be verified with the actual implementation once its merged into php-src.
    //
    // RFC: https://wiki.php.net/rfc/pipe-operator-v3
    // PR: https://github.com/php/php-src/pull/17118
    Pipe,
    Concat,
    BitShift,
    AddSub,
    MulDivMod,
    Unary,
    Instanceof,
    ErrorControl,
    Pow,
    Clone,
    IncDec,
    Reference,
    CallDim,
    New,
    ArrayDim,
    ObjectAccess,
    Highest,
}

pub trait GetPrecedence {
    fn precedence(&self) -> Precedence;
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Hash, Serialize, PartialOrd, Ord, Display)]
#[serde(tag = "type", content = "value")]
pub enum TokenKind {
    Whitespace,                  // ` `
    Eval,                        // `eval`
    Die,                         // `die`
    Self_,                       // `self`
    Parent,                      // `parent`
    Backtick,                    // `` ` ``
    DocumentStart(DocumentKind), // `<<<abc`, or `<<<'abc'`
    DocumentEnd,                 // `abc`
    From,                        // `from`
    Print,                       // `print`
    Dollar,                      // `$`
    HaltCompiler,                // `__halt_compiler`
    Readonly,                    // `readonly`
    Global,                      // `global`
    Abstract,                    // `abstract`
    Ampersand,                   // `&`
    AmpersandEqual,              // `&=`
    AmpersandAmpersand,          // `&&`
    AmpersandAmpersandEqual,     // `&&=`
    Array,                       // `array`
    ArrayCast,                   // `(array)`
    MinusGreaterThan,            // `->`
    QuestionMinusGreaterThan,    // `?->`
    At,                          // `@`
    As,                          // `as`
    Asterisk,                    // `*`
    HashLeftBracket,             // `#[`
    Bang,                        // `!`
    BangEqual,                   // `!=`
    LessThanGreaterThan,         // `<>`
    BangEqualEqual,              // `!==`
    LessThanEqualGreaterThan,    // `<=>`
    BoolCast,                    // `(bool)`
    BooleanCast,                 // `(boolean)`
    And,                         // `and`
    Or,                          // `or`
    Break,                       // `break`
    Callable,                    // `callable`
    Caret,                       // `^`
    CaretEqual,                  // `^=`
    Case,                        // `case`
    Catch,                       // `catch`
    Class,                       // `class`
    ClassConstant,               // `__CLASS__`
    TraitConstant,               // `__TRAIT__`
    FunctionConstant,            // `__FUNCTION__`
    MethodConstant,              // `__METHOD__`
    LineConstant,                // `__LINE__`
    FileConstant,                // `__FILE__`
    Clone,                       // `clone`
    MinusEqual,                  // `-=`
    CloseTag,                    // `?>`
    QuestionQuestion,            // `??`
    QuestionQuestionEqual,       // `??=`
    AsteriskEqual,               // `*=`
    Colon,                       // `:`
    Comma,                       // `,`
    SingleLineComment,           // `// comment`
    HashComment,                 // `# comment`
    MultiLineComment,            // `/* comment */`
    DocBlockComment,             // `/** comment */`
    Const,                       // `const`
    PartialLiteralString,        // `"string` or `'string`, missing closing quote
    LiteralString,               // `"string"` or `'string'`
    Continue,                    // `continue`
    Declare,                     // `declare`
    MinusMinus,                  // `--`
    Default,                     // `default`
    DirConstant,                 // `__DIR__`
    SlashEqual,                  // `/=`
    Do,                          // `do`
    DollarLeftBrace,             // `${`
    Dot,                         // `.`
    DotEqual,                    // `.=`
    EqualGreaterThan,            // `=>`
    DoubleCast,                  // `(double)`
    RealCast,                    // `(real)`
    FloatCast,                   // `(float)`
    ColonColon,                  // `::`
    EqualEqual,                  // `==`
    DoubleQuote,                 // `"`
    Else,                        // `else`
    Echo,                        // `echo`
    DotDotDot,                   // `...`
    ElseIf,                      // `elseif`
    Empty,                       // `empty`
    EndDeclare,                  // `enddeclare`
    EndFor,                      // `endfor`
    EndForeach,                  // `endforeach`
    EndIf,                       // `endif`
    EndSwitch,                   // `endswitch`
    EndWhile,                    // `endwhile`
    Enum,                        // `enum`
    Equal,                       // `=`
    Extends,                     // `extends`
    False,                       // `false`
    Final,                       // `final`
    Finally,                     // `finally`
    LiteralFloat,                // `1.0`
    Fn,                          // `fn`
    For,                         // `for`
    Foreach,                     // `foreach`
    FullyQualifiedIdentifier,    // `\Namespace\Class`
    Function,                    // `function`
    Goto,                        // `goto`
    GreaterThan,                 // `>`
    GreaterThanEqual,            // `>=`
    Identifier,                  // `name`
    If,                          // `if`
    Implements,                  // `implements`
    Include,                     // `include`
    IncludeOnce,                 // `include_once`
    PlusPlus,                    // `++`
    InlineText,                  // inline text outside of PHP tags, also referred to as "HTML"
    InlineShebang,               // `#!...`
    Instanceof,                  // `instanceof`
    Insteadof,                   // `insteadof`
    Exit,                        // `exit`
    Unset,                       // `unset`
    Isset,                       // `isset`
    List,                        // `list`
    LiteralInteger,              // `1`
    IntCast,                     // `(int)`
    IntegerCast,                 // `(integer)`
    Interface,                   // `interface`
    LeftBrace,                   // `{`
    LeftBracket,                 // `[`
    LeftParenthesis,             // `(`
    LeftShift,                   // `<<`
    LeftShiftEqual,              // `<<=`
    RightShift,                  // `>>`
    RightShiftEqual,             // `>>=`
    LessThan,                    // `<`
    LessThanEqual,               // `<=`
    Match,                       // `match`
    Minus,                       // `-`
    Namespace,                   // `namespace`
    NamespaceSeparator,          // `\`
    NamespaceConstant,           // `__NAMESPACE__`
    New,                         // `new`
    Null,                        // `null`
    ObjectCast,                  // `(object)`
    UnsetCast,                   // `(unset)`
    OpenTag,                     // `<?php`
    EchoTag,                     // `<?=`
    ShortOpenTag,                // `<?`
    Percent,                     // `%`
    PercentEqual,                // `%=`
    Pipe,                        // `|`
    PipeEqual,                   // `|=`
    Plus,                        // `+`
    PlusEqual,                   // `+=`
    AsteriskAsterisk,            // `**`
    AsteriskAsteriskEqual,       // `**=`
    Private,                     // `private`
    PrivateSet,                  // `private(set)`
    Protected,                   // `protected`
    ProtectedSet,                // `protected(set)`
    Public,                      // `public`
    PublicSet,                   // `public(set)`
    QualifiedIdentifier,         // `Namespace\Class`
    Question,                    // `?`
    Require,                     // `require`
    RequireOnce,                 // `require_once`
    Return,                      // `return`
    RightBrace,                  // `}`
    RightBracket,                // `]`
    RightParenthesis,            // `)`
    Semicolon,                   // `;`
    Slash,                       // `/`
    Static,                      // `static`
    StringCast,                  // `(string)`
    BinaryCast,                  // `(binary)`
    VoidCast,                    // `(void)`
    StringPart,                  // `string` inside a double-quoted string, or a document string
    Switch,                      // `switch`
    Throw,                       // `throw`
    Trait,                       // `trait`
    EqualEqualEqual,             // `===`
    True,                        // `true`
    Try,                         // `try`
    Use,                         // `use`
    Var,                         // `var`
    Variable,                    // `$name`
    Yield,                       // `yield`
    While,                       // `while`
    Tilde,                       // `~`
    PipePipe,                    // `||`
    Xor,                         // `xor`
    PipeGreaterThan,             // `|>`
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Hash, Serialize, PartialOrd, Ord)]
pub struct Token<'arena> {
    pub kind: TokenKind,
    pub value: &'arena str,
    pub span: Span,
}

impl Precedence {
    #[inline]
    pub const fn infix(kind: &TokenKind) -> Precedence {
        match kind {
            T!["**"] => Precedence::Pow,
            T!["instanceof"] => Precedence::Instanceof,
            T!["*" | "/" | "%"] => Precedence::MulDivMod,
            T!["+" | "-"] => Precedence::AddSub,
            T!["<<"] | T![">>"] => Precedence::BitShift,
            T!["."] => Precedence::Concat,
            T!["<" | "<=" | ">" | ">="] => Precedence::Comparison,
            T!["==" | "!=" | "===" | "!==" | "<>" | "<=>"] => Precedence::Equality,
            T!["&"] => Precedence::BitwiseAnd,
            T!["^"] => Precedence::BitwiseXor,
            T!["|"] => Precedence::BitwiseOr,
            T!["&&"] => Precedence::And,
            T!["||"] => Precedence::Or,
            T!["??"] => Precedence::NullCoalesce,
            T!["?"] => Precedence::ElvisOrConditional,
            T!["="
                | "+="
                | "-="
                | "*="
                | "**="
                | "/="
                | ".="
                | "&&="
                | "??="
                | "%="
                | "&="
                | "|="
                | "^="
                | "<<="
                | ">>="] => Precedence::Assignment,
            T!["yield"] => Precedence::Yield,
            T!["and"] => Precedence::KeyAnd,
            T!["or"] => Precedence::KeyOr,
            T!["xor"] => Precedence::KeyXor,
            T!["print"] => Precedence::Print,
            T!["|>"] => Precedence::Pipe,
            _ => Precedence::Lowest,
        }
    }

    #[inline]
    pub const fn postfix(kind: &TokenKind) -> Self {
        match kind {
            T!["++" | "--"] => Self::IncDec,
            T!["("] => Self::CallDim,
            T!["["] => Self::ArrayDim,
            T!["->" | "?->" | "::"] => Self::ObjectAccess,
            _ => Self::Lowest,
        }
    }

    #[inline]
    pub const fn associativity(&self) -> Option<Associativity> {
        Some(match self {
            Self::MulDivMod
            | Self::AddSub
            | Self::Concat
            | Self::BitShift
            | Self::BitwiseAnd
            | Self::BitwiseOr
            | Self::BitwiseXor
            | Self::And
            | Self::Or
            | Self::KeyAnd
            | Self::KeyXor
            | Self::KeyOr
            | Self::Pipe
            | Self::ElvisOrConditional
            | Self::ObjectAccess => Associativity::Left,
            Self::Pow | Self::NullCoalesce | Self::Assignment | Self::Unary | Self::New => Associativity::Right,
            Self::Equality | Self::Comparison | Self::Instanceof => Associativity::NonAssociative,
            _ => return None,
        })
    }

    #[inline]
    pub const fn is_associative(&self) -> bool {
        self.associativity().is_some()
    }

    #[inline]
    pub const fn is_right_associative(&self) -> bool {
        matches!(self.associativity(), Some(Associativity::Right))
    }

    #[inline]
    pub const fn is_left_associative(&self) -> bool {
        matches!(self.associativity(), Some(Associativity::Left))
    }

    #[inline]
    pub const fn is_non_associative(&self) -> bool {
        matches!(self.associativity(), Some(Associativity::NonAssociative))
    }
}

impl TokenKind {
    #[inline]
    pub const fn is_keyword(&self) -> bool {
        matches!(
            self,
            TokenKind::Eval
                | TokenKind::Die
                | TokenKind::Empty
                | TokenKind::Isset
                | TokenKind::Unset
                | TokenKind::Exit
                | TokenKind::EndDeclare
                | TokenKind::EndSwitch
                | TokenKind::EndWhile
                | TokenKind::EndForeach
                | TokenKind::EndFor
                | TokenKind::EndIf
                | TokenKind::From
                | TokenKind::And
                | TokenKind::Or
                | TokenKind::Xor
                | TokenKind::Print
                | TokenKind::Readonly
                | TokenKind::Global
                | TokenKind::Match
                | TokenKind::Abstract
                | TokenKind::Array
                | TokenKind::As
                | TokenKind::Break
                | TokenKind::Case
                | TokenKind::Catch
                | TokenKind::Class
                | TokenKind::Clone
                | TokenKind::Continue
                | TokenKind::Const
                | TokenKind::Declare
                | TokenKind::Default
                | TokenKind::Do
                | TokenKind::Echo
                | TokenKind::ElseIf
                | TokenKind::Else
                | TokenKind::Enum
                | TokenKind::Extends
                | TokenKind::False
                | TokenKind::Finally
                | TokenKind::Final
                | TokenKind::Fn
                | TokenKind::Foreach
                | TokenKind::For
                | TokenKind::Function
                | TokenKind::Goto
                | TokenKind::If
                | TokenKind::IncludeOnce
                | TokenKind::Include
                | TokenKind::Implements
                | TokenKind::Interface
                | TokenKind::Instanceof
                | TokenKind::Namespace
                | TokenKind::New
                | TokenKind::Null
                | TokenKind::Private
                | TokenKind::PrivateSet
                | TokenKind::Protected
                | TokenKind::Public
                | TokenKind::RequireOnce
                | TokenKind::Require
                | TokenKind::Return
                | TokenKind::Static
                | TokenKind::Switch
                | TokenKind::Throw
                | TokenKind::Trait
                | TokenKind::True
                | TokenKind::Try
                | TokenKind::Use
                | TokenKind::Var
                | TokenKind::Yield
                | TokenKind::While
                | TokenKind::Insteadof
                | TokenKind::List
                | TokenKind::Self_
                | TokenKind::Parent
                | TokenKind::DirConstant
                | TokenKind::FileConstant
                | TokenKind::LineConstant
                | TokenKind::FunctionConstant
                | TokenKind::ClassConstant
                | TokenKind::MethodConstant
                | TokenKind::TraitConstant
                | TokenKind::NamespaceConstant
                | TokenKind::HaltCompiler
        )
    }

    #[inline]
    pub const fn is_infix(&self) -> bool {
        matches!(
            self,
            T!["**"
                | ">>="
                | "<<="
                | "^="
                | "&="
                | "|="
                | "%="
                | "**="
                | "and"
                | "or"
                | "xor"
                | "<=>"
                | "<<"
                | ">>"
                | "&"
                | "|"
                | "^"
                | "%"
                | "instanceof"
                | "*"
                | "/"
                | "+"
                | "-"
                | "."
                | "<"
                | ">"
                | "<="
                | ">="
                | "=="
                | "==="
                | "!="
                | "!=="
                | "<>"
                | "?"
                | "&&"
                | "||"
                | "="
                | "+="
                | "-="
                | ".="
                | "??="
                | "/="
                | "*="
                | "??"
                | "|>"]
        )
    }

    #[inline]
    pub const fn is_postfix(&self) -> bool {
        matches!(self, T!["++" | "--" | "(" | "[" | "->" | "?->" | "::"])
    }

    #[inline]
    pub const fn is_visibility_modifier(&self) -> bool {
        matches!(self, T!["public" | "protected" | "private" | "private(set)" | "protected(set)" | "public(set)"])
    }

    #[inline]
    pub const fn is_modifier(&self) -> bool {
        matches!(
            self,
            T!["public"
                | "protected"
                | "private"
                | "private(set)"
                | "protected(set)"
                | "public(set)"
                | "static"
                | "final"
                | "abstract"
                | "readonly"]
        )
    }

    #[inline]
    pub const fn is_identifier_maybe_soft_reserved(&self) -> bool {
        if let TokenKind::Identifier = self { true } else { self.is_soft_reserved_identifier() }
    }

    #[inline]
    pub const fn is_identifier_maybe_reserved(&self) -> bool {
        if let TokenKind::Identifier = self { true } else { self.is_reserved_identifier() }
    }

    #[inline]
    pub const fn is_soft_reserved_identifier(&self) -> bool {
        matches!(
            self,
            T!["parent" | "self" | "true" | "false" | "list" | "null" | "enum" | "from" | "readonly" | "match"]
        )
    }

    #[inline]
    pub const fn is_reserved_identifier(&self) -> bool {
        if self.is_soft_reserved_identifier() {
            return true;
        }

        matches!(
            self,
            T!["static"
                | "abstract"
                | "final"
                | "for"
                | "private"
                | "private(set)"
                | "protected"
                | "protected(set)"
                | "public"
                | "public(set)"
                | "include"
                | "include_once"
                | "eval"
                | "require"
                | "require_once"
                | "or"
                | "xor"
                | "and"
                | "instanceof"
                | "new"
                | "clone"
                | "exit"
                | "die"
                | "if"
                | "elseif"
                | "else"
                | "endif"
                | "echo"
                | "do"
                | "while"
                | "endwhile"
                | "endfor"
                | "foreach"
                | "endforeach"
                | "declare"
                | "enddeclare"
                | "as"
                | "try"
                | "catch"
                | "finally"
                | "throw"
                | "use"
                | "insteadof"
                | "global"
                | "var"
                | "unset"
                | "isset"
                | "empty"
                | "continue"
                | "goto"
                | "function"
                | "const"
                | "return"
                | "print"
                | "yield"
                | "list"
                | "switch"
                | "endswitch"
                | "case"
                | "default"
                | "break"
                | "array"
                | "callable"
                | "extends"
                | "implements"
                | "namespace"
                | "trait"
                | "interface"
                | "class"
                | "__CLASS__"
                | "__TRAIT__"
                | "__FUNCTION__"
                | "__METHOD__"
                | "__LINE__"
                | "__FILE__"
                | "__DIR__"
                | "__NAMESPACE__"
                | "__halt_compiler"
                | "fn"
                | "match"]
        )
    }

    #[inline]
    pub const fn is_literal(&self) -> bool {
        matches!(
            self,
            T!["true" | "false" | "null" | LiteralFloat | LiteralInteger | LiteralString | PartialLiteralString]
        )
    }

    #[inline]
    pub const fn is_magic_constant(&self) -> bool {
        matches!(
            self,
            T!["__CLASS__"
                | "__DIR__"
                | "__FILE__"
                | "__FUNCTION__"
                | "__LINE__"
                | "__METHOD__"
                | "__NAMESPACE__"
                | "__TRAIT__"]
        )
    }

    #[inline]
    pub const fn is_cast(&self) -> bool {
        matches!(
            self,
            T!["(string)"
                | "(binary)"
                | "(int)"
                | "(integer)"
                | "(float)"
                | "(double)"
                | "(real)"
                | "(bool)"
                | "(boolean)"
                | "(array)"
                | "(object)"
                | "(unset)"
                | "(void)"]
        )
    }

    #[inline]
    pub const fn is_unary_prefix(&self) -> bool {
        if self.is_cast() {
            return true;
        }

        matches!(self, T!["@" | "!" | "~" | "-" | "+" | "++" | "--" | "&"])
    }

    #[inline]
    pub const fn is_trivia(&self) -> bool {
        matches!(self, T![SingleLineComment | MultiLineComment | DocBlockComment | HashComment | Whitespace])
    }

    #[inline]
    pub const fn is_comment(&self) -> bool {
        matches!(self, T![SingleLineComment | MultiLineComment | DocBlockComment | HashComment])
    }

    #[inline]
    pub const fn is_comma(&self) -> bool {
        matches!(self, T![","])
    }

    #[inline]
    pub const fn is_construct(&self) -> bool {
        matches!(
            self,
            T!["isset"
                | "empty"
                | "eval"
                | "include"
                | "include_once"
                | "require"
                | "require_once"
                | "print"
                | "unset"
                | "exit"
                | "die"]
        )
    }
}

impl<'arena> Token<'arena> {
    pub const fn new(kind: TokenKind, value: &'arena str, span: Span) -> Self {
        Self { kind, value, span }
    }
}

impl<'arena> std::fmt::Display for Token<'arena> {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        write!(f, "{}({})", self.kind, self.value)
    }
}
