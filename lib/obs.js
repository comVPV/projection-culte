// Pilotage automatique d'OBS (obs-websocket v5, intégré à OBS 28+).
// Place la source « caméra » dans la zone libre (cadrage « cover » centré sur l'orateur).
const WebSocket = require('ws');
const crypto = require('crypto');

const b64sha = s => crypto.createHash('sha256').update(s).digest('base64');

class Obs {
  constructor(onStatus) {
    this.cfg = { enabled: false, host: '127.0.0.1', port: 4455, password: '', scene: '', camSource: '', shiftX: 0 };
    this.onStatus = onStatus || (() => {});
    this.status = { state: 'off', msg: 'Désactivé', crop: null, zone: '', scenes: [], sources: [] };
    this.ws = null; this.id = 0; this.pending = new Map(); this.timer = null; this.backoff = 1000;
    this.lastKey = ''; this.origIndex = null; this.busy = Promise.resolve();
  }
  set(msg, state, extra) { this.status = { ...this.status, state, msg, ...(extra || {}) }; this.onStatus(this.status); }
  configure(cfg) {
    const c = { ...this.cfg, ...cfg };
    c.port = Math.max(1, Math.min(65535, parseInt(c.port, 10) || 4455));
    c.host = String(c.host || '127.0.0.1').trim() || '127.0.0.1';
    c.shiftX = Math.max(-50, Math.min(50, +c.shiftX || 0));
    const reconnect = c.enabled !== this.cfg.enabled || c.host !== this.cfg.host || c.port !== this.cfg.port || c.password !== this.cfg.password;
    this.cfg = c; this.lastKey = '';
    if (reconnect) this.close();
    if (c.enabled && !this.ws) this.connect(); else if (!c.enabled) this.set('Désactivé', 'off', { crop: null });
  }
  close() {
    clearTimeout(this.timer); this.timer = null;
    if (this.ws) { try { this.ws.removeAllListeners(); this.ws.close(); } catch (e) {} this.ws = null; }
    for (const [, p] of this.pending) p.reject(new Error('Connexion fermée'));
    this.pending.clear(); this.ready = false; this.origIndex = null;
  }
  connect() {
    if (this.ws || !this.cfg.enabled) return;
    this.set('Connexion à OBS…', 'connecting');
    let ws;
    try { ws = new WebSocket('ws://' + this.cfg.host + ':' + this.cfg.port, 'obswebsocket.json'); } catch (e) { return this.retry(e.message); }
    this.ws = ws;
    ws.on('message', d => this.onMsg(d));
    ws.on('error', e => { /* géré par close */ this.lastErr = e.message; });
    ws.on('close', () => { if (this.ws === ws) { this.ws = null; this.ready = false; this.retry(this.lastErr || 'OBS injoignable'); } });
  }
  retry(why) {
    if (!this.cfg.enabled) return;
    this.set('OBS injoignable (' + why + ') — nouvel essai…', 'error');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; this.connect(); }, this.backoff);
    this.backoff = Math.min(15000, this.backoff * 1.7);
  }
  onMsg(raw) {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.op === 0) {
      const d = { rpcVersion: 1 };
      const a = m.d && m.d.authentication;
      if (a) { const sec = b64sha(this.cfg.password + a.salt); d.authentication = b64sha(sec + a.challenge); }
      this.ws.send(JSON.stringify({ op: 1, d }));
    } else if (m.op === 2) {
      this.ready = true; this.backoff = 1000; this.set('Connecté à OBS', 'ok');
      this.lastKey = ''; this.onReady && this.onReady();
    } else if (m.op === 7) {
      const p = this.pending.get(m.d.requestId); if (!p) return; this.pending.delete(m.d.requestId);
      if (m.d.requestStatus && m.d.requestStatus.result) p.resolve(m.d.responseData || {});
      else p.reject(new Error((m.d.requestStatus && m.d.requestStatus.comment) || 'Requête refusée'));
    }
  }
  req(type, data) {
    return new Promise((resolve, reject) => {
      if (!this.ws || !this.ready) return reject(new Error('OBS non connecté'));
      const id = String(++this.id);
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error('OBS ne répond pas')); }, 5000);
      this.pending.set(id, { resolve: v => { clearTimeout(t); resolve(v); }, reject: e => { clearTimeout(t); reject(e); } });
      this.ws.send(JSON.stringify({ op: 6, d: { requestType: type, requestId: id, requestData: data || {} } }));
    });
  }
  // Test : liste les scènes et les sources de la scène choisie
  async test() {
    if (!this.cfg.enabled) throw new Error('Active d\'abord le pilotage OBS');
    if (!this.ready) throw new Error('OBS n\'est pas connecté (vérifie hôte, port et mot de passe)');
    const sl = await this.req('GetSceneList');
    const scenes = (sl.scenes || []).map(x => x.sceneName);
    const scene = this.cfg.scene || sl.currentProgramSceneName;
    let sources = [];
    try { sources = ((await this.req('GetSceneItemList', { sceneName: scene })).sceneItems || []).map(x => x.sourceName); } catch (e) {}
    this.set(this.status.msg, this.status.state, { scenes, sources });
    return { scenes, sources, scene };
  }
  // zone = { rect:[x,y,w,h] (canevas 1920x1080), top:boolean }
  apply(zone) {
    const key = JSON.stringify([zone, this.cfg.scene, this.cfg.camSource, this.cfg.shiftX]);
    if (!this.cfg.enabled || !this.ready || !this.cfg.camSource || key === this.lastKey) return;
    this.lastKey = key;
    this.busy = this.busy.then(() => this._apply(zone)).catch(e => { this.lastKey = ''; this.set('OBS : ' + e.message, 'error'); });
    return this.busy;
  }
  async _apply(zone) {
    const vs = await this.req('GetVideoSettings');
    const bw = vs.baseWidth || 1920, bh = vs.baseHeight || 1080, sx = bw / 1920, sy = bh / 1080;
    const sceneName = this.cfg.scene || (await this.req('GetSceneList')).currentProgramSceneName;
    const { sceneItemId } = await this.req('GetSceneItemId', { sceneName, sourceName: this.cfg.camSource });
    const tr = (await this.req('GetSceneItemTransform', { sceneName, sceneItemId })).sceneItemTransform;
    const cw = tr.sourceWidth, ch = tr.sourceHeight;
    if (!cw || !ch) throw new Error('Taille de la source caméra inconnue');
    const [zx, zy, zw0, zh0] = zone.rect, zw = zw0 * sx, zh = zh0 * sy;
    const s = Math.max(zw / cw, zh / ch);
    const totX = Math.max(0, cw - zw / s), totY = Math.max(0, ch - zh / s);
    const left = Math.round(Math.max(0, Math.min(totX, totX * (0.5 + this.cfg.shiftX / 100))));
    const top = Math.round(totY / 2);
    const crop = { left, right: Math.round(totX - left), top, bottom: Math.round(totY - top) };
    await this.req('SetSceneItemTransform', { sceneName, sceneItemId, sceneItemTransform: {
      positionX: zx * sx, positionY: zy * sy, scaleX: s, scaleY: s, rotation: 0, alignment: 5, boundsType: 'OBS_BOUNDS_NONE',
      cropLeft: crop.left, cropRight: crop.right, cropTop: crop.top, cropBottom: crop.bottom } });
    // coin : la caméra passe au-dessus de l'habillage ; sinon elle retrouve sa place
    if (zone.top) {
      if (this.origIndex == null) {
        const list = (await this.req('GetSceneItemList', { sceneName })).sceneItems || [];
        const me = list.find(x => x.sceneItemId === sceneItemId);
        this.origIndex = me ? me.sceneItemIndex : null; this.origScene = sceneName;
        await this.req('SetSceneItemIndex', { sceneName, sceneItemId, sceneItemIndex: list.length - 1 });
      }
    } else if (this.origIndex != null) {
      await this.req('SetSceneItemIndex', { sceneName: this.origScene || sceneName, sceneItemId, sceneItemIndex: this.origIndex });
      this.origIndex = null;
    }
    this.set('Connecté à OBS', 'ok', { crop, zone: zone.rect.map(Math.round).join(', '), scale: +s.toFixed(3) });
  }
}
module.exports = { Obs };
