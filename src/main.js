import { connect } from './sn.js';
import { renderMarkdown } from './markdown.js';
import { applyThemes, syncColorScheme } from './themes.js';
import { SAMPLE } from './sample.js';
import 'katex/contrib/copy-tex'; // copying rendered math from the preview yields its LaTeX source

const $ = (id) => document.getElementById(id);
const src = $('src');
const out = $('out');
const panes = $('panes');
const countEl = $('count');
const noticeEl = $('notice');
const modeButtons = Array.from(document.querySelectorAll('.seg button'));

const MODES = ['edit', 'split', 'view'];
const defaultMode = () => (window.innerWidth < 720 ? 'edit' : 'split');
const embedded = window.parent !== window;

let mode = defaultMode();
let connected = false;
let standalone = false;
let locked = false;
let saveFailed = false;
let composing = false;
let leaveWithTab = false;
let renderTimer = 0;
let standaloneTimer = 0;

/* ---------- Standard Notes connection ---------- */

const bridge = connect({
  onRegistered({ componentData }) {
    connected = true;
    clearTimeout(standaloneTimer);
    leaveStandalone();
    const saved = componentData && componentData.mode;
    setMode(MODES.includes(saved) ? saved : defaultMode(), false);
  },
  onNote,
  onThemes: applyThemes,
  onSaveResult(ok) {
    saveFailed = !ok;
    refreshNotice();
  },
});

function onNote(note, meta) {
  locked = note.locked;
  src.readOnly = locked;
  src.spellcheck = note.spellcheck;
  document.body.classList.toggle('locked', locked);
  refreshNotice();

  if (meta.metadataOnly && !meta.switched) return; // only flags changed; keep what is being typed
  if (!meta.switched && (bridge.hasPending() || composing)) return;

  if (note.text !== src.value) {
    const start = src.selectionStart;
    const end = src.selectionEnd;
    src.value = note.text;
    if (meta.switched) {
      src.setSelectionRange(0, 0);
      src.scrollTop = 0;
      out.scrollTop = 0;
    } else {
      src.setSelectionRange(Math.min(start, note.text.length), Math.min(end, note.text.length));
    }
  }
  updateCount();
  render();
}

/* ---------- Standalone (opened outside Standard Notes) ---------- */

function enterStandalone() {
  if (connected) return;
  standalone = true;
  document.documentElement.classList.add('standalone');
  src.value = SAMPLE;
  updateCount();
  render();
  refreshNotice();
  syncColorScheme();
}

function leaveStandalone() {
  if (!standalone) return;
  standalone = false;
  if (embedded) document.documentElement.classList.remove('standalone');
  src.value = '';
  refreshNotice();
}

/* ---------- View ---------- */

function refreshNotice() {
  let text = '';
  if (standalone) text = 'Standalone preview. Install the plugin in Standard Notes to edit your notes.';
  else if (locked) text = 'Editing is disabled for this note.';
  else if (saveFailed) text = 'Your last change could not be saved. It will be saved again when you type.';
  noticeEl.textContent = text;
}

function updateCount() {
  const n = (src.value.match(/\S+/g) || []).length;
  countEl.textContent = n === 1 ? '1 word' : `${n} words`;
}

function render() {
  if (mode === 'edit') return;
  out.innerHTML = renderMarkdown(src.value);
  out.querySelectorAll('table').forEach((table) => {
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    table.replaceWith(wrap);
    wrap.appendChild(table);
  });
}

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, 120);
}

function setMode(next, persist) {
  if (!MODES.includes(next)) next = defaultMode();
  const leavingEdit = mode === 'edit' && next !== 'edit';
  mode = next;
  panes.dataset.mode = next;
  document.body.dataset.mode = next;
  modeButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === next)));
  if (leavingEdit) render();
  if (persist && connected) bridge.setComponentData({ mode: next });
}

document.querySelector('.seg').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-mode]');
  if (button) setMode(button.dataset.mode, true);
});

/* ---------- Editing ---------- */

src.addEventListener('input', () => {
  updateCount();
  scheduleRender();
  if (!locked) bridge.save(src.value);
});
src.addEventListener('compositionstart', () => { composing = true; });
src.addEventListener('compositionend', () => { composing = false; });

// Keep the preview roughly level with the editor in split view.
src.addEventListener('scroll', () => {
  if (mode !== 'split') return;
  const range = src.scrollHeight - src.clientHeight;
  out.scrollTop = range > 0 ? (src.scrollTop / range) * (out.scrollHeight - out.clientHeight) : 0;
}, { passive: true });

/** Insert through execCommand so Undo/Redo keep working; fall back to setRangeText. */
function insert(text) {
  src.focus();
  const done = text === '' ? document.execCommand('delete') : document.execCommand('insertText', false, text);
  if (!done) {
    src.setRangeText(text, src.selectionStart, src.selectionEnd, 'end');
    src.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function wrap(before, after, placeholder) {
  const value = src.value;
  const start = src.selectionStart;
  const end = src.selectionEnd;
  const selected = value.slice(start, end);
  const single = before.length === 1;
  const nested = single && (value[start - before.length - 1] === before || value[end + after.length] === after);
  const wrapped = start >= before.length
    && value.slice(start - before.length, start) === before
    && value.slice(end, end + after.length) === after;

  if (wrapped && !nested) {
    src.setSelectionRange(start - before.length, end + after.length);
    insert(selected);
    src.setSelectionRange(start - before.length, start - before.length + selected.length);
    return;
  }
  const inner = selected || placeholder;
  insert(before + inner + after);
  src.setSelectionRange(start + before.length, start + before.length + inner.length);
}

function prefixLines(prefix, existing) {
  const value = src.value;
  const start = src.selectionStart;
  const end = src.selectionEnd;
  const from = value.lastIndexOf('\n', start - 1) + 1;
  let to = value.indexOf('\n', end);
  if (to === -1) to = value.length;
  const lines = value.slice(from, to).split('\n');
  const filled = lines.filter((l) => l.trim() !== '');
  const remove = filled.length > 0 && filled.every((l) => existing.test(l));
  const next = lines
    .map((l) => (l.trim() === '' ? l : remove ? l.replace(existing, '$1') : l.replace(/^(\s*)/, `$1${prefix}`)))
    .join('\n');
  src.setSelectionRange(from, to);
  insert(next);
  src.setSelectionRange(from, from + next.length);
}

function link() {
  const start = src.selectionStart;
  const selected = src.value.slice(start, src.selectionEnd) || 'link text';
  insert(`[${selected}](https://)`);
  const urlStart = start + selected.length + 3;
  src.setSelectionRange(urlStart, urlStart + 'https://'.length);
}

function displayMath() {
  const start = src.selectionStart;
  const selected = src.value.slice(start, src.selectionEnd);
  const lead = start === 0 || src.value[start - 1] === '\n' ? '' : '\n';
  insert(`${lead}$$\n${selected}\n$$\n`);
  const bodyStart = start + lead.length + 3;
  src.setSelectionRange(bodyStart, bodyStart + selected.length);
}

function indent() {
  const { value, selectionStart: start, selectionEnd: end } = src;
  if (!value.slice(start, end).includes('\n')) {
    insert('  ');
    return;
  }
  const from = value.lastIndexOf('\n', start - 1) + 1;
  const next = value.slice(from, end).replace(/^(?!$)/gm, '  ');
  src.setSelectionRange(from, end);
  insert(next);
  src.setSelectionRange(from, from + next.length);
}

function outdent() {
  const { value, selectionStart: start, selectionEnd: end } = src;
  const from = value.lastIndexOf('\n', start - 1) + 1;
  let to = value.indexOf('\n', end);
  if (to === -1) to = value.length;
  const block = value.slice(from, to);
  const next = block.replace(/^(?: {1,2}|\t)/gm, '');
  if (next === block) return;
  src.setSelectionRange(from, to);
  insert(next);
  src.setSelectionRange(from, from + next.length);
}

const COMMANDS = {
  bold: () => wrap('**', '**', 'bold text'),
  italic: () => wrap('*', '*', 'italic text'),
  code: () => wrap('`', '`', 'code'),
  link,
  list: () => prefixLines('- ', /^(\s*)(?:[-*+]|\d+\.) /),
  task: () => prefixLines('- [ ] ', /^(\s*)- \[[ xX]\] /),
  quote: () => prefixLines('> ', /^(\s*)> ?/),
  math: () => wrap('$', '$', 'x'),
  display: displayMath,
};

const tools = document.querySelector('.tools');
tools.addEventListener('mousedown', (event) => event.preventDefault()); // keep focus and selection in the editor
tools.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-cmd]');
  if (!button || locked) return;
  src.focus();
  COMMANDS[button.dataset.cmd]();
});

src.addEventListener('keydown', (event) => {
  if (locked) return;
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();

  if (event.key === 'Escape') {
    leaveWithTab = true; // Escape, then Tab, moves focus out of the editor
    return;
  }
  if (event.key === 'Tab' && !mod && !event.altKey) {
    if (leaveWithTab) {
      leaveWithTab = false;
      return;
    }
    event.preventDefault();
    if (event.shiftKey) outdent();
    else indent();
    return;
  }
  leaveWithTab = false;

  if (!mod || event.altKey) return;
  if (!event.shiftKey && key === 'b') { event.preventDefault(); COMMANDS.bold(); }
  else if (!event.shiftKey && key === 'i') { event.preventDefault(); COMMANDS.italic(); }
  else if (!event.shiftKey && key === 'k') { event.preventDefault(); COMMANDS.link(); }
  else if (event.shiftKey && key === 'm') { event.preventDefault(); COMMANDS.math(); }
});

/* ---------- Start ---------- */

setMode(mode, false);
updateCount();
syncColorScheme();
if (!embedded) document.documentElement.classList.add('standalone');
// Inside Standard Notes the host registers us right after load; if nothing arrives, show the sample.
standaloneTimer = setTimeout(enterStandalone, embedded ? 1500 : 0);
