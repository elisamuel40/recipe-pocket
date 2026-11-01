// Minimal Chrome DevTools Protocol client over WebSocket (Node 22+ global WebSocket).
// Used only by the E2E harness to drive targets Playwright does not expose as pages,
// such as the real side panel and the extension service worker.

export class CdpClient {
  /** @param {string} wsUrl */
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error(`CDP connect failed: ${wsUrl}`));
    });
    return new CdpClient(ws);
  }

  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    ws.onmessage = (e) => {
      const msg = JSON.parse(typeof e.data === 'string' ? e.data : e.data.toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const cb of this.listeners.get(msg.method) ?? []) cb(msg.params);
      }
    };
    ws.onclose = () => {
      for (const { reject } of this.pending.values()) reject(new Error('CDP socket closed'));
      this.pending.clear();
    };
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, cb) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(cb);
  }

  /**
   * Evaluate `fn(arg)` in the target and return its JSON value.
   * @param {Function|string} fn
   */
  async eval(fn, arg) {
    const expression = typeof fn === 'string' ? fn : `(${fn.toString()})(${JSON.stringify(arg ?? null)})`;
    const res = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (res.exceptionDetails) {
      const d = res.exceptionDetails;
      throw new Error(`eval failed: ${d.exception?.description ?? d.text}`);
    }
    return res.result.value;
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}
