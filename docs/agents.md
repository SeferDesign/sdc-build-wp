# AI agents

This package ships an [Agent Skill](https://agentskills.io) at `.agents/skills/sdc-build-wp/SKILL.md` with WordPress theme/plugin development standards and conventions for AI coding agents working in projects built with sdc-build-wp. Because agents don't discover skills inside `node_modules`, run the installer from your project root:

```sh
sdc-build-wp agents            # interactive prompt
sdc-build-wp agents reference  # add a pointer to the packaged skill in AGENTS.md
sdc-build-wp agents copy       # copy the skill into .agents/skills/
```

`reference` (recommended) appends a short section to your project's `AGENTS.md` (creating it if needed) directing agents to the skill inside `node_modules`. The pointer sits in always-loaded agent context, keeps your `AGENTS.md` minimal, and guidance stays current with the installed version.

`copy` places a standalone copy in `.agents/skills/sdc-build-wp/` where agents discover it as an on-demand skill; re-run it after upgrading to refresh the copy.

The reference is only added once; both commands are safe to re-run.
