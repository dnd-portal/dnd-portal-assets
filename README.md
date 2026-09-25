<div align="center">

<img src="./branding/dnd-portal-logo-wide.svg" alt="DND Portal" width="420">

<br><br>

# DND Portal Assets

**Shared branding, icons and visual assets for the DND Portal ecosystem.**

[Website](https://dnd-portal.com) ·
[GitHub Organization](https://github.com/dnd-portal)

</div>

---

## About

This repository contains the shared visual assets used across DND Portal projects.

Keeping these assets in one place provides a consistent source for branding,
application icons and other reusable visual resources.

## Structure

### `branding/`

Official DND Portal branding assets, including:

- logos
- application icons
- favicons
- social cards
- platform-specific branding

### `icons/`

Reusable icons used throughout the DND Portal ecosystem.

## Usage

The stable public asset origin is:

```text
https://assets.dnd-portal.com/
```

Assets can be referenced directly by DND Portal projects instead of maintaining
duplicate copies across multiple repositories. Public paths mirror the
repository structure. For example:

```text
https://assets.dnd-portal.com/branding/dnd-portal-logo-wide.svg
https://assets.dnd-portal.com/branding/dnd-portal-icon.svg
https://assets.dnd-portal.com/branding/dnd-portal-social-card.png
https://assets.dnd-portal.com/icons/white/classes/barbarian.svg
```

Use the existing filename and path when adding a reference. Do not use hashed,
build-specific, `dist`, or GitHub raw-content URLs for public assets.

When adding a new asset:

1. Put it in the appropriate `branding/` or `icons/` subdirectory.
2. Use a descriptive, stable filename.
3. Confirm that the public URL matches the repository path.
4. Treat a published path as a public API: do not casually rename or delete it.

If an asset needs to be replaced, prefer replacing the file at the same stable
URL when its semantic purpose remains the same. Introduce a new path only when
the asset's purpose or format has changed.

The public website and future desktop applications should use this asset origin
for shared visual assets. The GitHub Packages publication is a separate
distribution channel for projects that need the `@dnd-portal/assets` package;
it does not change the public URL contract above.

When using an asset in another project, prefer linking to a specific file on
the `main` branch or a versioned release when stability is important.

## Licensing

DND Portal branding is owned by DND Portal and is not released under an
open-source software license.

Some third-party icons or trademarks may remain subject to their respective
owners' licenses and terms.

See [LICENSE](./LICENSE) for details.

---

<div align="center">

**DND Portal** · [dnd-portal.com](https://dnd-portal.com)

</div>
