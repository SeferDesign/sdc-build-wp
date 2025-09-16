use std::rc::Rc;

use mago_codex::ttype::add_optional_union_type;
use mago_codex::ttype::atomic::TAtomic;
use mago_codex::ttype::comparator::ComparisonResult;
use mago_codex::ttype::comparator::union_comparator::is_contained_by;
use mago_codex::ttype::get_arraykey;
use mago_codex::ttype::get_iterable_parameters;
use mago_codex::ttype::get_keyed_array;
use mago_codex::ttype::get_list;
use mago_codex::ttype::get_mixed;
use mago_codex::ttype::get_mixed_iterable;
use mago_codex::ttype::union::TUnion;

use crate::artifacts::AnalysisArtifacts;
use crate::context::Context;
use crate::context::block::BlockContext;
use crate::invocation::Invocation;
use crate::invocation::special_function_like_handler::SpecialFunctionLikeHandlerTrait;
use crate::invocation::special_function_like_handler::utils::get_argument;

#[derive(Debug)]
pub struct IteratorFunctionsHandler;

impl SpecialFunctionLikeHandlerTrait for IteratorFunctionsHandler {
    fn get_return_type<'ctx, 'ast, 'arena>(
        &self,
        context: &mut Context<'ctx, 'arena>,
        _block_context: &BlockContext<'ctx>,
        artifacts: &AnalysisArtifacts,
        function_like_name: &str,
        invocation: &Invocation<'ctx, 'ast, 'arena>,
    ) -> Option<TUnion> {
        match function_like_name {
            "iterator_to_array" => {
                let preserve_keys = match get_argument(invocation.arguments_source, 1, vec!["preserve_keys"]) {
                    Some(argument) => artifacts.get_expression_type(argument).and_then(|argument_type| {
                        if argument_type.is_always_truthy() {
                            Some(true)
                        } else if argument_type.is_always_falsy() {
                            Some(false)
                        } else {
                            None
                        }
                    }),
                    None => Some(true),
                };

                let iterator_argument = get_argument(invocation.arguments_source, 0, vec!["iterator"])
                    .and_then(|arg| artifacts.get_rc_expression_type(arg))
                    .cloned()
                    .unwrap_or_else(|| Rc::new(get_mixed_iterable()));

                let mut key_type: Option<TUnion> = None;
                let mut value_type: Option<TUnion> = None;

                let mut iterator_atomics: Vec<&TAtomic> = iterator_argument.types.iter().collect();
                while let Some(iterator_atomic) = iterator_atomics.pop() {
                    if let TAtomic::GenericParameter(parameter) = iterator_atomic {
                        iterator_atomics.extend(parameter.constraint.types.iter());
                    }

                    let Some((k, v)) = get_iterable_parameters(iterator_atomic, context.codebase) else {
                        continue;
                    };

                    key_type = Some(add_optional_union_type(k, key_type.as_ref(), context.codebase));
                    value_type = Some(add_optional_union_type(v, value_type.as_ref(), context.codebase));
                }

                let mut iterator_key_type = key_type.unwrap_or_else(get_arraykey);
                let iterator_value_type = value_type.unwrap_or_else(get_mixed);

                let Some(preserve_keys) = preserve_keys else {
                    return Some(get_keyed_array(get_arraykey(), iterator_value_type));
                };

                if !preserve_keys {
                    return Some(get_list(iterator_value_type));
                }

                if !is_contained_by(
                    context.codebase,
                    &iterator_key_type,
                    &get_arraykey(),
                    false,
                    false,
                    false,
                    &mut ComparisonResult::default(),
                ) {
                    iterator_key_type = get_arraykey();
                }

                Some(get_keyed_array(iterator_key_type, iterator_value_type))
            }
            _ => None,
        }
    }
}
