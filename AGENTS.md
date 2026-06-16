# Personal Site

This project is a static website generated from Markdown.

## Content Flow

- `content/inbox/` is raw capture. The user can dump messy thoughts here.
- `content/posts/` is the publishable layer.
- `public/` is generated output. Do not edit it directly.

## Publishing From Inbox

When the user asks to publish something from the website inbox:

1. Read the relevant file in `content/inbox/`.
2. Preserve the raw inbox file unless the user explicitly asks to prune it.
3. Draft the public piece in `content/posts/<slug>.md`.
4. Use this frontmatter:

```markdown
---
title: Post Title
date: YYYY-MM-DD
description: Short index summary.
tags:
  - optional-tag
---
```

5. Apply the workspace deslop rules to public prose.
6. Run `npm run build`.
7. Report the new or changed public URL.

Keep the site simple. Prefer clear finished pieces over elaborate structure.
