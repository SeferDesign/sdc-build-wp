use std::rc::Rc;

use ahash::HashMap;
use ahash::HashSet;

use mago_algebra::assertion_set::AssertionSet;
use mago_codex::reference::SymbolReferences;
use mago_codex::ttype::union::TUnion;
use mago_span::HasSpan;

use crate::context::scope::case_scope::CaseScope;
use crate::context::scope::loop_scope::LoopScope;

#[derive(Debug, Clone)]
pub struct AnalysisArtifacts {
    pub expression_types: HashMap<(u32, u32), Rc<TUnion>>,
    pub if_true_assertions: HashMap<(u32, u32), HashMap<String, AssertionSet>>,
    pub if_false_assertions: HashMap<(u32, u32), HashMap<String, AssertionSet>>,
    pub inferred_return_types: Vec<Rc<TUnion>>,
    pub symbol_references: SymbolReferences,
    pub loop_scope: Option<LoopScope>,
    pub case_scopes: Vec<CaseScope>,
    pub fully_matched_switch_offsets: HashSet<u32>,
    pub inferred_parameter_types: Option<HashMap<usize, TUnion>>,
}

impl AnalysisArtifacts {
    pub(crate) fn new() -> Self {
        Self {
            expression_types: HashMap::default(),
            inferred_return_types: Vec::new(),
            if_true_assertions: HashMap::default(),
            if_false_assertions: HashMap::default(),
            symbol_references: SymbolReferences::new(),
            case_scopes: Vec::new(),
            loop_scope: None,
            fully_matched_switch_offsets: HashSet::default(),
            inferred_parameter_types: None,
        }
    }

    pub fn set_loop_scope(&mut self, loop_scope: LoopScope) {
        let previous_scope = self.loop_scope.take().map(Box::new);
        self.loop_scope = Some(loop_scope.with_parent_loop(previous_scope));
    }

    pub unsafe fn take_loop_scope_unchecked(&mut self) -> LoopScope {
        let mut loop_scope = unsafe {
            // SAFETY: the caller must ensure that `self.loop_scope` is not `None`.
            self.loop_scope.take().unwrap_unchecked()
        };

        match loop_scope.parent_loop.take() {
            Some(parent_loop) => {
                self.loop_scope = Some(*parent_loop);
            }
            None => {
                self.loop_scope = None;
            }
        }

        loop_scope
    }

    pub fn get_loop_scope_mut(&mut self) -> Option<&mut LoopScope> {
        self.loop_scope.as_mut()
    }

    /// Set the type of expression `expression` to `t`.
    #[inline]
    pub fn set_expression_type<T: HasSpan>(&mut self, expression: &T, t: TUnion) {
        self.expression_types.insert(get_expression_range(expression), Rc::new(t));
    }

    /// Get the type of expression `expression`.
    #[inline]
    pub fn get_expression_type<T: HasSpan>(&self, expression: &T) -> Option<&TUnion> {
        let t = self.expression_types.get(&get_expression_range(expression))?;

        Some(&**t)
    }

    /// Set the type of expression `expression` to `t`.
    #[inline]
    pub fn set_rc_expression_type<T: HasSpan>(&mut self, expression: &T, t: Rc<TUnion>) {
        self.expression_types.insert(get_expression_range(expression), t);
    }

    /// Get the type of expression `expression`.
    #[inline]
    pub fn get_rc_expression_type<T: HasSpan>(&self, expression: &T) -> Option<&Rc<TUnion>> {
        self.expression_types.get(&get_expression_range(expression))
    }
}

#[inline]
pub fn get_expression_range<T: HasSpan>(expression: &T) -> (u32, u32) {
    let span = expression.span();

    (span.start.offset, span.end.offset)
}
