# Contributing to Noted

Noted is a notes and labels app by Oxy, with real time sync, reminders, push notifications and web push. Its server is [Nilo](https://github.com/OxyHQ/Nilo) (`api.nilo.so`); this repository holds only the app.

**The contribution process lives in the [Oxy organisation CONTRIBUTING guide](https://github.com/OxyHQ/.github/blob/main/CONTRIBUTING.md)**: reporting an issue, filing a feature request, opening a pull request, code review, licensing. It applies here unchanged. This file layers on top of it the same way `AGENTS.md` files layer, so it is short on purpose: it carries only what is different about this repository.

## Where this repository came from

Noted was started from the Clarity codebase, a different product. The READMEs and this file have been rewritten, but the fork is worth knowing about: if you find something that mentions Clarity, an AI search engine or retired hosting, it is a leftover rather than a second product or a second database — Noted is a notes app, its notes live in Nilo, and the web app deploys to Cloudflare. Fix it where you see it.

## Prerequisites

- **Bun.** The package manager for every Oxy repository, never npm or yarn. The pinned version is `packageManager` in the root `package.json`, and CI installs that exact version.
- **Node.js 24.20.0 or newer**, for the Expo frontend tooling.
- **A Nilo API**, to sync. In development the app talks to port 4001 of the host it was opened from (run Nilo's API locally), or set `EXPO_PUBLIC_API_URL`. The test suite needs nothing running.

## Setup

```bash
git clone https://github.com/OxyHQ/Noted.git && cd Noted
bun install
cp packages/frontend/.env.example packages/frontend/.env   # optional overrides
bun run dev                                                # the Expo app
bun run dev:frontend                                       # the same, with --clear --tunnel
```

## Layout

A bun workspaces monorepo:

| Package | Stack | Purpose |
| --- | --- | --- |
| `packages/frontend` (`@noted/frontend`) | Expo (React Native and Web) | Main app: web, iOS, Android |
| `packages/shared-types` (`@noted/shared-types`) | TypeScript | Note, label and artifact DTOs, `normalizeNoteColor` |
| `desktop` | Tauri (Rust) | Noted Desktop, outside the Bun workspace |

`shared-types` has to be built before the app, which is why `build:frontend` builds it first. Run `bun run build:types` after changing a shared type.

## Tests

```bash
bun run --filter @noted/frontend test
```

Vitest, with test files next to the source or under `__tests__`.

CI runs the following on every pull request, and each line runs locally as written:

```bash
bun run build:types
bunx biome ci --error-on-warnings .  # Biome: lint + format check, whole repo, zero warnings
bun run typecheck                    # tsc --noEmit for the app
bun run --filter @noted/frontend test
bun run build:frontend
```

## Formatting and linting

Biome (`biome.json` at the root) formats and lints every package; there is no
ESLint or Prettier. `bun run lint` checks, `bun run lint:fix` applies safe
fixes and formatting, `bun run format` only formats. Every rule runs at its
recommended severity or stricter and CI fails on any warning; where code is
intentionally correct, suppress the one line with
`// biome-ignore lint/<group>/<rule>: <reason>`. The Expo app's
`EXPO_PUBLIC_*` guards (no destructuring of `process.env` or of `env` out of
`process`, whether declared, assigned or as a parameter default, and no computed
`process.env[...]` reads, all of which Metro silently fails to inline) are a
GritQL plugin in `biome-plugins/expo-env-vars.grit`, scoped to
`packages/frontend`.

Four ESLint core rules went with ESLint. `no-delete-var` and `no-octal` are
syntax errors to Biome's parser (every file is parsed as strict-mode module
code), and octal escapes are Biome's `noOctalEscape`. `no-invalid-regexp` is
covered by `tsc` for literals (`bun run typecheck`), and Biome's
`useRegexLiterals` turns a constant `new RegExp('…')` into one. Biome has no
`no-unexpected-multiline`, so `biome-plugins/no-unexpected-multiline.grit`
reports a `(`, `` ` `` or `[` that starts a line and continues a bare name on
the line above.

## Conventions

Architecture and product contracts, including the reason Noted deliberately
does not integrate with CrowdSource, live in `docs/index.mdx`. `AGENTS.md` keeps
only hard rules, commands and pointers for coding agents; do not turn it into a
second architecture document.

One thing worth knowing before your first pull request: **Noted has no shared or public surface.** Every note is a private page of the user's personal Nilo workspace, and Nilo scopes every request to the verified Oxy user. If you add a feature that changes that, say so explicitly in the pull request, because a good deal of the design in `AGENTS.md` rests on it.
