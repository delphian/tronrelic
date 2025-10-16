---
description: Stage all changes and commit with a 2-sentence, plain-English message describing what changed.
---

Collect staging context, then write a concise commit message.

## Context
Run these commands to gather the diff:

```bash
git rev-parse --abbrev-ref HEAD
git diff --cached --name-status
git diff --cached --stat
git status --porcelain=v1
```

## Task
Write **exactly two sentences** in a single paragraph of plain English that describe what changed on the current branch since the last commit, based on the staged diff above.

**Rules:**
- Be concise and specific; mention major areas touched and the nature of changes (added/modified/removed/renamed)
- No tickets, emojis, tags, or boilerplate
- Present tense, no code fences
- Do not append watermarks or promotional text

Output the message in plain text only.