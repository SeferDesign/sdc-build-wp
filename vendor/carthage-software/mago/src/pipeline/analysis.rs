use std::time::Duration;

use mago_analyzer::Analyzer;
use mago_analyzer::analysis_result::AnalysisResult;
use mago_analyzer::settings::Settings;
use mago_codex::metadata::CodebaseMetadata;
use mago_codex::reference::SymbolReferences;
use mago_database::ReadDatabase;
use mago_names::resolver::NameResolver;
use mago_reporting::Issue;
use mago_semantics::SemanticsChecker;
use mago_syntax::parser::parse_file;

use crate::error::Error;
use crate::pipeline::ParallelPipeline;
use crate::pipeline::Reducer;

/// The "reduce" step for the analysis pipeline.
///
/// This struct aggregates the `AnalysisResult` from each parallel task into a single,
/// final `AnalysisResult` for the entire project.
#[derive(Debug, Clone)]
struct AnalysisResultReducer;

impl Reducer<AnalysisResult, AnalysisResult> for AnalysisResultReducer {
    fn reduce(
        &self,
        mut codebase: CodebaseMetadata,
        symbol_references: SymbolReferences,
        results: Vec<AnalysisResult>,
    ) -> Result<AnalysisResult, Error> {
        let mut aggregated_result = AnalysisResult::new(symbol_references);
        for result in results {
            aggregated_result.extend(result);
        }

        aggregated_result.issues.extend(codebase.take_issues(true));

        Ok(aggregated_result)
    }
}

/// Runs the parallel static analysis phase on a fully compiled codebase.
///
/// This function orchestrates the analysis workflow using a [`ParallelPipeline`].
/// It takes a database containing all source files (user code + stubs) and the
/// pre-compiled prelude metadata, then runs a full semantic and type analysis
/// on each "host" file in parallel.
///
/// # Arguments
///
/// * `database`: The read-only database containing all files to be considered.
/// * `codebase`: The pre-compiled `CodebaseMetadata` from the prelude.
/// * `symbol_references`: The pre-compiled `SymbolReferences` from the prelude.
/// * `analyzer_settings`: The configured settings for the analyzer.
///
/// # Returns
///
/// A `Result` containing the final, aggregated [`AnalysisResult`] for the
/// entire project, or an [`Error`].
pub fn run_analysis_pipeline(
    database: ReadDatabase,
    codebase: CodebaseMetadata,
    symbol_references: SymbolReferences,
    analyzer_settings: Settings,
) -> Result<AnalysisResult, Error> {
    const ANALYSIS_DURATION_THRESHOLD: Duration = Duration::from_millis(5000);
    const ANALYSIS_PROGRESS_PREFIX: &str = "🕵️  Analyzing";

    let pipeline = ParallelPipeline::new(
        ANALYSIS_PROGRESS_PREFIX,
        database,
        codebase,
        symbol_references,
        analyzer_settings,
        Box::new(AnalysisResultReducer),
    );

    pipeline.run(|settings, arena, source_file, codebase| {
        let mut analysis_result = AnalysisResult::new(SymbolReferences::new());

        let (program, parsing_error) = parse_file(arena, &source_file);
        let resolved_names = NameResolver::new(arena).resolve(program);

        if let Some(parsing_error) = parsing_error {
            analysis_result.issues.push(Issue::from(&parsing_error));
        }

        let semantics_checker = SemanticsChecker::new(settings.version);
        let analyzer = Analyzer::new(arena, &source_file, &resolved_names, &codebase, settings);

        analysis_result.issues.extend(semantics_checker.check(&source_file, program, &resolved_names));
        analyzer.analyze(program, &mut analysis_result)?;

        if analysis_result.time_in_analysis > ANALYSIS_DURATION_THRESHOLD {
            tracing::warn!(
                "Analysis of source file '{}' took longer than {}s: {}s",
                source_file.name,
                ANALYSIS_DURATION_THRESHOLD.as_secs_f32(),
                analysis_result.time_in_analysis.as_secs_f32()
            );
        }

        Ok(analysis_result)
    })
}
