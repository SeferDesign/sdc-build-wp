import stylelint from 'stylelint';

const ruleName = 'sdc/block-max-empty-lines';
const messages = stylelint.utils.ruleMessages(ruleName, {
	expected: max => `Expected no more than ${max} empty lines before closing brace`
});

const rule = primary => (root, result) => {
	if (!stylelint.utils.validateOptions(result, ruleName, {
		actual: primary,
		possible: value => Number.isInteger(value) && value >= 0
	})) {
		return;
	}

	// The upstream max-empty-lines fixer skips whitespace stored in block raws.after.
	root.walk(node => {
		if (!node.nodes || typeof node.raws.after !== 'string') {
			return;
		}
		const after = node.raws.after.replace(/\r?\n(?:[ \t]*\r?\n)+/g, match => {
			const newlines = match.match(/\r?\n/g);
			return newlines.length > primary + 1 ? newlines.slice(0, primary + 1).join('') : match;
		});
		if (after === node.raws.after) {
			return;
		}
		const index = node.toString().length - 1;
		stylelint.utils.report({
			message: messages.expected(primary),
			node,
			index,
			endIndex: index,
			result,
			ruleName,
			fix: () => { node.raws.after = after; }
		});
	});
};

rule.ruleName = ruleName;
rule.messages = messages;
rule.meta = { fixable: true };

export default stylelint.createPlugin(ruleName, rule);
