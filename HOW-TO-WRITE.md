# How to add a Codex entry

You never edit code. A post is just a text file.

## 1. Create the file

In the `posts` folder, make a file named `YYYY-MM-DD-your-title.md`, for example:

    posts/2026-11-20-on-slow-mornings.md

## 2. Write it

Put this at the top, then write your text below it:

```
---
title: On slow mornings
date: 2026-11-20
summary: One line that shows in the notebook's list.
---

Your essay goes here. A blank line starts a new paragraph.
```

Add `draft: true` under the date to keep a post hidden while you are still writing it.

## 3. Build

Run this in this folder. It turns your files into pages:

```bash
node build.mjs
```

## 4. Publish (once the journal is live)

Upload the folder to the VPS with the same rsync we use for the front door, pointed at `/var/www/codex/`.

## To do

- Replace the placeholder post `posts/2026-11-17-first-note.md` with a real one.
- Deploy codex.limvoid.com (DNS record, Caddy block, rsync), then turn the "codex, sealed" pill on limvoid.com back into a link.
