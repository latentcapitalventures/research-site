# Latent research site

Public GitHub Pages host for Latent Capital desk research packs.

**Hub:** https://latentcapitalventures.github.io/research-site/

## Updating the index when a pack publishes

1. Publish / copy the pack HTML under `SPOT/`, `GOOGL/`, `IBKR/`, `Z/`, etc.
2. Edit `manifest.json` — add or refresh the pack entry (`ticker`, `name`, `path`, `kind`, `summary`, `updated`).
3. Commit and push `main`. Pages rebuilds the hub automatically.

Source builds live in the private `research-packs` repo. Cursor/`cursor[bot]` often lacks write access here; CoS pushes after pack publish.
