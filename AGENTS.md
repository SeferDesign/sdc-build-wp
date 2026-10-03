# Agents Instructions

This document serves as a guide to leveraging agents for working within the `sdc-build-wp` repo. See `README.md` for more information about this package. Below are the essential instructions and guidelines:

## Watch Commands

Whenever a new watch command is added, be sure to add it to the README, the `lib/help.js` file, and the log that outputs the available commands.

## Code Standards

- All JavaScript and TypeScript code should adhere to the formatting rules specified in `eslint.config.js` whenever possible.
- Comments are useful and welcome, but aim for clear and concise code over heavily-commented code. Use meaningful variable and function names to enhance readability.

## Approach
- Think before acting. Read existing files before writing code.
- Be concise in output but thorough in reasoning.
- Prefer editing over rewriting whole files.
- Do not re-read files you have already read.
- Test your code before declaring done.
- No sycophantic openers or closing fluff.
- Keep solutions simple and direct. No over-engineering.
- If unsure: say so. Never guess or invent file paths.
- User instructions always override this file.

## Efficiency
- Read before writing. Understand the problem before coding.
- No redundant file reads. Read each file once.
- One focused coding pass. Avoid write-delete-rewrite cycles.
- Test once, fix if needed, verify once. No unnecessary iterations.
- Budget: 50 tool calls maximum. Work efficiently.
