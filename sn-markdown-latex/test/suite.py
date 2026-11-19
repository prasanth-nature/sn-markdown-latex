"""
Regression suite for the Markdown + LaTeX Standard Notes plugin.

    python3 suite.py <folder-with-built-plugin>

Runs the plugin in headless Chromium inside test/host.html, a mock of Standard Notes'
ComponentViewer (sandboxed iframe WITHOUT allow-same-origin, component-registered handshake,
stream-context-item replies that never stop, save-items that replace note content).
"""
import sys, os, json, time, threading, functools, http.server, socketserver
from playwright.sync_api import sync_playwright

SITE_DIR = os.path.abspath(sys.argv[1])
HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, 'shots')
os.makedirs(SHOTS, exist_ok=True)

PLUGIN_URL = 'http://127.0.0.1:8001/sn-markdown-latex/'   # same shape as the GitHub Pages URL
HOST_URL = 'http://127.0.0.1:8002/host.html'

NOTE_TEXT = r"""# Euler & friends

Inline: $e^{i\pi}+1=0$ and $a_1 + b_2$. Money: costs $5 and $10 (not math).

$$
\int_0^\infty e^{-x^2}\,dx = \frac{\sqrt\pi}{2}
$$

Paren style: \(x^2+y^2=z^2\)

Bracket style: \[ \sum_{k=1}^n k = \frac{n(n+1)}{2} \]

\begin{align}
a &= b \\
c &= d
\end{align}

Chemistry: $\ce{H2O}$

- [x] done
- [ ] todo

| a | b |
|---|---|
| 1 | $x$ |

```python
print("hi $$ not math")
```
"""
EXPECTED_KATEX = 8      # 2 inline $, 1 \(, 1 $$, 1 \[, 1 align, 1 \ce, 1 in table
EXPECTED_DISPLAY = 3    # $$, \[, align


def note_content(text, locked=False, appdata='full', title='T'):
    c = {'title': title, 'text': text, 'preview_plain': '', 'spellcheck': True,
         'references': [], 'editorIdentifier': 'comp-1'}
    if appdata == 'full':
        c['appData'] = {'org.standardnotes.sn': {'client_updated_at': '2026-11-19T00:00:00Z', 'locked': locked,
                                                 'pinned': True}}
    elif appdata == 'empty-domain':
        c['appData'] = {}
    # appdata == 'none': no appData key at all
    return c


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')   # GitHub Pages sends this too
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, *a):
        pass


socketserver.ThreadingTCPServer.allow_reuse_address = True


def serve(directory, port):
    s = socketserver.ThreadingTCPServer(('127.0.0.1', port), functools.partial(Handler, directory=directory))
    threading.Thread(target=s.serve_forever, daemon=True).start()


os.makedirs('/tmp/site', exist_ok=True)
link = '/tmp/site/sn-markdown-latex'
if os.path.islink(link):
    os.remove(link)
os.symlink(SITE_DIR, link)
serve('/tmp/site', 8001)
serve(HERE, 8002)

STATE_JS = """() => {
  const q = id => document.getElementById(id);
  const out = q('out');
  return {
    value: q('src').value,
    readOnly: q('src').readOnly,
    mode: q('panes').dataset.mode,
    count: q('count').textContent,
    notice: q('notice').textContent,
    katex: out.querySelectorAll('.katex').length,
    display: out.querySelectorAll('.katex-display').length,
    katexErrors: out.querySelectorAll('.katex-error, .math-error').length,
    h1: (out.querySelector('h1') || {}).textContent || null,
    tables: out.querySelectorAll('table').length,
    wrapped: out.querySelectorAll('.table-wrap > table').length,
    checkboxes: out.querySelectorAll('input[type=checkbox]').length,
    code: out.querySelectorAll('pre code').length,
    text: out.textContent
  };
}"""

results = []


def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS  ' if ok else 'FAIL  ') + name + (('   <-- ' + str(detail)) if (not ok and detail != '') else ''), flush=True)


with sync_playwright() as p:
    browser = p.chromium.launch()

    def new_ctx(width=1100, height=720):
        return browser.new_context(viewport={'width': width, 'height': height})

    def watch(page):
        probs = []
        page.on('console', lambda m: probs.append(['console.' + m.type, m.text[:200]]) if m.type in ('error', 'warning') else None)
        page.on('pageerror', lambda e: probs.append(['pageerror', str(e)[:200]]))
        page.on('requestfailed', lambda r: probs.append(['requestfailed', r.url, str(r.failure)]))
        page.on('response', lambda r: probs.append(['http%d' % r.status, r.url]) if r.status >= 400 else None)
        return probs

    def frame_of(page):
        return next(f for f in page.frames if 'sn-markdown-latex' in f.url)

    def open_plugin(content, ctx=None, wait=1100, **opts):
        ctx = ctx or new_ctx()
        page = ctx.new_page()
        probs = watch(page)
        page.goto(HOST_URL)
        opts['src'] = PLUGIN_URL
        page.evaluate("([c, o]) => startSN(c, o)", [content, opts])
        page.wait_for_timeout(wait)
        return page, frame_of(page), probs

    def value(fr):
        return fr.evaluate("document.getElementById('src').value")

    def saved(page):
        return page.evaluate("SN_SAVED")

    # ---------------------------------------------------------------- A. rendering
    page, fr, probs = open_plugin(note_content(NOTE_TEXT))
    st = fr.evaluate(STATE_JS)
    check('A1  note text arrives in the editor', st['value'] == NOTE_TEXT)
    check('A2  all math delimiters render ($ \\( $$ \\[ align \\ce)', st['katex'] == EXPECTED_KATEX, st['katex'])
    check('A3  display math count (blocks)', st['display'] == EXPECTED_DISPLAY, st['display'])
    check('A4  no KaTeX errors', st['katexErrors'] == 0, st['katexErrors'])
    check('A5  "costs $5 and $10" stays plain text', 'costs $5 and $10 (not math)' in st['text'])
    check('A6  "$$" inside a code fence is not math', st['code'] == 1 and '$$ not math' in st['text'])
    check('A7  heading, table (scroll wrapper), task boxes', st['h1'] == 'Euler & friends' and st['wrapped'] == 1 and st['checkboxes'] == 2)
    check('A8  word count shown', st['count'].endswith('words'), st['count'])
    fonts = fr.evaluate("document.fonts.ready.then(() => [...new Set([...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/\"/g,'')))])")
    check('A9  KaTeX fonts actually load (woff2)', 'KaTeX_Main' in fonts and 'KaTeX_Math' in fonts, fonts)
    check('A10 no console errors / failed requests', probs == [], probs)
    page.screenshot(path=SHOTS + '/light_split.png')
    page.context.close()

    # ---------------------------------------------------------------- B. saving
    page, fr, probs = open_plugin(note_content('# Hello\n\nworld'))
    fr.locator('#src').click()
    page.keyboard.press('Control+End')
    page.keyboard.type('\nmore $x$')
    page.wait_for_timeout(800)
    s = saved(page)
    check('B1  a typing burst produces exactly one save', len(s) == 1, len(s))
    item = s[-1] if s else {'content': {}, 'uuid': None}
    c = item['content']
    check('B2  saved text is the full editor text', c.get('text') == '# Hello\n\nworld\nmore $x$', c.get('text'))
    check('B3  rest of the note is sent back intact (title, appData, references)',
          c.get('title') == 'T' and c.get('references') == [] and
          c.get('appData', {}).get('org.standardnotes.sn', {}).get('pinned') is True and item['uuid'] == 'note-1', c)
    check('B4  preview_plain refreshed for the note list', 'more $x$' in c.get('preview_plain', ''), c.get('preview_plain'))
    check('B5  preview updates live while typing', fr.evaluate("!!document.querySelector('#out .katex')"))
    check('B6  messages carry the session key', all(l['hasSession'] for l in page.evaluate('SN_LOG')))
    page.context.close()

    # ---------------------------------------------------------------- C. note switch
    page, fr, probs = open_plugin(note_content('first note'))
    fr.locator('#src').click()
    page.keyboard.press('Control+End')
    page.keyboard.type(' EDITED')
    page.evaluate("(c) => pushNote(c, {uuid: 'note-2'})", note_content('second note'))   # < 300 ms later
    page.wait_for_timeout(700)
    s = saved(page)
    check('C1  unsaved edits are flushed before switching notes',
          any(x['uuid'] == 'note-1' and x['content']['text'] == 'first note EDITED' for x in s), s)
    check('C2  editor shows the new note', value(fr) == 'second note')
    check('C3  nothing is written to the note we switched to', not any(x['uuid'] == 'note-2' for x in s))
    page.context.close()

    # ---------------------------------------------------------------- D. locked
    page, fr, probs = open_plugin(note_content('locked text', locked=True))
    st = fr.evaluate(STATE_JS)
    check('D1  locked note is read-only', st['readOnly'] is True)
    check('D2  notice explains why', 'disabled' in st['notice'].lower(), st['notice'])
    fr.locator('#src').click()
    page.keyboard.type('zzz')
    page.wait_for_timeout(500)
    check('D3  typing into a locked note changes and saves nothing', value(fr) == 'locked text' and saved(page) == [])
    page.evaluate("(c) => pushNote(c)", note_content('locked text', locked=False))
    page.wait_for_timeout(300)
    check('D4  unlocking in SN makes it editable again', fr.evaluate("!document.getElementById('src').readOnly"))
    page.context.close()

    # ---------------------------------------------------------------- E. robustness
    for kind in ('empty-domain', 'none'):
        page, fr, probs = open_plugin(note_content('# no appdata\n\n$q$', appdata=kind))
        st = fr.evaluate(STATE_JS)
        check('E1  note with appData=%s still renders' % kind, st['h1'] == 'no appdata' and st['katex'] == 1, st)
        check('E2  ... and raises no errors (%s)' % kind, probs == [], probs)
        page.context.close()

    # ---------------------------------------------------------------- F/G. echoes and remote edits
    page, fr, probs = open_plugin(note_content('base'))
    fr.locator('#src').click()
    page.keyboard.press('Control+End')
    page.keyboard.type(' typed')
    page.evaluate("(c) => pushNote(c, {isMetadataUpdate: true})", note_content('base'))
    page.wait_for_timeout(500)
    check('F1  a metadata-only echo does not clobber typed text', value(fr) == 'base typed', value(fr))
    s = saved(page)
    check('F2  and the typed text is still saved', bool(s) and s[-1]['content']['text'] == 'base typed', s)
    page.context.close()

    page, fr, probs = open_plugin(note_content('one two three'))
    fr.evaluate("() => { const s = document.getElementById('src'); s.focus(); s.setSelectionRange(3, 3); }")
    page.evaluate("(c) => pushNote(c)", note_content('one two three four'))
    page.wait_for_timeout(300)
    check('G1  remote edit appears in the editor', value(fr) == 'one two three four')
    check('G2  caret position survives it', fr.evaluate("document.getElementById('src').selectionStart") == 3)
    page.evaluate("(c) => pushNote(c)", note_content('replaced again'))
    page.wait_for_timeout(300)
    check('G3  later remote edits keep arriving (reply callback is permanent)', value(fr) == 'replaced again')
    page.context.close()

    # ---------------------------------------------------------------- H. mode persistence
    page, fr, probs = open_plugin(note_content('x'))
    fr.get_by_role('button', name='Preview').click()
    page.wait_for_timeout(300)
    log = [l for l in page.evaluate('SN_LOG') if l['action'] == 'set-component-data']
    check('H1  chosen view mode is stored in component data', bool(log) and log[-1]['data']['componentData']['mode'] == 'view', log)
    check('H2  edit pane hidden in preview mode', fr.evaluate("getComputedStyle(document.getElementById('src')).display") == 'none')
    page.context.close()
    page, fr, probs = open_plugin(note_content('x'), componentData={'mode': 'edit'})
    check('H3  stored mode is restored on next load', fr.evaluate("document.getElementById('panes').dataset.mode") == 'edit')
    page.context.close()

    # ---------------------------------------------------------------- I. mobile messaging (JSON strings)
    page, fr, probs = open_plugin(note_content(NOTE_TEXT), environment='mobile')
    check('I1  mobile: note loads and renders', fr.evaluate(STATE_JS)['katex'] == EXPECTED_KATEX)
    fr.locator('#src').click()
    page.keyboard.press('Control+End')
    page.keyboard.type(' m')
    page.wait_for_timeout(700)
    s = saved(page)
    check('I2  mobile: save works', len(s) == 1 and s[0]['content']['text'].endswith(' m'), s)
    page.context.close()

    # ---------------------------------------------------------------- J. themes
    page, fr, probs = open_plugin(note_content(NOTE_TEXT), themes=['http://127.0.0.1:8002/dark-theme.css'], wait=1300)
    bg = fr.evaluate("getComputedStyle(document.body).backgroundColor")
    check('J1  SN theme variables drive the colors', bg == 'rgb(28, 30, 34)', bg)
    cs = fr.evaluate("document.documentElement.style.colorScheme")
    check('J2  dark theme flips color-scheme (scrollbars, caret)', cs == 'dark', cs)
    page.screenshot(path=SHOTS + '/dark_split.png')
    page.evaluate("setThemes([])")
    page.wait_for_timeout(400)
    bg2 = fr.evaluate("getComputedStyle(document.body).backgroundColor")
    check('J3  switching theme off restores the default', bg2 == 'rgb(255, 255, 255)', bg2)
    page.context.close()

    # ---------------------------------------------------------------- K. narrow screens
    ctx = new_ctx(390, 800)
    page, fr, probs = open_plugin(note_content(NOTE_TEXT), ctx=ctx)
    check('K1  narrow pane defaults to Edit', fr.evaluate("document.getElementById('panes').dataset.mode") == 'edit')
    page.screenshot(path=SHOTS + '/mobile_edit.png')
    fr.get_by_role('button', name='Split').click()
    page.wait_for_timeout(300)
    rows = fr.evaluate("getComputedStyle(document.getElementById('panes')).gridTemplateRows.split(' ').length")
    check('K2  split stacks vertically on narrow panes', rows == 2, rows)
    check('K3  no horizontal page overflow', fr.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))
    check('K4  switching Edit -> Split renders the preview', fr.evaluate(STATE_JS)['katex'] == EXPECTED_KATEX)
    page.screenshot(path=SHOTS + '/mobile_split.png')
    ctx.close()

    # ---------------------------------------------------------------- L. toolbar + shortcuts
    def select(fr, a, b):
        fr.evaluate("([a, b]) => { const s = document.getElementById('src'); s.focus(); s.setSelectionRange(a, b); }", [a, b])

    page, fr, probs = open_plugin(note_content('hello world'))
    select(fr, 6, 11)
    fr.get_by_role('button', name='Bold').click()
    check('L1  Bold wraps the selection', value(fr) == 'hello **world**', value(fr))
    fr.get_by_role('button', name='Bold').click()
    check('L2  Bold again unwraps it', value(fr) == 'hello world', value(fr))
    fr.get_by_role('button', name='Bold').click()
    page.keyboard.press('Control+z')
    check('L3  Undo reverts a toolbar edit', value(fr) == 'hello world', value(fr))
    select(fr, 6, 11)
    fr.get_by_role('button', name='Inline math').click()
    check('L4  Inline math wraps in $…$', value(fr) == 'hello $world$', value(fr))
    select(fr, 0, 5)
    page.keyboard.press('Control+b')
    check('L5  Ctrl+B shortcut', value(fr).startswith('**hello**'), value(fr))
    page.context.close()

    page, fr, probs = open_plugin(note_content('a\nb'))
    select(fr, 0, 3)
    fr.get_by_role('button', name='Bulleted list').click()
    check('L6  List prefixes every selected line', value(fr) == '- a\n- b', value(fr))
    select(fr, 0, value(fr).__len__())
    fr.get_by_role('button', name='Bulleted list').click()
    check('L7  List toggles off again', value(fr) == 'a\nb', value(fr))
    select(fr, 0, 3)
    fr.get_by_role('button', name='Task list').click()
    check('L8  Task list', value(fr) == '- [ ] a\n- [ ] b', value(fr))
    page.context.close()

    page, fr, probs = open_plugin(note_content('see world'))
    select(fr, 4, 9)
    fr.get_by_role('button', name='Link').click()
    sel = fr.evaluate("(() => { const s = document.getElementById('src'); return [s.value, s.value.slice(s.selectionStart, s.selectionEnd)]; })()")
    check('L9  Link wraps selection and selects the URL', sel == ['see [world](https://)', 'https://'], sel)
    page.context.close()

    page, fr, probs = open_plugin(note_content('intro'))
    select(fr, 5, 5)
    fr.get_by_role('button', name='Display math block').click()
    check('L10 Display math inserts a $$ block on its own lines', value(fr) == 'intro\n$$\n\n$$\n', repr(value(fr)))
    page.context.close()

    page, fr, probs = open_plugin(note_content('item'))
    select(fr, 4, 4)
    page.keyboard.press('Tab')
    check('L11 Tab indents', value(fr) == 'item  ', repr(value(fr)))
    page.keyboard.press('Escape')
    page.keyboard.press('Tab')
    active = fr.evaluate("document.activeElement && document.activeElement.id")
    check('L13 Escape then Tab leaves the editor (no keyboard trap)', active != 'src', active)
    page.context.close()

    page, fr, probs = open_plugin(note_content('    deep\n  mid'))
    select(fr, 0, 13)
    page.keyboard.press('Shift+Tab')
    check('L12 Shift+Tab outdents every selected line by up to 2 spaces', value(fr) == '  deep\nmid', repr(value(fr)))
    select(fr, 0, 8)
    page.keyboard.press('Tab')
    check('L14 Tab on a multi-line selection indents each line', value(fr) == '    deep\n  mid', repr(value(fr)))
    page.context.close()

    # ---------------------------------------------------------------- M. standalone
    ctx = new_ctx()
    page = ctx.new_page()
    probs = watch(page)
    page.goto(PLUGIN_URL)
    page.wait_for_timeout(900)
    st = page.evaluate(STATE_JS)
    check('M1  opened directly: sample is shown and rendered', st['katex'] >= 6 and st['h1'] == 'Markdown + LaTeX', st['katex'])
    check('M2  opened directly: says it is standalone', 'Standalone' in st['notice'], st['notice'])
    check('M3  opened directly: no errors', probs == [], probs)
    page.screenshot(path=SHOTS + '/standalone.png')
    ctx.close()

    ctx = new_ctx()
    page = ctx.new_page()
    probs = watch(page)
    page.goto(HOST_URL)
    page.evaluate("startBare(%s)" % json.dumps(PLUGIN_URL))
    page.wait_for_timeout(1900)
    fr = frame_of(page)
    check('M4  framed without a host: falls back to the sample', 'Standalone' in fr.evaluate(STATE_JS)['notice'])
    ctx.close()

    page, fr, probs = open_plugin(note_content('real note $z$'), registerDelay=2200, wait=1900)
    check('M5  slow host: sample appears while waiting', 'Standalone' in fr.evaluate(STATE_JS)['notice'])
    page.wait_for_timeout(1200)
    st = fr.evaluate(STATE_JS)
    check('M6  ... then the real note replaces it when the host answers', st['value'] == 'real note $z$' and st['notice'] == '', st)
    page.context.close()

    # ---------------------------------------------------------------- N. sanitising
    evil = ('<img src=x onerror="window.__xss=1">\n\n<script>window.__xss=2</script>\n\n'
            '[bad](javascript:window.__xss=3)\n\n<a href="https://example.com" onclick="window.__xss=4">ok</a>\n\n'
            '<iframe src="https://example.com"></iframe>\n\n<svg onload="window.__xss=5"></svg>\n\n'
            '$\\href{javascript:window.__xss=6}{x}$\n')
    page, fr, probs = open_plugin(note_content(evil))
    r = fr.evaluate("""() => ({
      xss: window.__xss,
      handlers: document.querySelectorAll('#out [onerror],#out [onclick],#out [onload]').length,
      scripts: document.querySelectorAll('#out script').length,
      frames: document.querySelectorAll('#out iframe').length,
      jsLinks: [...document.querySelectorAll('#out a')].filter(a => /^\\s*javascript:/i.test(a.getAttribute('href') || '')).length,
      okLink: (() => { const a = [...document.querySelectorAll('#out a')].find(a => a.textContent === 'ok'); return a ? [a.target, a.rel] : null; })()
    })""")
    check('N1  no script runs from note content', r['xss'] is None, r)
    check('N2  handlers, scripts, iframes, javascript: links are stripped',
          r['handlers'] == 0 and r['scripts'] == 0 and r['frames'] == 0 and r['jsLinks'] == 0, r)
    check('N3  real links open in a new tab with noopener', r['okLink'] == ['_blank', 'noopener noreferrer'], r['okLink'])
    page.context.close()

    # ---------------------------------------------------------------- O. odd input
    odd = ('Start $$ never closed\n\nthen $x$ works\n\n`$y$` stays code and \\$z\\$ stays literal.\n\n'
           'தமிழ் $\\alpha$ எழுத்து\n\n![dot](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==)\n')
    page, fr, probs = open_plugin(note_content(odd))
    st = fr.evaluate(STATE_JS)
    check('O1  unclosed $$ does not break later math', st['katex'] == 2 and st['katexErrors'] == 0, st['katex'])
    check('O2  `$y$` stays code; \\$z\\$ is literal', '$y$' in st['text'] and '$z$' in st['text'])
    check('O3  Tamil text survives next to math', 'தமிழ்' in st['text'] and 'எழுத்து' in st['text'])
    check('O4  images render lazily', fr.evaluate("document.querySelectorAll('#out img[loading=lazy]').length") == 1)
    check('O5  no errors', probs == [], probs)
    page.context.close()

    # ---------------------------------------------------------------- P. performance
    big = '\n\n'.join('## Section %d\n\nParagraph with $a_%d + b_%d = c$ and **bold** text.' % (i, i, i) for i in range(400))
    page, fr, probs = open_plugin(note_content('small'))
    t0 = time.time()
    page.evaluate("(c) => pushNote(c)", note_content(big))
    fr.wait_for_function("document.querySelectorAll('#out .katex').length === 400", timeout=15000)
    dt = int((time.time() - t0) * 1000)
    check('P1  400 sections / 400 formulas render in < 3 s (took %d ms)' % dt, dt < 3000, dt)
    page.context.close()

    # ---------------------------------------------------------------- Q. copy + scroll sync
    page, fr, probs = open_plugin(note_content('Energy is $E=mc^2$ here, and \\(a^2\\).'))
    fr.evaluate("""() => {
      window.__copied = null;
      document.addEventListener('copy', e => { window.__copied = e.clipboardData.getData('text/plain'); });
      const out = document.getElementById('out'); out.focus();
      const p = [...out.querySelectorAll('p')].find(x => x.querySelector('.katex'));
      const r = document.createRange(); r.selectNodeContents(p);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    }""")
    page.keyboard.press('Control+c')
    copied = fr.evaluate('window.__copied')
    check('Q1  copying rendered math from the preview yields its LaTeX', bool(copied) and '$E=mc^2$' in copied and '$a^2$' in copied, copied)
    page.context.close()

    long_note = '\n\n'.join('Paragraph %d' % i for i in range(200))
    page, fr, probs = open_plugin(note_content(long_note))
    fr.evaluate("() => { const s = document.getElementById('src'); s.scrollTop = s.scrollHeight; }")
    page.wait_for_timeout(400)
    r = fr.evaluate("() => { const o = document.getElementById('out'); return [o.scrollTop, o.scrollHeight - o.clientHeight]; }")
    check('Q2  preview follows the editor scroll in split view', r[0] > 0 and abs(r[0] - r[1]) < 5, r)
    page.context.close()

    browser.close()

fails = [r for r in results if not r[1]]
print('\n%d checks, %d passed, %d failed' % (len(results), len(results) - len(fails), len(fails)))
sys.exit(1 if fails else 0)
