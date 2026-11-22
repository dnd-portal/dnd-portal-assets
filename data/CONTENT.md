# JSON content structure

Structured content is stored under `data/content/<kind>/<slug>/`. Species use:

- `index.json` — shared ID, slug, edition list and default edition (currently `5.5e` for Human).
- `editions/<edition>.json` — edition-specific mechanics, sources and a section/block article.
- `faq/<edition>.json` — ordered FAQ index referencing article paths and global-FAQ flags.
- `faq/<edition>/<question-slug>.json` — individual FAQ questions, direct answers and full sections.

Edition IDs use `5e` and `5.5e`; years belong in normal descriptions and source metadata, **never** in filenames or inline link identifiers. Editorial paragraphs remain JSON strings. Inline links use `[[kind:slug@edition|Label]]` (the edition and label are optional), e.g. `[[class:fighter@5.5e|Fighter]]`.

## Validate

Install the development dependency, then run:

```sh
npm install
npm run validate:content
```

The script auto-discovers species under `data/content/`, validates against the [Draft 2020-12 schemas](../schemas/), checks cross-file IDs and references, and reports invalid syntax and conflicting basic-trait values. Unknown content types fail with a clear missing-schema-route error so future Classes, Spells and Monsters can be registered intentionally rather than silently skipped. External/other Wiki links absent from the **assets JSON registry** produce warnings until a shared registry or resolver is integrated. Use `node scripts/validate-content.mjs --content-dir /path/to/test/content` for isolated negative tests.

## Add a species

1. Create `data/content/species/<slug>/index.json` with stable metadata and supported edition IDs.
2. Add `editions/<edition>.json` containing mechanical fields, source metadata and article sections; reference each source from the traits that use it.
3. Add full FAQ article JSON files and a `faq/<edition>.json` index with paths, matching IDs and inclusion flags.
4. Run `npm run validate:content`; fix errors and review unresolved-link warnings before committing.
5. Check [content licensing](LICENSING.md) and independently verify the rules, links and artwork rights.

The Wiki renderer does **not** yet parse `[[...]]` strings or automatically consume these JSON files. Neither the existing assets website nor the published `@dnd-portal/assets` package automatically includes or exposes the new JSON/API. Content integration and publishing are separate tasks.

## Nested species options (subraces and lineages)

Child options live **inside** their parent, not alongside top-level species:

```text
data/content/species/elf/options/high-elf/
  index.json
  editions/5e.json
  faq/5e.json
  faq/5e/<question-slug>.json
```

- The child index uses a stable `species-option:<slug>` ID and `parentId: "species:elf"`. It advertises only editions with actual child edition files.
- The child edition uses `species-option:<slug>@<edition>`, `parentEdition`, `kind` (`subrace` or `lineage`), and `inheritsFrom` with an exact parent edition ID. Its `mechanics.additions` owns *only* child features; `mechanics.overrides` must explicitly identify and explain any genuine inherited-field change.
- Parent edition `subraceSelection.options` or `lineageSelection.options` registers choices with `pending-child-content` or `child-content-available`. A published child needs a matching child edition and `contentId`. These are **repository implementation states**, never campaign permissions.
- Each child has an independent FAQ index and articles, using the same common content blocks and source metadata. The validator discovers child and parent FAQs without adding placeholder children or copying parent FAQ articles.
- Use `[[species-option:high-elf@5e|High Elf]]` for child links. The future Wiki renderer and API must resolve those references; correct syntax is validated now.
- Run `npm run validate:content` and `npm run test:content-validator`. Regression tests fail on broken parent IDs, incompatible edition references, missing child FAQ targets, missing parent registration, and accidentally duplicated inherited mechanics.

The 2014 High Elf subrace uses `species:elf@5e`; the later High Elf lineage will use `species:elf@5.5e` in its **own edition file**. Parent features stay in their original edition documents. No 5.5e High Elf lineage, Wood Elf or Drow child JSON is published by adding the 2014 High Elf. A future class/subclass model can apply the same parent-reference and additive/override principle using its own class-specific schemas.
