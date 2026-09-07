# Docs assets

Images used by the README and GitHub social preview.

| File | Use |
| --- | --- |
| `hangnone-logo.svg` | README logo — permission prompt with hang cut (preferred) |
| `hangnone-logo.png` | Raster logo (includes wordmark variant; SVG is the mark of record) |
| `hangnone-og.png` | GitHub **Settings → General → Social preview** upload |
| `hangnone-demo.png` | Optional raster terminal mock (prefer `demo.svg`) |
| `demo.svg` | Crisp terminal demo in README |
| `decision-flow.svg` | Decision-table flow diagram |

To refresh a real terminal capture later, run:

```bash
node dist/cli.js scan ./fixtures/07-gha-mixed
```

Then record with [VHS](https://github.com/charmbracelet/vhs) or a GIF tool if you want an animated demo.
