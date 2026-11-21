# Task Manager Extension

Manages project tasks via Markdown files. Cross-platform: works on Windows, macOS, and Linux.

## Folder Structure

Tasks are separated by workspace/folder. Tasks for `/home/user/projects/myapp` go to:

```
~/.pi/tasks/
├── home-user-projects-myapp/   # Workspace derived from cwd
│   ├── Backlog/                # Pending tasks
│   ├── Active/                 # Currently working on (multiple tasks allowed)
│   ├── user-qa/                # Completed tasks pending user QA
│   └── Closed/                 # Completed tasks
├── Another-Workspace/
│   ├── Backlog/
│   ├── Active/
│   ├── user-qa/
│   └── Closed/
└── ...
```

## Task MD Format

```markdown
---
id: <uuid>
title: Task Title
created: YYYY-MM-DD
priority: low|medium|high|critical
tags:
  - tag1
  - tag2
---

# Task Title

## Notes
<!-- Agent appends progress here -->
```

## Commands

| Command | Description |
|---------|-------------|
| `/tasks` | List all tasks by folder |
| `/task-active` | List non-closed tasks with interactive picker |
| `/task-active <name>` | Move a task to Active |
| `/task-create <title> [--priority=high] [--content='...']` | Create new task in Backlog |
| `/task-new <title> [--priority=high]` | Create new task (alias) |
| `/task-open <name>` | Open a task file in the default editor |
| `/task-complete <name>` | Mark task as complete (moves to Closed) |
| `/couralabs:task-dashboard` | Open web dashboard in browser, pre-selected to the current project (falls back to All projects if no matching workspace) — create, edit, and drag tasks between lanes from the UI |

| `/task-work <name>` | Assign task and instruct agent to work on it |
| `/submit-qa <message>` | Submit active task to QA |

## Tools (for LLM)

| Action | Parameters | Description |
|--------|------------|-------------|
| `list` | `includeClosed` (boolean, optional) | Show non-closed tasks grouped by folder; pass `includeClosed=true` to include Closed |
| `create` | `title`, `priority`, `content` | Create new task in Backlog |
| `get` | `uuid` or `id` | Get full task content |
| `move` | `uuid`, `folder` | Move task to folder |
| `append` | `uuid`, `content` or `file` | Add content to task |
| `delete` | `uuid` | Delete a task |
| `rename` | `uuid`, `newTitle` | Rename a task |
| `search` | `name` | Find task by name |
| `submit-qa` | `message` | Submit active task to QA |

## Usage Examples

```bash
# Create a task
/task-create Implement authentication --priority=high

# List all tasks
/tasks

# Mark task as complete
/task-complete design-auth

# Assign a task
/task-active design-auth

# Open the web dashboard (create/edit tasks from the browser)
/couralabs:task-dashboard

# Agent tool usage
tasks(action="list")
tasks(action="move", uuid="abc123...", folder="Active")
tasks(action="append", uuid="abc123...", content="## Progress\n- Set up OAuth providers")
```
