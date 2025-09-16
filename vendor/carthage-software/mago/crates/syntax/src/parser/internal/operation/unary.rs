use crate::T;
use crate::ast::ast::*;
use crate::error::ParseError;
use crate::parser::internal::expression::parse_expression_with_precedence;
use crate::parser::internal::token_stream::TokenStream;
use crate::parser::internal::utils;
use crate::token::GetPrecedence;

pub fn parse_unary_prefix_operation<'arena>(
    stream: &mut TokenStream<'_, 'arena>,
) -> Result<UnaryPrefix<'arena>, ParseError> {
    let token = utils::expect_any(stream)?;

    let operator = match token.kind {
        T!["(array)"] => UnaryPrefixOperator::ArrayCast(token.span, token.value),
        T!["(bool)"] => UnaryPrefixOperator::BoolCast(token.span, token.value),
        T!["(boolean)"] => UnaryPrefixOperator::BooleanCast(token.span, token.value),
        T!["(double)"] => UnaryPrefixOperator::DoubleCast(token.span, token.value),
        T!["(real)"] => UnaryPrefixOperator::RealCast(token.span, token.value),
        T!["(float)"] => UnaryPrefixOperator::FloatCast(token.span, token.value),
        T!["(int)"] => UnaryPrefixOperator::IntCast(token.span, token.value),
        T!["(integer)"] => UnaryPrefixOperator::IntegerCast(token.span, token.value),
        T!["(object)"] => UnaryPrefixOperator::ObjectCast(token.span, token.value),
        T!["(unset)"] => UnaryPrefixOperator::UnsetCast(token.span, token.value),
        T!["(binary)"] => UnaryPrefixOperator::BinaryCast(token.span, token.value),
        T!["(string)"] => UnaryPrefixOperator::StringCast(token.span, token.value),
        T!["(void)"] => UnaryPrefixOperator::VoidCast(token.span, token.value),
        T!["@"] => UnaryPrefixOperator::ErrorControl(token.span),
        T!["!"] => UnaryPrefixOperator::Not(token.span),
        T!["~"] => UnaryPrefixOperator::BitwiseNot(token.span),
        T!["-"] => UnaryPrefixOperator::Negation(token.span),
        T!["+"] => UnaryPrefixOperator::Plus(token.span),
        T!["++"] => UnaryPrefixOperator::PreIncrement(token.span),
        T!["--"] => UnaryPrefixOperator::PreDecrement(token.span),
        T!["&"] => UnaryPrefixOperator::Reference(token.span),
        _ => {
            return Err(utils::unexpected(
                stream,
                Some(token),
                T![
                    "(array)",
                    "(bool)",
                    "(boolean)",
                    "(double)",
                    "(real)",
                    "(float)",
                    "(int)",
                    "(integer)",
                    "(object)",
                    "(unset)",
                    "(binary)",
                    "(string)",
                    "@",
                    "!",
                    "~",
                    "-",
                    "+",
                    "++",
                    "--",
                    "&"
                ],
            ));
        }
    };

    let operand = parse_expression_with_precedence(stream, operator.precedence())?;

    Ok(UnaryPrefix { operator, operand: stream.alloc(operand) })
}
