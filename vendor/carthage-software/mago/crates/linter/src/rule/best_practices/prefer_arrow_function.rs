use indoc::indoc;
use serde::Deserialize;
use serde::Serialize;

use mago_fixer::SafetyClassification;
use mago_php_version::PHPVersion;
use mago_php_version::PHPVersionRange;
use mago_reporting::Annotation;
use mago_reporting::Issue;
use mago_reporting::Level;
use mago_span::HasSpan;
use mago_syntax::ast::*;

use crate::category::Category;
use crate::context::LintContext;
use crate::requirements::RuleRequirements;
use crate::rule::Config;
use crate::rule::LintRule;
use crate::rule_meta::RuleMeta;
use crate::settings::RuleSettings;

#[derive(Debug, Clone)]
pub struct PreferArrowFunctionRule {
    meta: &'static RuleMeta,
    cfg: PreferArrowFunctionConfig,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(default, rename_all = "kebab-case", deny_unknown_fields)]
pub struct PreferArrowFunctionConfig {
    pub level: Level,
}

impl Default for PreferArrowFunctionConfig {
    fn default() -> Self {
        Self { level: Level::Help }
    }
}

impl Config for PreferArrowFunctionConfig {
    fn level(&self) -> Level {
        self.level
    }
}

impl LintRule for PreferArrowFunctionRule {
    type Config = PreferArrowFunctionConfig;

    fn meta() -> &'static RuleMeta {
        const META: RuleMeta = RuleMeta {
            name: "Prefer Arrow Function",
            code: "prefer-arrow-function",
            description: indoc! {"
                Promotes the use of arrow functions (`fn() => ...`) over traditional closures (`function() { ... }`).

                This rule identifies closures that consist solely of a single return statement
                and suggests converting them to arrow functions.
            "},
            good_example: indoc! {r#"
                <?php

                $a = fn($x) => $x + 1;
            "#},
            bad_example: indoc! {r#"
                <?php

                $a = function($x) {
                    return $x + 1;
                };
            "#},
            category: Category::BestPractices,
            requirements: RuleRequirements::PHPVersion(PHPVersionRange::from(PHPVersion::PHP74)),
        };

        &META
    }

    fn targets() -> &'static [NodeKind] {
        const TARGETS: &[NodeKind] = &[NodeKind::Closure];

        TARGETS
    }

    fn build(settings: RuleSettings<Self::Config>) -> Self {
        Self { meta: Self::meta(), cfg: settings.config }
    }

    fn check<'ast, 'arena>(&self, ctx: &mut LintContext<'_, 'arena>, node: Node<'ast, 'arena>) {
        let Node::Closure(closure) = node else {
            return;
        };

        let statements = closure.body.statements.as_slice();
        if statements.len() != 1 {
            return;
        }

        let Statement::Return(Return {
            r#return: return_keyword,
            value: Some(returned_value),
            terminator: return_terminator,
        }) = &statements[0]
        else {
            return;
        };

        let issue =
            Issue::new(self.cfg.level(), "This closure can be simplified to a more concise arrow function.")
                .with_code(self.meta.code)
                .with_annotation(
                    Annotation::primary(closure.function.span).with_message("This traditional closure..."),
                )
                .with_annotation(
                    Annotation::secondary(returned_value.span())
                        .with_message("...can be converted to an arrow function that implicitly returns this expression."),
                )
                .with_note("Arrow functions provide a more concise syntax for simple closures that do nothing but return an expression.")
                .with_note("Arrow functions automatically capture variables from the parent scope by-value, which differs from traditional closures that use an explicit `use` clause and can capture by-reference.")
                .with_help("Consider rewriting this as an arrow function to improve readability.");

        ctx.collector.propose(issue, |plan| {
            let to_replace_with_fn = closure.function.span.to_range();
            let to_replace_with_arrow = match &closure.use_clause {
                Some(use_clause) => use_clause.span().join(return_keyword.span).to_range(),
                None => closure.body.left_brace.join(return_keyword.span).to_range(),
            };
            let to_remove = return_terminator.span().join(closure.body.right_brace).to_range();

            plan.replace(to_replace_with_fn, "fn", SafetyClassification::PotentiallyUnsafe);
            plan.replace(to_replace_with_arrow, "=>", SafetyClassification::PotentiallyUnsafe);
            plan.delete(to_remove, SafetyClassification::PotentiallyUnsafe);
        });
    }
}
