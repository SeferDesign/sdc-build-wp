# Agents Instructions

This document serves as a guide to leveraging agents for working within the `sdc-build-wp` repo. See `README.md` for an overview and the guides in `docs/` for details. Below are the essential instructions and guidelines:

## Watch Commands

Whenever a new watch command is added, be sure to add it to `docs/watch.md`, the `lib/help.js` file, and the log that outputs the available commands.

## Code Standards

- All JavaScript and TypeScript code should adhere to the formatting rules specified in `eslint.config.js` whenever possible.
- Comments are useful and welcome, but aim for clear and concise code over heavily-commented code. Use meaningful variable and function names to enhance readability.

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
