# merge-desk

A pane (`/merge`, labels in Traditional Chinese) for integrating the branches an AI session left behind, step by step, without asking the model to do it.

It lists the branches in the session's repository that are not merged into `main` (or `master`) yet, worktree branches included, each with how many commits it is ahead, how long ago it moved, and how far it is behind. Pick one and press each step yourself:

1. **Preview**: the commit subjects and the diff stat.
2. **Merge**: `git merge --no-ff` into the base branch, in the folder where it is checked out.
3. **Push**: `git push origin <base>`.
4. **Clean up** (optional): remove the branch's worktree and delete the branch (`git branch -d`).

A merge that conflicts lists the conflicted files with **放棄合併** (abort) and **我改完了，繼續** (continue) (refused while a file still holds conflict markers). **請 Claude 解衝突** (ask Claude to resolve) is the one step that spends tokens: it submits a prompt naming the branch and the files.

## The model knows without rescanning

Each merge is recorded in the plugin's store. The first prompt of a conversation carries a few lines (what was merged lately, with its commit and whether it was pushed, and which branches still wait), and a later prompt carries only what was merged since. The model then has no reason to run `git branch` or `git log` to find out.

## What it touches

- **Git, in your repository.** Every action runs `git` by its argument vector (no shell) through Claude Code's `$.process.run`, only when you press a button, except the read-only listing (`worktree list`, `for-each-ref`, `rev-list`, `status`) that also runs on a conversation's first prompt. Push uses your own git credentials and pushes only the base branch.
- **Your machine.** The record of merges is kept in the plugin's own store under `~/.claude`, ten per repository.
- **Nothing else.** No network of its own (only what `git push` / `git fetch` do), no files outside the repository and `~/.claude`, no model calls except the one you press.

## Develop

```bash
claude plugin test .
claude plugin validate .
```

`lib/git.ts` holds the git steps behind a `Run` port, `lib/ledger.ts` the record and the lines the model reads, and `hooks/register.tsx` is the only file that touches the engine (`$`).
