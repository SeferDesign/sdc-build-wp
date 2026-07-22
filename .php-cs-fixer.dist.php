<?php

$finder = PhpCsFixer\Finder::create()
	->in(__DIR__)
	->exclude([
		'node_modules',
		'vendor',
		'dist',
		'build',
	])
	->name('*.php');

return (new PhpCsFixer\Config())
	->setRiskyAllowed(false)
	->setIndent("\t")
	->setLineEnding("\n")
	->setRules([
		'array_indentation' => true,
		'binary_operator_spaces' => ['default' => 'single_space'],
		'line_ending' => true,
		'no_trailing_whitespace' => true,
		'no_whitespace_in_blank_line' => true,
		'single_blank_line_at_eof' => true,
		'statement_indentation' => true,
		'trim_array_spaces' => true,
	])
	->setFinder($finder);
