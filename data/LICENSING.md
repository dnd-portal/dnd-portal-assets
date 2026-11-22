# Content licensing and attribution

The `data/content/` directory contains original D&D Portal editorial writing alongside facts and rules referenced from third-party sources. **No repository-wide license grant for D&D Portal's original writing or structured editorial data has been decided.** Contact the repository owner before redistributing that original material under a new license. Storing or publishing data in GitHub does not by itself license it for reuse.

## SRD material (CC BY 4.0)

The *System Reference Document 5.1* and *System Reference Document 5.2.1* include specified material offered under the [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/legalcode) license. This is a license for covered SRD material, **not for every D&D book, website, image, trademark, or piece of art**.

- Official [SRD 5.1 PDF](https://media.wizards.com/2023/downloads/dnd/SRD_CC_v5.1.pdf)
- Official [SRD 5.2.1 download page](https://www.dndbeyond.com/srd)

Each species edition's `sources` array records the applicable SRD IDs, official document URLs, license identifier/link and **full official attribution statement**. Human examples are `data/content/species/human/editions/5e.json` (`srd-5.1`) and `editions/5.5e.json` (`srd-5.2.1`; with `srd-5.1` for a historical comparison). The validation script checks these prescribed notices.

Anyone distributing covered SRD material must comply with the terms of CC BY 4.0, including retaining required attribution, identifying the applicable source and license, and indicating modifications where appropriate. Consult the license and each SRD's Legal Information section before redistribution. A downstream renderer or API should make this attribution accessible; having it only in stored metadata is not necessarily sufficient for a final publication.

## Reference-only material

D&D Beyond, Player's Handbook and other non-SRD references may be consulted for verification but **are not automatically licensed for redistribution**. A source with `license.id = "reference-only"` grants no permission to copy protected writing or artwork. D&D Portal's prose should remain original and limited to legitimately reusable material.

## Branding, graphics and original content

The root [`LICENSE`](../LICENSE) addresses proprietary D&D Portal branding, icons and other visual assets and remains in force. It does **not** convert SRD material to proprietary content, and the SRD's Creative Commons terms do **not** license D&D Portal trademarks, logos, proprietary artwork or separately owned editorial writing. Third-party marks and artwork retain their respective rights.

**Owner decision pending:** select and publish an explicit license, if any, for D&D Portal's own original editorial material and JSON data. Until then, this document makes no new license grant. Repository publishing workflows, asset-domain hosting and the npm package's `files` list are not modified by these content additions.
