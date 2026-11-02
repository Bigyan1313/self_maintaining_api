# Team guide

Three of us (Bigyan, Bibek, Sishir) build the project **at the same time**, each with Claude Code
on our own Mac. Each piece of work is one **increment**, tracked as one **GitHub Issue**.

## 1. One-time setup on a Mac

1. Install Homebrew (see https://brew.sh), then in Terminal:
   ```bash
   brew install git node@22 oasdiff gh
   brew install --cask docker
   ```
2. Open the **Docker** app once and wait until it says it is running.
3. Install Claude Code and log in to GitHub:
   ```bash
   npm install -g @anthropic-ai/claude-code
   gh auth login
   ```

## 2. Get the project

```bash
gh repo clone Bigyan1313/self_maintaining_api
cd self_maintaining_api
cp .env.example .env        # then open .env and fill in your own values
npm ci
npm run consumer:install
npm run db:up               # starts the database (Docker must be running)
npm run db:migrate
npm test                    # everything should pass
```

## 3. Taking a step

1. Open the repo's **Issues** tab and pick an issue with the green **`ready`** label.
2. Click **Assign yourself** on it, so nobody else takes it.
3. Make sure its prompt file is in `prompts/` (download it there if it is missing).
4. In the project folder, run `claude` and type:
   ```
   Read prompts/NN_name.md and follow it exactly.
   ```
   Claude Code pulls the latest `main`, checks that the issue is assigned to you, and works on its
   own branch.

## 4. Finishing

1. Claude Code opens a **Pull Request** (it never merges by itself).
2. Save the chat into the PR: in Claude Code, run
   `/export docs/chat-logs/incNN-<yourname>.txt`, then ask Claude Code to commit and push it.
3. Ask a teammate to look at the PR.
4. Merge it on GitHub with **"Create a merge commit"**. Never use squash or rebase, because they
   break the branch graph the course wants to see.
5. Merging closes the issue. Any issue that was waiting on it turns `ready` automatically.

## 5. Rules

- Only work on an issue that is **assigned to you**.
- Never push straight to `main`. Everything goes through a Pull Request.
- Never commit `.env` (it holds your secrets).
- If you get stuck, post in the group chat instead of letting Claude Code guess on big changes.
