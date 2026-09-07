# Docs assets

Images used by the README and GitHub social preview.

| File | Use |
| --- | --- |
| `hangnone-logo.png` | README logo (used on GitHub; SVG kept as source) |
| `hangnone-logo.svg` | Vector logo source |
| `hangnone-og.png` | GitHub **Settings → General → Social preview** upload |
| `hangnone-demo.png` | README terminal demo (PNG — reliable on GitHub) |
| `demo.svg` | Vector terminal demo source |
| `decision-flow.png` | README decision diagram (PNG — reliable on GitHub) |
| `decision-flow.svg` | Vector decision diagram source |

To refresh a real terminal capture later, run:

```bash
node dist/cli.js scan ./fixtures/07-gha-mixed
```

Then record with [VHS](https://github.com/charmbracelet/vhs) or a GIF tool if you want an animated demo.
