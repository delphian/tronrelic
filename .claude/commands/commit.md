---
description: Stage all changes and commit with a 2-sentence, plain-English message describing what changed since the last commit.
allowed-tools:
  - Bash(git add:*)
  - Bash(git diff:*)
  - Bash(git rev-parse:*)
  - Bash(git status:*)
---

## Pre-run (collect context and stage)
- Current branch: !`git rev-parse --abbrev-ref HEAD`
- Stage everything: !`git add .`
- Staged summary (names + statuses): !`git diff --cached --name-status`
- Staged stats: !`git diff --cached --stat`
- Working tree summary: !`git status --porcelain=v1`

## Task
Write **exactly two sentences** in a single paragraph of plain English that describe what changed on the current branch since the last commit, based **only** on the staged diff above.

Rules:
- Be concise and specific; mention the branch name, major areas touched, and the nature of changes (added/modified/removed/renamed).
- No tickets, emojis, tags, or boilerplate. Present tense. No code fences. No extra lines.
- Do not append a watermark or self promotion text.

After you produce the two-sentence message (call it `MSG`), **execute** these commands with the Bash tool:

1) Pipe the message to clip.exe:
```bash
echo "$MSG" | clip.exe
```