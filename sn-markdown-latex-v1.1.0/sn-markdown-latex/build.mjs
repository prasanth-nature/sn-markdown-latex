// Builds the files GitHub Pages serves:   node build.mjs [outDir]            (default: current folder)
// Builds one self-contained HTML file:    node build.mjs --single <file.html>  (live preview page)
import { build, transform } from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const single = process.argv[2] === '--single' ? process.argv[3] : null;
const outDir = single ? '.tmp-single' : process.argv[2] || '.';
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const targets = ['es2020'];

mkdirSync(join(outDir, 'fonts'), { recursive: true });

await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: targets,
  legalComments: 'none',
  outfile: join(outDir, 'app.js'),
});

// KaTeX ships woff2 + woff + ttf for every font; woff2 alone covers every browser Standard Notes runs on.
const katexCss = readFileSync('node_modules/katex/dist/katex.min.css', 'utf8')
  .replace(/,url\(fonts\/[^)]+\.woff\) format\("woff"\)/g, '')
  .replace(/,url\(fonts\/[^)]+\.ttf\) format\("truetype"\)/g, '');
const css = await transform(`${katexCss}\n${readFileSync('src/style.css', 'utf8')}`, {
  loader: 'css',
  minify: true,
  target: targets,
});
writeFileSync(join(outDir, 'app.css'), css.code);

for (const file of readdirSync('node_modules/katex/dist/fonts')) {
  if (file.endsWith('.woff2')) copyFileSync(join('node_modules/katex/dist/fonts', file), join(outDir, 'fonts', file));
}

writeFileSync(join(outDir, 'index.html'), readFileSync('src/index.html', 'utf8').replaceAll('__VERSION__', version));

writeFileSync(
  join(outDir, 'ext.json'),
  `${JSON.stringify(
    {
      identifier: 'io.github.prasanth-nature.markdown-latex',
      name: 'Markdown + LaTeX',
      description:
        'Markdown editor with live KaTeX math preview. Supports $…$, $$…$$, \\(…\\) and \\[…\\] math, align environments and chemistry (\\ce). Edit, split and preview modes.',
      content_type: 'SN|Component',
      area: 'editor-editor',
      version,
      url: 'https://prasanth-nature.github.io/sn-markdown-latex/',
    },
    null,
    2,
  )}\n`,
);

writeFileSync(join(outDir, '.nojekyll'), '');
console.log(`built ${version} -> ${outDir}`);

if (single) {
  const fonts = Object.fromEntries(
    readdirSync(join(outDir, 'fonts')).map((f) => [f, readFileSync(join(outDir, 'fonts', f)).toString('base64')]),
  );
  let inlineCss = readFileSync(join(outDir, 'app.css'), 'utf8').replace(
    /url\(fonts\/([^)]+\.woff2)\)/g,
    (_, name) => `url(data:font/woff2;base64,${fonts[name]})`,
  );
  // Hosted pages sit under phone system bars and follow the viewer's light/dark switch.
  inlineCss += ':root{box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}';
  const js = readFileSync(join(outDir, 'app.js'), 'utf8').replaceAll('</script', '<\\/script');
  const page = readFileSync('src/index.html', 'utf8')
    .replace('width=device-width, initial-scale=1', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .replace(/\s*<link rel="stylesheet"[^>]*>/, `\n  <style>${inlineCss}</style>`)
    .replace(/\s*<script defer[^>]*><\/script>/, '')
    .replace('</body>', () => `<script>${js}</script>\n</body>`)
    .replaceAll('__VERSION__', version);
  writeFileSync(single, page);
  rmSync(outDir, { recursive: true, force: true });
  console.log(`single-file page -> ${single} (${(page.length / 1024).toFixed(0)} KB)`);
}
