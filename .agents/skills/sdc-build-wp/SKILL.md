---
name: sdc-build-wp
description: Development standards for building and improving WordPress themes and plugins in projects that use the sdc-build-wp build system. Use when writing or editing PHP templates, SCSS/CSS, JavaScript, blocks, or patterns in such a project.
---

# WordPress Theme & Plugin Development (sdc-build-wp projects)

Guidance for building and improving the WordPress theme or plugin in this
project. The project uses the sdc-build-wp build system.

## Build system

- sdc-build-wp handles formatting, linting, compilation, and minification.
  Assume no additional building or processing is needed if the user already
  has watch mode running; do not run separate formatters or bundlers.
- Edit source files only: SCSS/CSS in `_src/style/`, JS/TS in `_src/scripts/`,
  images in `_src/images/`, fonts in `_src/fonts/`. Never edit `dist/` or
  block `build/` directories; they are regenerated.
- Build configuration lives in `.sdc-build-wp/config.json`. For build
  commands, watch-mode keys, and troubleshooting, see
  `node_modules/sdc-build-wp/README.md` or run `sdc-build-wp --help`.

## PHP

- In template `.php` files, prefer HTML with interspersed PHP over echoing
  markup from PHP when possible.
- Prefer curly brace syntax over alternative syntax (`if { }`, not
  `if : endif;`).
- Reasonably assume custom called functions already exist; only use a
  `function_exists()` check in extreme cases.
- Watch mode auto-formats PHP on save; syntax errors are logged and block
  formatting and reload.

## CSS / SCSS

- Use `rem` units and existing CSS variables for colors and other attributes
  when possible. Check `theme.json` and `_src/style/` partials for existing
  tokens before introducing new values.
- When using a WordPress-related CSS variable (custom or theme.json-based),
  do not add a backup/fallback value.
- Styles compile through Sass with stylelint auto-fixing; logical properties
  are preferred (enforced by the lint config).

## Blocks, patterns, and style variations

- Custom blocks live in `blocks/<name>/src/` (with `block.json`), patterns in
  `patterns/`, style variations in `styles/`. In watch mode, press `n` to
  scaffold these from templates instead of creating the files by hand.
- Source `theme.json`, style variations, and `block.json` files are validated
  against official WordPress schemas on every build; fix reported metadata
  errors at the source rather than working around them.
- Prefer core blocks, block supports, theme.json settings, patterns, and
  style variations over custom code when they satisfy the requirement.

## Accessibility

- Aim for WCAG 2.1 AA compliance in all code and interactivity.

## General

- Comments are useful and welcome, but aim for clear and concise code over
  heavily-commented code. Use meaningful variable and function names.
- If the project has tests, maintain them; create sensible tests when
  feasible.

## Approach

- Think before acting. Read existing templates, partials, and components
  before writing code; match the project's established conventions.
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

## What you need from the user

- End every turn where you're blocked on the user, or where the next step
  needs them, with a short "**What I need from you**" section. Numbered, one
  concrete action per item: exactly what to do, where (which site, app, file
  or person), and what to send back. e.g. "Log into the hosting dashboard and
  export the error log for today, then drop it in `inbox/`", not "I need the
  logs".
- If there are several, put the quickest or most blocking one first, and say
  what you'll get on with in the meantime.
- Never bury a request for the user in the middle of a long update.
