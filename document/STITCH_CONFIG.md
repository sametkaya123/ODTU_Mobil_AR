# Stitch Project Config

ODTU Mobil AR design system in Google Stitch.

## IDs

- **Project**: `projects/9301569926708551745`
  - Title: `ODTU Mobil AR`
  - Visibility: PRIVATE
  - Origin: STITCH
- **Design System Asset**: `assets/2ec39c38bf6f41568a2a7de04c765d77`
  - Display name: `Tactical AR Core`
  - Source screen: `projects/9301569926708551745/screens/1886638391905503333`
    (390x884, iPhone)
- **MCP Server**: `stitch` (local scope)
  - URL: `https://stitch.googleapis.com/mcp`
  - Header: `X-Goog-Api-Key: <user-provided>`

## Source

`document/DESIGN.md` — colors, typography, spacing, components, screen
inventory for the ODTU AR field app.

## Usage

Re-export design tokens for the React Native theme:

```bash
# Open in browser
open https://stitch.google.com  # then navigate to project 9301569926708551745

# Or via MCP
claude mcp list  # verify stitch connected
# Use mcp__stitch__list_design_systems / get_screen to fetch generated
# variants and apply tokens to odtu-ar-poc/src/theme/*.
```

## Notes

- Stitch design system is the source of truth for *aesthetic* guidance.
  Numeric token values (hex codes, pt sizes) still live in
  `odtu-ar-poc/src/theme/colors.ts` and `typography.ts` — keep in sync.
- Signal phase colors (`#22C55E / #FACC15 / #EF4444`) are FIXED across
  all themes — traffic-light meaning.
- Regenerate design system by re-uploading DESIGN.md and re-calling
  `create_design_system_from_design_md`.
