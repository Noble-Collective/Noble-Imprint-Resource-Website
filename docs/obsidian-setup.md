# Editing Noble Imprint Resources with Obsidian

This guide walks you through setting up Obsidian to edit Noble Imprint resource files, synced with GitHub so your changes automatically publish to the website.

---

## What This Gets You

- Edit resource files in Obsidian with rich formatting preview
- Push your changes to GitHub with a couple clicks
- The website automatically rebuilds when you push (~2 minutes)
- Works alongside the web editor — your changes show up everywhere

---

## Before You Start: Where to Put the Files

You probably have an existing Obsidian vault folder that gets backed up (to iCloud, Dropbox, Time Machine, etc.). The GitHub repo we're about to set up has its **own sync system** (GitHub), so you have two options:

**Option A: Inside your existing Obsidian vault (recommended)**
Put the resources repo as a subfolder inside your current vault. For example:
```
Your Vault/
  Your existing notes/
  Noble Imprint Resources/    ← the GitHub repo goes here
```
This means your existing backup system also backs up these files (belt and suspenders — GitHub is the primary backup, your local backup is extra safety).

**Option B: As a separate Obsidian vault**
Put it in a completely separate location outside your backed-up folders. You'd switch between vaults in Obsidian when you want to edit resources. This keeps things cleanly separated but means switching vaults.

Either works. Option A is simpler for daily use.

---

## Step 1: Install Git (one-time setup)

Git is a tool that syncs files with GitHub. Your Mac may already have it.

1. Open **Terminal** (press `Cmd + Space`, type "Terminal", press Enter)
2. Type this and press Enter:
   ```
   git --version
   ```
3. If you see a version number like `git version 2.39.0`, you're good — **skip to Step 2**
4. If you see a popup asking to install "command line developer tools", click **Install** and wait for it to finish. Then try the command again to confirm.

---

## Step 2: Create a GitHub Personal Access Token (one-time setup)

This gives Obsidian permission to push changes to GitHub on your behalf.

1. Open your browser and go to: https://github.com/settings/tokens
2. Sign in if needed
3. Click **Generate new token** → choose **Generate new token (classic)**
4. Fill in:
   - **Note**: `Obsidian Noble Imprint`
   - **Expiration**: Choose "No expiration" (or set a long period like 1 year)
   - **Scopes**: Check the box next to **repo** (this gives access to the content repository)
5. Scroll down and click **Generate token**
6. You'll see a long string starting with `ghp_...` — **copy it now and save it somewhere safe** (a password manager, a note, etc.). GitHub will never show it again.

---

## Step 3: Download the Content Repository

This downloads all the resource files to your Mac.

1. Open **Terminal**
2. Navigate to where you want the files. For example, if your Obsidian vault is in your Documents folder:
   ```
   cd ~/Documents/Your Vault Name
   ```
   Replace `Your Vault Name` with the actual name of your Obsidian vault folder. If the name has spaces, put quotes around it:
   ```
   cd ~/Documents/"My Obsidian Vault"
   ```
   
   *Not sure where your vault is?* Open Obsidian, look at the vault name in the bottom-left corner, then go to **Settings → Files & Links** — the vault path is shown there.

3. Download the repository:
   ```
   git clone https://github.com/Noble-Collective/noble-imprint-resources.git "Noble Imprint Resources"
   ```
   This creates a folder called "Noble Imprint Resources" with all the content files.

4. Set up your identity (so your commits show your name):
   ```
   cd "Noble Imprint Resources"
   git config user.name "Matt"
   git config user.email "your-github-email@example.com"
   ```
   Use the email address associated with your GitHub account.

5. Store your token so you don't have to enter it every time:
   ```
   git config credential.helper osxkeychain
   ```
   The next time git asks for a password, enter your personal access token (from Step 2) instead of your GitHub password. It will be saved in your Mac's keychain after that.

---

## Step 4: Install the Obsidian Git Plugin

1. Open Obsidian
2. If you used Option A (subfolder inside your vault), you should already see the "Noble Imprint Resources" folder in your file browser on the left
3. If you used Option B (separate vault), go to **Open another vault** and select the "Noble Imprint Resources" folder
4. Go to **Settings** (gear icon in the bottom-left) → **Community plugins**
5. If you see "Restricted mode is on", click **Turn off restricted mode** and confirm
6. Click **Browse**
7. Search for **Obsidian Git**
8. Click **Install** on the one by "Vinzent" (it should be the top result)
9. Click **Enable**

---

## Step 5: Configure Obsidian Git

1. Go to **Settings → Obsidian Git** (it's now in the left sidebar under Community Plugins)
2. Set these options:
   - **Auto pull interval (minutes)**: `10` — this automatically fetches the latest changes from GitHub every 10 minutes so you stay up to date
   - **Auto commit-and-push interval (minutes)**: `0` — leave this off so you control when your changes are published
   - **Pull on startup**: **On** — pulls the latest changes whenever you open Obsidian
3. Close Settings

---

## How to Edit (Daily Workflow)

### Starting Your Session

1. Open Obsidian
2. If you set "Pull on startup", it automatically grabs the latest files. If not, pull manually:
   - Press `Cmd + P` to open the command palette
   - Type "pull" and select **Obsidian Git: Pull**
   - Wait a moment — you should see a small notification confirming the pull

### Editing Files

Browse the file tree on the left. The structure looks like:
```
series/
  Passage Series/
    HomeStead/
      sessions/
        01-FrontMatter.md
        02-PartOne-Preparation.md
        ...
  Narrative Journey Series/
    Foundations/
      The Call of Christ/
        sessions/ ...
```

Open any `.md` file and edit it. Obsidian shows you a formatted preview as you type.

### Publishing Your Changes

Think of this as a two-step process: first you **package** your changes (commit), then you **send** them to GitHub (push). Here's exactly how:

**Step A — Commit (package your changes):**

1. Press `Cmd + P` — a search bar appears at the top of Obsidian (this is called the "command palette")
2. Start typing the word `commit` — you'll see a list of commands filtering as you type
3. Click on **Obsidian Git: Commit all changes**
4. A text box appears asking for a commit message — type a short description of what you changed, for example:
   - "Edited discussion questions in Session 2"
   - "Fixed typo in Part One intro"
   - "Rewrote prayer section"
5. Press **Enter**
6. You should see a small notification pop up in the top-right corner confirming the commit

**Step B — Push (send to GitHub):**

1. Press `Cmd + P` again to reopen the command palette
2. Start typing the word `push`
3. Click on **Obsidian Git: Push**
4. Wait a few seconds — you should see a notification confirming the push succeeded

That's it. The website will automatically rebuild and deploy within about 2 minutes. You can verify by checking the "Website last updated" timestamp in the footer of the site.

**First time only:** The very first time you push, your Mac may pop up a dialog asking for a username and password. Enter your GitHub username and paste your **personal access token** from Step 2 as the password (not your actual GitHub password). Your Mac will save this in its keychain so you won't be asked again.

**How often should you do this?** Push every 15–20 minutes, or after finishing a section of work. Don't accumulate hours of unsaved edits — if your laptop dies or Obsidian crashes before you push, unpushed changes could be lost.

**Quick summary to memorize:**
- `Cmd + P` → type "commit" → Enter a message → Enter
- `Cmd + P` → type "push" → done

### Pulling the Latest Changes

Before you start editing each day (or if you think someone else may have made changes), pull the latest version from GitHub:

1. Press `Cmd + P`
2. Start typing `pull`
3. Click on **Obsidian Git: Pull**
4. Wait for the confirmation notification

If you turned on "Pull on startup" in Step 5, this happens automatically when you open Obsidian. But it's a good habit to pull manually if you've been away for a while.

### If Something Goes Wrong

**"Merge conflict" error when pulling:**
This means someone else changed the same file while you were editing it. Don't panic — your work isn't lost. Open the file that has the conflict. You'll see something like this:

```
<<<<<<< HEAD
Your version of the text
=======
Their version of the text
>>>>>>> origin/main
```

The part between `<<<<<<< HEAD` and `=======` is YOUR version. The part between `=======` and `>>>>>>> origin/main` is THEIR version. Delete the marker lines (`<<<<<<<`, `=======`, `>>>>>>>`), keep whichever text you want (or combine them), and then commit and push again.

**Push fails or asks for a password:**
Enter your GitHub username and your personal access token from Step 2 (not your GitHub password). If you set up the keychain helper in Step 3, this should only happen once.

**Notification says "Nothing to commit":**
This means you haven't made any changes since your last commit, or Obsidian hasn't detected your edits yet. Try saving the file (`Cmd + S`) first, then commit again.

**Files look out of date:**
Pull manually: `Cmd + P` → type "pull" → click **Obsidian Git: Pull**

---

## Formatting Reference

When editing, use this markdown syntax:

| What you want | What to type |
|---|---|
| Heading levels | `#` through `######` (1–6 hash marks) |
| Bold | `**bold text**` |
| Italic | `_italic text_` or `*italic text*` |
| Blockquote | `> quoted text` |
| Attribution | `<< **Author Name**` |
| Verse numbers | `<sup>1</sup>` |
| Line break in table | `<br>` |

---

## Important Notes

- **Your edits publish directly** — there's no review/approval step when editing through Obsidian. What you push goes live.
- **Suggestions from others are safe** — if someone makes a suggestion on the website while you're editing in Obsidian, it doesn't conflict. Suggestions are stored separately and only touch the file when someone accepts them.
- **Avoid editing the Test Book** — the folder `series/Narrative Journey Series/Foundations/Test Book/` is used for development testing.
- **Don't edit `meta.json` files** — these control book visibility settings on the website.
