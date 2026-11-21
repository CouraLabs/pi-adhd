# AGENTS.md — Task Manager Extension

This extension manages project tasks via Markdown files. Cross-platform (Windows, macOS, Linux).

## Overview

- **Purpose**: Task tracking with Backlog → Active → Closed workflow
- **Task Storage**: `~/.pi/tasks/<workspace>/<folder>/<task>.md`
- **Workspace Detection**: Derived from current working directory (e.g., `C:/repo/test` → `C--repo-test`)

## Folder Structure

Tasks are organized by workspace (derived from cwd):

```
~/.pi/tasks/
├── C-repo/           # Workspace: C:/repo
│   ├── Backlog/      # Pending tasks
│   ├── Active/       # Currently working on (multiple tasks allowed)
│   ├── user-qa/      # Completed tasks pending user QA
│   └── Closed/       # Tasks finished with user QA
└── Another-Workspace/
```

## Task Format

```markdown
---
id: <uuid>
title: Task Title
created: YYYY-MM-DD
priority: low|medium|high|critical
tags:
  - tag1
---

# Task Title

## Notes
<!-- Agent appends progress here -->
```

## Available Tools

Use the `tasks` tool for all task management:

`action` selects the operation. **Every other parameter belongs to specific
actions only** — see [Parameter validation](#parameter-validation) below.

| Action | Required | Optional | Description |
|--------|----------|----------|-------------|
| `list` | — | `includeClosed` | Show tasks grouped by folder (Closed excluded unless `includeClosed=true`) |
| `create` | `title` | `priority`, `content` | Create a task in Backlog, optionally with initial notes |
| `get` | `uuid` | — | Read one task's full content |
| `search` | `name` | — | Find a task by (partial) title; returns its uuid |
| `append` | `uuid`, plus `content` **or** `file` | — | Append progress notes to a task |
| `move` | `uuid`, `folder` | — | Move a task to `Backlog` / `Active` / `Closed` |
| `rename` | `uuid`, `newTitle` | — | Rename a task |
| `delete` | `uuid` | — | Delete a task |
| `submit-qa` | — | `uuid`, `message` | Submit the active task to QA (pass `uuid` when several are Active) |

`id` is accepted as an alias for `uuid` everywhere. The uuid is the 8-char id
printed after each title by `list` and `search`.

### Parameter validation

Pi does **not** validate tool arguments against the registered schema, so this
extension validates them itself in `src/tasks/tool-params.ts`. A call whose
parameters do not match its `action` is **rejected with a corrective message**
rather than silently doing something else.

This exists because silent tolerance is actively harmful: a call like
`tasks(action="list", title="Fix login")` used to return a normal task list,
which reads as "create is broken" and invites the same wrong call again. Now it
returns:

```
Error: action "list" does not use "title" — it was ignored, so the call ran as a plain "list".
"list" accepts only: includeClosed.
Parameter "title" belongs to action: create.
Did you mean: tasks(action="create", title="<task title>", priority?="low|medium|high|critical", content?="<initial notes>") ?
"list" signature: tasks(action="list", includeClosed?=true)
```

Empty and not-found results also carry a next-step hint (e.g. `list` on an empty
workspace suggests `create`), so a dead end names the call that would change
state. Successful results are prefixed with the action that ran, e.g.
`[create] Created task "…" [high] (aa22759f)`.

When adding an action or a parameter, update **both** `ACTION_SPECS` and
`TasksParamsSchema` in `src/tasks/tool-params.ts`; a test asserts the two agree.

### Tool Usage Examples

```typescript
// List all tasks
tasks(action="list")

// List all tasks including Closed
tasks(action="list", includeClosed=true)

// Create a new task with initial content
tasks(action="create", title="Implement authentication", priority="high", content="## Requirements\n- Design auth flow\n- Add OAuth support")

// Look up a task's uuid, then move it to Active
tasks(action="search", name="design-auth")
tasks(action="move", uuid="abc123...", folder="Active")

// Add progress notes
tasks(action="append", uuid="abc123...", content="## Progress\n- Completed API design")

// Read content from a file and append to task
tasks(action="append", uuid="abc123...", file="C:/path/to/content.txt")

// Search for a task
tasks(action="search", name="auth")
```

**Note**: The workspace is always derived from the agent's current working directory. Agents cannot manually set the workspace.

## Available Commands

| Command | Description |
|---------|-------------|
| `/tasks` | List all tasks with interactive picker |
| `/task-active` | List non-closed tasks with interactive picker |
| `/task-active <name>` | Move task to Active (multiple tasks may be Active) |
| `/task-work <name>` | Assign task and instruct agent to work on it |
| `/task-work all` | Process all Backlog tasks sequentially |
| `/task-create <title> [--priority=high] [--content='...']` | Create new task in Backlog with optional content |
| `/task-new <title> [--priority=high]` | Create new task in Backlog (alias) |
| `/task-open <name>` | Open task file in default editor |
| `/task-complete [name]` | Mark task as complete (lists tasks if no name given) |
| `/couralabs:task-dashboard` | Open web dashboard in browser (http://127.0.0.1:7254, override with `TASK_DASHBOARD_PORT`; set `BROWSER=none` to suppress auto-open). Create and edit tasks from the UI. |

### Command Examples

```bash
# Create a high-priority task with initial content
/task-create Implement authentication --priority=high --content='## Requirements\n- Design auth flow\n- Add OAuth support'

# Assign existing task to active
/task-active design-auth

# Mark task as complete (lists non-closed tasks if no name)
/task-complete design-auth

# View all tasks
/tasks

# Open the read-only web dashboard across all projects
/couralabs:task-dashboard
```

## Agent Guidelines

### Do: Use Task Tools

- Use `tasks(action="list")` to see all tasks
- Use `tasks(action="create", ...)` to create new tasks (workspace auto-detected from cwd)
- Use `tasks(action="append", ...)` to record progress
- Check Active task at session start

### Don't: Access Tasks Folder Directly

The extension **blocks direct access** to `~/.pi/tasks/` via write/edit/bash tools. All task operations must go through:

1. The `tasks` tool
2. The `/task-active`, `/tasks`, `/task-new`, `/task-complete`, `/couralabs:task-dashboard` commands

### Active Task Policy

- **Multiple** tasks may be Active at the same time
- Moving a task to Active does **not** affect other Active tasks
- Use `/task-active <name>` to add another task to Active



## Priority Levels

| Level | Use Case |
|-------|----------|
| `low` | Nice-to-have improvements |
| `medium` | Default, standard work |
| `high` | Important, should do soon |
| `critical` | Must address immediately |

## Session Behavior

On session start:
- If no Active task → notify about Backlog count
- If Active task(s) exist → display them