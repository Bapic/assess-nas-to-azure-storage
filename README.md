# Assess NAS Sources to Azure Storage

A configurable browser-based decision tree that guides users through a series of questions about their NAS workload and produces a filtered list of eligible Azure Storage target SKUs.

---

## What it does

The app walks through a sequence of questions (Azure region, source NAS appliance, target services, redundancy, access frequency, workload type, etc.) and applies a series of filters to narrow down the full set of seven Azure Storage outcomes to only those that are compatible with the user's environment. At the end, all eligible SKUs are displayed together with a summary of the inputs provided.

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | [React 19](https://react.dev/) (via [Vite](https://vitejs.dev/)) |
| Language | JavaScript (JSX) — no TypeScript |
| Styling | Plain CSS (no framework) |
| State | React `useState` only — no external state library |
| Build | Vite 8 |

---

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- npm (bundled with Node)

### Install and run

Use one of the two setup paths below.

### Path A: Quick start (clone and run)

```bash
# 1. Clone this repo
git clone https://github.com/Bapic/assess-nas-to-azure-storage.git
cd assess-nas-to-azure-storage

# 2. Install dependencies
npm install

# 3. Start the development server
npm run dev
```

The app will be available at **http://localhost:5173**.

### Path B: Fork-first setup (recommended for contributors)

```bash
# 1. Fork this repo and clone your fork
git clone https://github.com/<your-github-user>/assess-nas-to-azure-storage.git
cd assess-nas-to-azure-storage

# 2. Add the source repository as upstream
git remote add upstream https://github.com/ansubram/assess-nas-to-azure-storage.git

# 3. Verify remotes
git remote -v

# 4. Install dependencies and run
npm install
npm run dev
```

Expected `git remote -v` output pattern:

```text
origin   https://github.com/<your-github-user>/assess-nas-to-azure-storage.git (fetch)
origin   https://github.com/<your-github-user>/assess-nas-to-azure-storage.git (push)
upstream https://github.com/ansubram/assess-nas-to-azure-storage.git (fetch)
upstream https://github.com/ansubram/assess-nas-to-azure-storage.git (push)
```

### Build for production

```bash
npm run build       # outputs to dist/
npm run preview     # local preview of the production build
```

---

## Project structure

```
src/
├── data/
│   ├── treeConfig.js             ← ALL questions and outcomes live here
│   ├── regionAvailability.js     Maps each outcome to the regions it supports
│   └── redundancyAvailability.js Maps each outcome to its supported redundancy types
│
├── utils/
│   └── matchOutcomes.js          Filtering engine — runs all gates against user answers
│
├── components/
│   ├── DecisionTree.jsx          Renders questions serially; handles all question types
│   └── Results.jsx               Renders eligible outcomes + input summary
│
├── App.jsx                       Root component — owns answers state
├── index.css                     All styling
└── main.jsx                      Vite entry point
```

---

## How to customise the decision tree

All decision tree content lives in **`src/data/treeConfig.js`**. You do not need to touch any component code for most changes.

### Adding or editing a question

Questions are defined in the `questions` array. Each question object supports these fields:

| Field | Required | Description |
|---|---|---|
| `id` | ✅ | Unique string identifier — used as the key in `answers`. |
| `text` | ✅ | Question label shown to the user. |
| `type` | ✅ | `"select"` (dropdown), `"multiselect"` (checkboxes), or omit for button list. |
| `options` | ✅ | Flat `[{ label, value }]` or grouped `[{ group, items: [{label, value}] }]`. |
| `placeholder` | — | Disabled first `<option>` shown in a select dropdown. |
| `note` | — | Small callout shown below the question heading. |
| `showIf` | — | Condition to show/hide the whole question (see below). |

#### `showIf` syntax

```js
// Show only when the user answered a specific value
showIf: { questionId: "expectedValue" }

// Show only when an array answer (multiselect) includes a value
showIf: { questionId: { includes: "expectedValue" } }
```

Questions whose `showIf` condition is not met are silently skipped and their stored answers cleared.

#### `requiresAnswer` on individual options

Hide a single option within a question based on a prior answer:

```js
{ label: "Azure NetApp Files", value: "anf", requiresAnswer: { nas: "netapp" } }
```

---

### Adding or editing an outcome

Outcomes are defined in the `outcomes` array in `treeConfig.js`:

```js
{
  id: "my-outcome",          // unique string, referenced in serviceOutcomeMap
  title: "Display name",
  description: "Shown on the results page.",
  rules: [
    // Eligible if ANY rule set is a full subset of the user's answers.
    // Empty array [] means always eligible (filtered only by the gates below).
    { nas: "netapp" }
  ],
}
```

---

## Understanding the filtering pipeline

`src/utils/matchOutcomes.js` applies these gates **in order** for every outcome:

1. **Service gate** — only outcomes belonging to the user's selected target services (`serviceOutcomeMap` in `treeConfig.js`).
2. **Region gate** — outcome must be GA in the selected region (`regionAvailability.js`).
  Blob Archive uses a dedicated region set (derived from Azure products-by-region), while Blob Hot/Cool/Cold and Files use all app-listed public regions.
3. **Blob tier gate** — maps `blobAccessFrequency` to one blob tier outcome.
  If the selected tier is unavailable in the selected region, the engine upgrades to the nearest warmer Blob tier (`archive -> cold -> cool -> hot`) that is regionally available, and shows a notice in results.
4. **Media type gate** — maps `filesMediaType` to `files-premium-ssd` or `files-standard-hdd`.
5. **Redundancy gate** — outcome must support the selected redundancy type (`redundancyAvailability.js`).
  For Blob Archive only: if `zrs` or `gzrs` is selected, the engine uses `grs` for compatibility and shows a notice in results.
6. **Rules gate** — at least one rule set in `outcome.rules` must match the user's answers.

To add a new filter, add a gate block in `matchOutcomes.js` and a data file (if needed) following the same pattern.

---

## Example decision flow (end-to-end)

Example inputs:

- Region: `eastus`
- Source NAS: `netapp`
- Target services: `blobs`, `files`, `anf`
- Redundancy: `zrs`
- Blob access frequency: `cool`
- Files media type: `ssd`

How filtering resolves:

1. Service gate keeps all Blob, Files, and ANF outcomes.
2. Region gate keeps all of the above in `eastus`.
3. Blob tier gate keeps only `blob-cool`.
4. Media type gate keeps only `files-premium-ssd` for Files.
5. Redundancy gate keeps outcomes that support `zrs`.
6. Rules gate keeps `anf-default` because `nas = netapp`.

Final eligible outcomes:

- `blob-cool`
- `files-premium-ssd`
- `anf-default`

Note: If Blob access frequency is `archive` and redundancy is `zrs`/`gzrs`, Blob Archive remains eligible by applying `grs` for that tier and showing a compatibility message.

Note: If the selected Blob access tier is not available in the chosen region, the app upgrades to the nearest warmer available Blob tier (for example, Cold → Cool, Cool → Hot) and marks that result with a "Tier upgraded" badge.

---

## Adding a new Azure region

In `treeConfig.js`, add an entry under the correct `group` in the `region` question:

```js
{ label: "My New Region", value: "mynewregion" }
```

Then in `regionAvailability.js`, add `"mynewregion"` to `ANF_REGIONS` if Azure NetApp Files is supported there.

Also add `"mynewregion"` to `PUBLIC_REGIONS` so Blob and Files outcomes remain region-eligible for the new entry.

If Azure products-by-region does not list Archive Storage for `mynewregion`, add it to `ARCHIVE_UNSUPPORTED_REGIONS`.

---

## Outcomes reference

| ID | SKU |
|---|---|
| `blob-hot` | Azure Blob Storage — Hot Tier |
| `blob-cool` | Azure Blob Storage — Cool Tier |
| `blob-cold` | Azure Blob Storage — Cold Tier |
| `blob-archive` | Azure Blob Storage — Archive Tier |
| `files-standard-hdd` | Azure Files — Standard HDD (Provisioned v2) |
| `files-premium-ssd` | Azure Files — Premium SSD (Provisioned v2) |
| `anf-default` | Azure NetApp Files — Default SKU |

---

## Contributing

1. Create a branch from `master`.
2. Make your changes (most content changes only require editing `src/data/treeConfig.js`).
3. Verify locally with `npm run dev` (and `npm run build` before opening a PR).
4. Open a pull request with a short summary of what changed and why.

---

## Working with origin and upstream

This repository is commonly used with a fork workflow:

- `origin` → your fork (example: `Bapic/assess-nas-to-azure-storage`)
- `upstream` → source repo (example: `ansubram/assess-nas-to-azure-storage`)

Useful commands:

```bash
# Check remotes
git remote -v

# Fetch latest refs
git fetch origin
git fetch upstream

# Compare your branch with upstream
git rev-list --left-right --count upstream/master...origin/master

# Fast-forward local master from upstream (when no local commits)
git checkout master
git merge --ff-only upstream/master

# Push updated master to your fork
git push origin master

# Create a feature branch for your change
git checkout -b feat/<short-description>
```

---

## Original Vite template notes

The React Compiler is not enabled on this template because of its impact on dev and build performance. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
