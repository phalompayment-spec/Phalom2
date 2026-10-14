// Talat Pay live test backend (Cloudflare Worker + one Durable Object per shop).
// Test money only: a "payment" here is a tourist tapping Pay on the test page. No bank is involved.
//
//   POST /api/shops                 {name, area}            -> {id}
//   GET  /api/shops/:id                                     -> {id, name, area, created}
//   POST /api/shops/:id/pay         {kip, app, country}     -> {sale}
//   GET  /api/shops/:id/sales                               -> {sales:[...]}   newest first, last 500
//   GET  /api/shops/:id/ws          (WebSocket)             <- {type:"sale", sale} on every payment
//
// The two pages (vendor.html, tourist.html) are served from ./public as static assets.

import { DurableObject } from "cloudflare:workers";

const APPS = {
  th: { name: "Thai bank app", country: "TH" },
  vn: { name: "Vietnamese bank app", country: "VN" },
  kh: { name: "Cambodian bank app", country: "KH" },
  up: { name: "UnionPay app", country: "CN" },
  ali: { name: "Alipay", country: "CN" },
  wx: { name: "WeChat Pay", country: "CN" },
  la: { name: "Lao bank app", country: "LA" },
};
const MAX_KIP = 100_000_000;
const KEEP = 500;
// No 0/O/Q/1/I so codes are easy to read out loud.
const CODE_CHARS = "ABCDEFGHJKLMNPRSTUVWXYZ23456789";

export class Shop extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS info (k TEXT PRIMARY KEY, v TEXT)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kip INTEGER NOT NULL, app TEXT NOT NULL,
      country TEXT NOT NULL, at INTEGER NOT NULL)`);
  }

  info() {
    const rows = this.sql.exec(`SELECT k, v FROM info`).toArray();
    if (!rows.length) return null;
    return Object.fromEntries(rows.map((r) => [r.k, r.v]));
  }

  /** Returns false if this code is already taken. */
  create(id, name, area) {
    if (this.info()) return false;
    const now = String(Date.now());
    for (const [k, v] of [["id", id], ["name", name], ["area", area], ["created", now]]) {
      this.sql.exec(`INSERT INTO info (k, v) VALUES (?, ?)`, k, v);
    }
    return true;
  }

  pay(kip, appId) {
    const app = APPS[appId];
    const at = Date.now();
    const id = this.sql
      .exec(`INSERT INTO sales (kip, app, country, at) VALUES (?, ?, ?, ?) RETURNING id`, kip, app.name, app.country, at)
      .one().id;
    this.sql.exec(`DELETE FROM sales WHERE id <= ?`, id - KEEP);
    const sale = { id, kip, app: app.name, country: app.country, at };
    const msg = JSON.stringify({ type: "sale", sale });
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(msg); } catch {}
    }
    return sale;
  }

  sales() {
    return this.sql.exec(`SELECT id, kip, app, country, at FROM sales ORDER BY id DESC LIMIT ?`, KEEP).toArray();
  }

  async fetch(request) {
    // Only used for the vendor's live connection. Hibernation keeps it free while idle.
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  webSocketMessage(ws, message) {
    if (message === "ping") ws.send("pong");
  }

  webSocketClose(ws, code) {
    // Finish the closing handshake so the vendor page sees the close at once and reconnects.
    // 1005/1006 are "no code" markers and cannot be sent back, so answer those with 1000.
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, "bye"); } catch {}
  }
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, max);

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean); // ["api","shops",id,action]
    if (parts[0] !== "api" || parts[1] !== "shops") return new Response("Not found", { status: 404 });

    const stubFor = (id) => env.SHOPS.get(env.SHOPS.idFromName(id));

    // Create a shop
    if (parts.length === 2 && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const name = clean(body.name, 60);
      const area = clean(body.area, 60);
      if (!name) return json({ error: "name_required" }, 400);
      for (let i = 0; i < 5; i++) {
        const id = newCode();
        if (await stubFor(id).create(id, name, area)) return json({ id }, 201);
      }
      return json({ error: "try_again" }, 503);
    }

    const id = (parts[2] || "").toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(id)) return json({ error: "bad_code" }, 400);
    const shop = stubFor(id);
    const action = parts[3] || "";

    if (action === "ws") {
      if (!(await shop.info())) return json({ error: "no_shop" }, 404);
      return shop.fetch(request);
    }

    const info = await shop.info();
    if (!info) return json({ error: "no_shop" }, 404);

    if (!action && request.method === "GET") return json(info);

    if (action === "sales" && request.method === "GET") return json({ sales: await shop.sales() });

    if (action === "pay" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const kip = Number(body.kip);
      if (!Number.isInteger(kip) || kip < 1000 || kip > MAX_KIP) return json({ error: "bad_amount" }, 400);
      if (!APPS[body.app]) return json({ error: "bad_app" }, 400);
      return json({ sale: await shop.pay(kip, body.app) }, 201);
    }

    return json({ error: "not_found" }, 404);
  },
};
