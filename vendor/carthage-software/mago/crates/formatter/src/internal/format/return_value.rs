use bumpalo::vec;

use mago_span::HasSpan;
use mago_syntax::ast::*;

use crate::document::Document;
use crate::document::Group;
use crate::document::IfBreak;
use crate::document::IndentIfBreak;
use crate::document::Line;
use crate::internal::FormatterState;
use crate::internal::comment::CommentFlags;
use crate::internal::format::Format;
use crate::internal::format::misc::has_new_line_in_range;
use crate::internal::format::misc::is_expandable_expression;
use crate::internal::format::misc::is_simple_expression;
use crate::internal::utils::get_left_side;
use crate::internal::utils::has_naked_left_side;
use crate::internal::utils::unwrap_parenthesized;

pub fn format_return_value<'arena>(
    f: &mut FormatterState<'_, 'arena>,
    value: &'arena Expression<'arena>,
) -> Document<'arena> {
    let mut value = unwrap_parenthesized(value);
    if f.in_pipe_chain_arrow_segment {
        while let Expression::Pipe(pipe) = value {
            value = unwrap_parenthesized(pipe.input);
        }
    }

    if return_argument_has_leading_comment(f, value) {
        let was_inside_parens = f.is_wrapped_in_parens;
        f.is_wrapped_in_parens = true;
        let value_doc = value.format(f);
        f.is_wrapped_in_parens = was_inside_parens;

        return Document::Array(vec![
            in f.arena;
            (Document::String("(")),
            (Document::Indent(vec![in f.arena; Document::Line(Line::hard()), value_doc])),
            (Document::Line(Line::hard())),
            (Document::String(")")),
        ]);
    }

    if should_wrap_return_value(value) {
        let was_inside_parens = f.is_wrapped_in_parens;
        f.is_wrapped_in_parens = true;
        let value_doc = value.format(f);
        f.is_wrapped_in_parens = was_inside_parens;

        return Document::Group(Group::new(vec![
            in f.arena;
            Document::IfBreak(IfBreak::then(f.arena, Document::String("("))),
            Document::IndentIfBreak(IndentIfBreak::new(
                vec![in f.arena; Document::Line(Line::soft()), value_doc],
            )),
            Document::Line(Line::soft()),
            Document::IfBreak(IfBreak::then(f.arena, Document::String(")"))),
        ]));
    }

    value.format(f)
}

fn return_argument_has_leading_comment<'arena>(
    f: &mut FormatterState<'_, 'arena>,
    argument: &'arena Expression<'arena>,
) -> bool {
    if f.has_leading_own_line_comment(argument.span())
        || f.has_comment_with_filter(argument.span(), CommentFlags::Leading, |comment| {
            has_new_line_in_range(f.source_text, comment.start, comment.end)
        })
    {
        return true;
    }

    if has_naked_left_side(argument) {
        let mut left_most = argument;
        while let Some(new_left_most) = get_left_side(left_most) {
            left_most = new_left_most;

            if f.has_leading_own_line_comment(left_most.span()) {
                return true;
            }
        }
    }

    false
}

fn should_wrap_return_value<'arena>(value: &'arena Expression<'arena>) -> bool {
    match value {
        Expression::Binary(binary) => {
            if is_simple_expression_or_binary(binary.lhs) && is_expandable_expression(binary.rhs, true) {
                return false;
            }

            if is_expandable_expression(binary.lhs, false) && is_simple_expression_or_binary(binary.rhs) {
                return false;
            }

            true
        }
        Expression::Conditional(conditional) => match conditional.then {
            Some(then) => then.is_conditional() && conditional.r#else.is_conditional(),
            _ => true,
        },
        _ => false,
    }
}

fn is_simple_expression_or_binary<'arena>(expr: &'arena Expression<'arena>) -> bool {
    match expr {
        Expression::Binary(binary) => is_simple_expression(binary.lhs) && is_simple_expression(binary.rhs),
        _ => is_simple_expression(expr),
    }
}
