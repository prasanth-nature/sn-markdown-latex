/*
 * Standard Notes component bridge (area: editor-editor).
 *
 * A small, dependency-free implementation of the part of the component protocol
 * an editor needs. It mirrors snjs' ComponentViewer:
 *
 *   host   -> plugin  component-registered  session key, environment, themes
 *   plugin -> host    stream-context-item   the host answers now, and keeps
 *                                           answering THIS message on every change
 *   plugin -> host    save-items            the host REPLACES the note content
 *                                           with what we send, so the complete
 *                                           item must always be sent back
 */

const DOMAIN = 'org.standardnotes.sn';
const SAVE_DELAY_MS = 300;
const PREVIEW_CHARS = 160;

/** crypto.randomUUID() needs a secure context; sandboxed iframes are not always one. */
export function newId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch (_) { /* fall through to the manual version */ }
  const b = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const previewOf = (text) => text.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_CHARS);

/**
 * @param {{
 *   onRegistered: (info: {environment: string, platform?: string, componentData: object}) => void,
 *   onNote: (note: {uuid: string, text: string, locked: boolean, spellcheck: boolean},
 *            meta: {switched: boolean, metadataOnly: boolean}) => void,
 *   onThemes: (urls: string[]) => void,
 *   onSaveResult?: (ok: boolean) => void,
 * }} app
 */
export function connect(app) {
  let sessionKey = null;
  let environment = 'web';
  let item = null; // last full item streamed by Standard Notes
  let pending = null; // { uuid, text } waiting for the debounce
  let timer = 0;
  const outbox = [];
  const replies = new Map(); // messageId -> { onReply, keep }

  function post(action, data, onReply, keep) {
    if (!sessionKey) {
      outbox.push([action, data, onReply, keep]);
      return;
    }
    const message = { action, data, messageId: newId(), sessionKey, api: 'component' };
    if (onReply) replies.set(message.messageId, { onReply, keep: !!keep });
    // Mobile messaging is JSON strings; everything else takes plain objects.
    window.parent.postMessage(environment === 'mobile' ? JSON.stringify(message) : message, '*');
  }

  function noteInfo(json) {
    const content = json.content || {};
    const sn = (content.appData && content.appData[DOMAIN]) || {};
    return {
      uuid: json.uuid,
      text: typeof content.text === 'string' ? content.text : '',
      locked: sn.locked === true || content.locked === true,
      spellcheck: content.spellcheck !== false,
    };
  }

  function handleItem(json) {
    if (!json || json.deleted || !json.content) return;
    const switched = !item || item.uuid !== json.uuid;
    if (switched) flush(); // never lose edits made to the previous note
    item = json;
    app.onNote(noteInfo(json), { switched, metadataOnly: json.isMetadataUpdate === true });
  }

  function flush() {
    clearTimeout(timer);
    timer = 0;
    if (!pending) return;
    const { uuid, text } = pending;
    pending = null;
    if (!item || item.uuid !== uuid) return;
    if ((item.content.text || '') === text) return; // nothing changed

    const json = JSON.parse(JSON.stringify(item));
    json.content.text = text;
    json.content.preview_plain = previewOf(text);
    delete json.isMetadataUpdate;
    item.content.text = text; // remember what was sent

    post('save-items', { items: [json] }, (data) => {
      if (app.onSaveResult) app.onSaveResult(!(data && data.error));
    });
  }

  window.addEventListener('message', (event) => {
    let msg = event.data;
    if (typeof msg === 'string') {
      try { msg = JSON.parse(msg); } catch (_) { return; }
    }
    if (!msg || typeof msg !== 'object') return;

    if (msg.action === 'component-registered') {
      sessionKey = msg.sessionKey;
      const d = msg.data || {};
      environment = d.environment || 'web';
      app.onRegistered({ environment, platform: d.platform, componentData: msg.componentData || {} });
      app.onThemes(d.activeThemeUrls || []);
      post('stream-context-item', {}, (data) => handleItem(data.item), true);
      post('themes-activated', {});
      outbox.splice(0).forEach(([a, dd, cb, keep]) => post(a, dd, cb, keep));
      return;
    }

    if (msg.action === 'themes') {
      app.onThemes((msg.data && msg.data.themes) || []);
      return;
    }

    const id = msg.original && msg.original.messageId;
    if (id && replies.has(id)) {
      const r = replies.get(id);
      if (!r.keep) replies.delete(id);
      r.onReply(msg.data || {});
    }
  });

  // The iframe can be torn down right after a keystroke: push pending text out first.
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });

  return {
    save(text) {
      if (!item) return;
      pending = { uuid: item.uuid, text };
      clearTimeout(timer);
      timer = setTimeout(flush, SAVE_DELAY_MS);
    },
    flush,
    hasPending: () => pending !== null,
    setComponentData(data) {
      post('set-component-data', { componentData: data });
    },
  };
}
