# should-i-render

[![npm version](https://img.shields.io/npm/v/should-i-render.svg)](https://www.npmjs.com/package/should-i-render)
[![license: MIT](https://img.shields.io/badge/code-MIT-blue.svg)](LICENSE)
[![measured index](https://img.shields.io/badge/measured%20index-vibecodng.com-2c41f0.svg)](https://vibecodng.com/components/)

`should-i-render` is a read-only MCP server for choosing measured React components and complete vibecodng page templates from a curated snapshot. It answers fit questions with terse verdicts and practical adoption facts instead of returning source dumps.

The bundled snapshot currently contains the published should-i-render index. It runs over stdio, needs no API key, database, or network access, and clamps every text response to approximately 500 tokens.

The hosted free beta at [vibecodng.com](https://vibecodng.com/#agents) reads the live index and includes 100 tool calls per API key per UTC day. Create a key in the browser, then connect an HTTP-capable MCP client to `https://vibecodng.com/mcp`. Use this npm package when you want a private, offline, versioned snapshot with no quota.

## Local use

```json
{
  "mcpServers": {
    "should-i-render": {
      "command": "node",
      "args": ["/path/to/should-i-render/server.js"]
    }
  }
}
```

Node 20 or newer is required. Run `npm test` to verify the bundled snapshot, tool metadata, structured responses, and response cap.

With npm, no checkout is needed:

```json
{
  "mcpServers": {
    "should-i-render": {
      "command": "npx",
      "args": ["-y", "should-i-render@0.2.3"]
    }
  }
}
```

The hosted service may add paid plans later for fresher data, higher quotas and team workflows. The published offline package remains available under the licenses below.

## Tools

- `find_component({task, pattern?, style?, palette?})` ranks up to three verified, rendering fits over the component prose, pattern, style, and measured results. Failure warnings stay out of recommendations. Pass a palette slug to append its CSS variables.
- `palette_pick({mood?})` returns one to three curated accessible palettes with hex roles and a copyable CSS-variable block.
- `check_component({name})` returns the full verdict, skip conditions, and measured strip.
- `alternatives({name})` ranks same-pattern candidates.
- `install_plan({name})` returns dependencies, bare-harness gaps, provider requirements, setup notes, license, author credit, the measured gallery page, the upstream source, and an exact shadcn command when the source supports it.
- `skip_list({pattern, style?})` puts explicit failure warnings and the worst measured offenders first.
- `find_template({task, category?, style?})` ranks up to three complete page templates and excludes failed audits.
- `check_template({name})` returns one template's stack, license, audit status, preview, source, download, and palette variants.
- `template_plan({name, palette?})` returns an exact clone/setup plan and can select a built palette preview.

Every tool includes a title, read-only annotations, an output schema, and structured content alongside the clamped text response.

## Palettes

The package bundles 24 original four-color palettes. Each palette defines `accent`, `surface`, `text`, and `muted`; every text-on-surface pair is validated at WCAG AA contrast of 4.5:1 or better. Use `palette_pick` with a palette slug or moods such as `dark`, `light`, `pastel`, `neon`, `retro`, `earth`, `warm`, `cold`, or `mono`.

```css
:root {
  --bw-accent: #E85D4A;
  --bw-surface: #FFF7F1;
  --bw-text: #34231F;
  --bw-muted: #775F57;
}
```

Automatic theming applies to first-party components; third-party entries need manual mapping.

## What the measured strip means

`RENDERS` is the prepared harness mount result. `A11Y` is the sum of recorded axe violations. `KB` is the marginal gzip bundle size over the harness baseline. `BARE` is a second build-and-mount pass without the prepared shadcn-style helpers. `PROVIDER` means a missing-provider mount error was measured.

## The style axis

Pattern and style answer different questions. A pattern is what the component does, such as button, calendar, carousel, or text reveal. A style is the visual world it belongs to, such as minimal-flat, brutalism, spatial, bento, or dark-futuristic. Filtering by both is useful when the interaction is fixed but the product language is not.

Styles are editorial classifications, not package capabilities. Two entries with the same pattern and style can still differ sharply in dependencies, accessibility findings, bundle cost, bare compatibility, and provider requirements.

## Data

`data/components.json` is a point-in-time export of published component records. It contains prose, measured results, source and author credit, license metadata, pattern and style, and relative preview paths. It does not contain preview image or video bytes. `data/palettes.json` is the bundled palette catalog, and `data/templates.json` describes the public complete-template library.

Set `SHOULD_I_RENDER_DATA=/path/to/components.json` to test another snapshot with the same shape.

## Limitations

- The harness currently measures React components only.
- Coverage is curated rather than an exhaustive registry crawl.
- The snapshot is point-in-time; upstream component APIs and dependencies can change after export.
- Harness results are controlled measurements, not production QA. They do not replace browser, design-system, accessibility, security, or user testing in your app.
- Demos are written against each component's source API and drive the screenshots. A demo can cover the intended state without covering every prop, interaction, server behavior, or data-loading path.
- A clean accessibility count means the recorded demo had no axe findings in this harness. It is not an accessibility certification.
- Verdicts and style labels are editorial judgment grounded in the recorded measurements and source APIs.

## License

Server code is MIT licensed. The compiled index metadata is CC BY 4.0 with attribution to mrkeyoor.com; individual component source projects retain their own licenses and author credit.

## Contributing

- Found a wrong verdict or stale component record? [Open an issue](https://github.com/mrkeyoor/should-i-render/issues).
- Code changes are welcome for the MCP server and ranking logic. Keep responses inside the clamp and run `npm test` before opening a pull request.
- `data/components.json` is generated from the measured vibecodng index, so data corrections should start as an issue rather than a direct edit to the snapshot.
