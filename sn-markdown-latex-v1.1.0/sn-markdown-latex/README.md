# Markdown + LaTeX for Standard Notes

A Standard Notes editor plugin. Write Markdown on the left, read the rendered note on the right, with math typeset by KaTeX.

## What it does

- **Math** in every common notation: `$…$` and `\(…\)` inline; `$$…$$` and `\[…\]` as blocks; `\begin{align}…\end{align}` (also `equation`, `gather`, `alignat`); chemistry with `\ce{H2O}`.
- **Markdown**: headings, lists, task lists, tables, code blocks, quotes, links, images.
- **Three views**: Edit, Split, Preview. Narrow panes (phones) start in Edit and stack Split vertically. Your choice is remembered.
- **Formatting toolbar and shortcuts**: `Ctrl/Cmd+B`, `+I`, `+K` (link), `Ctrl/Cmd+Shift+M` (inline math). `Tab` indents; press `Esc` then `Tab` to leave the editor.
- **Follows your Standard Notes theme** (light or dark) and honours the note's *locked* and *spellcheck* settings.
- Copying math from the preview gives you its LaTeX source.
- Prices such as `$5 and $10` stay plain text (Pandoc rules for `$`).

## Install in Standard Notes

1. Preferences → **Plugins** → **Install Custom Plugin**.
2. Paste `https://prasanth-nature.github.io/sn-markdown-latex/ext.json` and confirm.
3. Open a note → **Change note type** → **Others** → **Markdown + LaTeX**.
4. The first time, Standard Notes asks whether the plugin may read and save this note. Allow it.

## Publish or update on GitHub Pages

1. Put the files from this folder in the **root** of the repository (`index.html`, `ext.json`, `app.js`, `app.css`, `fonts/`, `.nojekyll`; `src/` and `test/` may come along).
2. Repository → **Settings → Pages** → Source: *Deploy from a branch* → Branch `main`, folder `/ (root)` → Save.
3. After a minute, `https://prasanth-nature.github.io/sn-markdown-latex/` opens a standalone preview of the editor, and `…/ext.json` shows the plugin descriptor.

The plugin identifier and URL did not change, so an already installed copy picks up new versions by itself. GitHub Pages caches for a few minutes; reload Standard Notes to fetch the latest.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Editor stays blank | Approve the permission prompt (step 4 above). If it was dismissed, reopen the note. |
| Opening the Pages URL shows 404 | Pages is not enabled yet (step 2 above), or the files are not in the repository root. |
| Changes to the plugin do not show | Wait a few minutes and reload Standard Notes. |
| Red squiggles under every word | That is Standard Notes' per-note *Spellcheck* switch. Turn it off in the note's options. |
| "Editing is disabled for this note" | The note is locked in Standard Notes. Unlock it there. |

## Develop

```bash
npm install
npm run build            # writes index.html, app.js, app.css, fonts/, ext.json into this folder
npm run build:preview    # one self-contained preview.html
npm test                 # needs Python + Playwright (Chromium); runs 75 checks
```

`src/sn.js` is the Standard Notes component protocol (handshake, streaming the note, saving, themes).
`src/markdown.js` is the Markdown + math renderer. `test/host.html` is a mock of Standard Notes' plugin host.

Built with [marked](https://github.com/markedjs/marked), [KaTeX](https://katex.org) and [DOMPurify](https://github.com/cure53/DOMPurify).
