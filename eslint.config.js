export default [
	{
		languageOptions: {
			parserOptions: {
				ecmaVersion: 6,
				sourceType: "module",
				ecmaFeatures: {
					jsx: true,
				},
			},
		},
		rules: {
			semi: 1,
			indent: [1, "tab"],
			"no-multiple-empty-lines": [
				1,
				{
					max: 1,
				},
			],
		},
	}
];
