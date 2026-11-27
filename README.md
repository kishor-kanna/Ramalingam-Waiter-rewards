# Waiter Daily Rewards

Waiters tap each item they serve on their phone. Each item has a daily target (for example 10 Soup = ₹100), and the count stops at the target. It works across several branches:

| Who | Page | Signs in with | Can do |
|---|---|---|---|
| Operations manager | `ops.html` | Operations PIN | Set targets for each branch, add or close branches, see every branch live, payouts for all branches, backup |
| Branch manager | `manager.html` | Branch + branch PIN | Live board, payouts and waiters for their branch only |
| Waiter | `index.html` | Branch + name + PIN | Tap sales, see today's progress and last 7 days |
 Everything is stored in one Google Sheet, and each morning the previous day's totals are saved as a CSV file in GitHub.

| File | What it is | Where it goes |
|---|---|---|
| `index.html` | Waiter page | GitHub Pages (public repo) |
| `manager.html` | Branch manager page | GitHub Pages (same repo) |
| `ops.html` | Operations manager portal | GitHub Pages (same repo) |
| `apps-script/Code.gs` | The backend | Inside the Google Sheet (Extensions → Apps Script) |
| `apps-script/appsscript.json` | Optional settings file for the script | Only needed if you use clasp |

Setup takes about 20 minutes.

---

## 1. Create the Google Sheet and backend

1. Go to [sheets.new](https://sheets.new) and name the sheet **Waiter Rewards**.
2. Open **Extensions → Apps Script**. Delete what's there and paste in all of `apps-script/Code.gs`. Save.
3. Click the ⚙️ **Project Settings** gear and set **Time zone** to **(GMT+05:30) India Standard Time**, or your restaurant's time zone.
4. Go back to the editor, choose **setup** in the function dropdown, and click **Run**. Google asks for permission. Choose your account → *Advanced* → *Go to project* → *Allow*.

This creates the tabs **Branches, Targets, Waiters, Sales, Daily and Settings**, plus the nightly job. It also adds starter data:
- One branch, **Main**, whose manager PIN is **1234**
- Operations PIN: also **1234**. Change one of them straight away (the ops portal reminds you)
- One sample waiter in Main: **Ravi**, PIN **1111**

## 2. Publish the backend as a web app

1. Click **Deploy → New deployment**, then the gear → **Web app**.
2. Set **Execute as: Me** and **Who has access: Anyone**.
3. Click **Deploy** and copy the **Web app URL**. It ends in `/exec`.

> **If you edit Code.gs later**, go to **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. This keeps the same URL. If you choose "New deployment" instead, you get a new URL and the pages stop working.

## 3. Connect the pages

Open `index.html`, `manager.html` and `ops.html` in a text editor. Near the bottom of each, replace

```js
const API_URL = 'PASTE_YOUR_WEB_APP_URL_HERE';
```

with your URL:

```js
const API_URL = 'https://script.google.com/macros/s/AKfy.../exec';
```

## 4. Host the pages on GitHub Pages

1. On GitHub, create a new **public** repository, for example `rewards`.
2. Click **Add file → Upload files** and upload `index.html`, `manager.html` and `ops.html`.
3. Go to **Settings → Pages**. Under *Build and deployment*, pick **Deploy from a branch** → `main` → `/ (root)` → **Save**.
4. After a minute your links are:
   - Waiters: `https://YOUR-USERNAME.github.io/rewards/`
   - Branch managers: `https://YOUR-USERNAME.github.io/rewards/manager.html`
   - Operations: `https://YOUR-USERNAME.github.io/rewards/ops.html`

Free GitHub Pages needs a public repo. That's fine because the pages hold no data, only the URL. Nobody can read or change anything without a PIN.

**On each waiter's phone:** open the waiter link → pick their branch and name → enter their PIN → **Share → Add to Home Screen** (iPhone) or **⋮ → Add to Home screen** (Android).

The home-screen icon is the Ramalingam Hotel logo, and the page opens full screen like an app. It also opens without internet: taps are saved on the phone and sent when the connection comes back. The manager page and the ops portal can be added to the home screen the same way. Each gets its own icon and opens straight to its own page.

## 5. Daily backup to GitHub (recommended)

Use a **separate, private** repository for the data. Payouts should not be public.

1. On GitHub, create a **private** repository, for example `rewards-data`, and tick *Add a README*.
2. Create a token: profile picture → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
   - Expiration: up to 1 year (set a reminder to renew it)
   - Repository access: **Only select repositories → rewards-data**
   - Permissions → Repository permissions → **Contents: Read and write**
   - Generate it and copy the token.
3. In Apps Script, open ⚙️ **Project Settings → Script properties → Add script property** and add:

   | Property | Value |
   |---|---|
   | `GITHUB_TOKEN` | the token you copied |
   | `GITHUB_REPO` | `YOUR-USERNAME/rewards-data` |
   | `GITHUB_BRANCH` | only if your branch isn't `main` |

4. In the editor, run **testGitHub**. A `data/README.md` file should appear in the repo.

From then on, every morning around 6 AM, a file such as `data/2026-11-27.csv` is added:

```
shift,branch,waiter,item,sold,target,reward,earned
2026-11-27,Main,Priya,Soup,10,10,100,100
...
```

The token is stored only in the script's settings. It never appears in the web pages.

---

## Day to day

**Waiters** tap **+1** each time they serve an item. The count stops at the target, and the button changes to "✓ Target reached". **Undo last** fixes a mistaken tap. If the internet drops, taps are kept on the phone and sent when it's back, and the screen shows "3 taps not saved yet".

**The operations portal** (`ops.html`) has five tabs:
- **Overview** – today's earnings for every branch. Tap a branch to see its waiters.
- **Targets** – pick a branch and change items, quantities and rupee rewards. **Save for all branches** copies the same targets everywhere.
- **Branches** – add a branch and its manager PIN, change PINs, or untick *On* to close one. A new branch starts with the first branch's targets. Names can't be changed after saving, because history is linked to them.
- **Payouts** – one branch or all branches, any dates. **Copy totals** pastes into a spreadsheet.
- **Settings** – backup status, **Back up yesterday now**, and the operations PIN.

**Daily grooming check.** Rewards are only paid to waiters the branch manager approves each day: groomed, in uniform and on time.
- The manager opens **Check-in** at the start of the shift and taps **✓** or **✗** for each waiter. ✗ asks for a reason (Not groomed, Late, Uniform, Other). Decisions can be changed or undone any time that day.
- Waiters see *Waiting for grooming check*, *Approved* or *Not approved: reason* at the top of their page. They can tap sales either way, but rupees only count once approved.
- **A waiter nobody checks that day is not paid** for it. The ops overview shows how many waiters each branch has checked.
- Payouts, the month view and the GitHub backup only include approved days. The backup has a `check` column (`ok`, `no:Late`, `none`).

**The branch manager page** (`manager.html`) shows only that branch:
- **Check-in** – the daily grooming check (opens first).
- **Today** – every waiter's live counts, check status and earnings, refreshed every 30 seconds.
- **Payouts** – what each waiter earned between two dates.
- **Waiters** – add waiters, each with a PIN (one is generated for you). Untick *On* when someone leaves; their history is kept. The same name can be used in different branches.
- **Settings** – change the branch PIN.

The operations PIN also opens any branch on the manager page.

**Working day:** a day runs from **4 AM to 4 AM**, so sales after midnight count toward that night's shift. To change this, edit `RESET_HOUR` at the top of `Code.gs` (then make a new version, see step 2).

**Where the data lives:**
- *Sales* – every tap, kept for 3 days
- *Daily* – totals per branch, waiter, item and day, kept forever
- GitHub – the same daily totals as CSV files

## Good to know

- **Check counts against your bills.** Waiters record their own sales, so compare now and then with your billing system before paying.
- **Target changes apply to today straight away.** If you raise Biryani from 10 to 15 at 3 PM, anyone at 10 loses that reward until they reach 15. Change targets before opening, or after closing.
- **Renaming an item or waiter** starts fresh under the new name. Old history keeps the old name.
- **5 wrong PINs** locks that name for 10 minutes. This stops people from guessing PINs.
- **Free Google account limits** handle 30 waiters comfortably, because taps are sent in batches. If the Sheet ever shows errors in a very busy rush, a Google Workspace account has higher limits.
- PINs are stored in the Sheet as plain text. Keep the Sheet private; only you need access to it.

## Upgrading from the single-restaurant version

1. Paste the new `Code.gs` into Apps Script, replacing everything, and save.
2. **Deploy → Manage deployments → ✏️ → Version: New version → Deploy.** The URL stays the same.
3. Upload the new `index.html`, `manager.html` and `ops.html` to GitHub.

The first request after the update moves your existing waiters, targets and history into a branch called **Main**. Main's manager PIN and the new operations PIN both start as your old manager PIN. Sign in to `ops.html` with it and give Main a different PIN in **Branches**. Waiters who are already signed in stay signed in.
