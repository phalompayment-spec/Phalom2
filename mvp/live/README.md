# Talat Pay live test (two phones, Cloudflare)

A test you can run in a real market with two real phones. **Test money only:** no bank is involved, and "paying" just means tapping Pay on the tourist page.

- **Vendor phone** opens `/vendor`. It is Lao first, with an EN switch, and has four tabs:
  - **Home:** the big QR, the LaoQR / Alipay·WeChat switch and today's total.
  - **Sales:** totals by country and by app.
  - **Alerts:** every payment, grouped by day.
  - **Me:** sound, sticker, language and the shop code.
- **Tourist phone** scans the vendor's QR with its normal camera and opens `/tourist`, which stands in for the tourist's own bank app.
  - The tourist picks an app, types the price in kip, confirms and pays.
  - The page is in English, Chinese, Thai or Vietnamese, picked from the phone's language.
- **The alert:** the vendor phone shows the amount within about a second, with a chime and a vibration. It also reads the amount aloud if the phone has a Lao voice.

## What's in the folder

| Path | What it is |
|---|---|
| `src/index.js` | The Cloudflare Worker (API) and one Durable Object per shop, which stores its sales in SQLite and pushes live alerts over a WebSocket |
| `public/vendor.html` | Vendor phone |
| `public/tourist.html` | Tourist phone |
| `public/index.html` | "I'm the seller / I'm the tourist" chooser at `/` |
| `public/talat.css` | Talat colours and components shared by the pages |
| `public/lib/qrcode.js` | QR generator (qrcode-generator 1.4.4, MIT, Kazuhiko Arase) |
| `wrangler.jsonc` | Cloudflare config |

## Put it online from GitHub (no terminal)

This folder lives in the GitHub repo `phalompayment-spec/Phalom2` at `mvp/live`. Cloudflare can build it from there, and it redeploys on every push to `main`.

1. Sign in at dash.cloudflare.com with the team's free account.
2. Go to **Workers & Pages**, then **Create**, then **Import a repository**.
3. Connect GitHub when asked, and allow access to **Phalom2**.
4. Pick **Phalom2** and fill in the settings:
   - **Project name:** `talat-pay-test`. It must match the name in `wrangler.jsonc`.
   - **Build command:** leave empty.
   - **Deploy command:** `npx wrangler deploy`
   - **Root directory** (under Advanced settings): `mvp/live`
5. Click **Deploy**. When it finishes, Cloudflare shows the link `https://talat-pay-test.<your-subdomain>.workers.dev`.

The labels can be worded a little differently in Cloudflare's dashboard, but the four settings stay the same.

## Put it online from a laptop (your own Cloudflare account, free plan)

You need Node.js 18 or newer and a free Cloudflare account.

```bash
cd mvp/live
npm install              # installs wrangler 4.20.0 locally
npx wrangler login       # opens a browser to sign in to your Cloudflare account
npx wrangler deploy
```

Wrangler prints a link like `https://talat-pay-test.<your-subdomain>.workers.dev`. That link is the whole app.

- **Cost:** it stays on the free plan, because the Durable Object uses SQLite storage, which the free Workers plan allows.
- **Free limits:** about 100,000 requests a day, far more than a market test needs.
- **No card needed:** nothing here needs a credit card.

## Try it on one computer first

```bash
npx wrangler dev
```

Then open `http://localhost:8787/vendor` in one browser window and the tourist link from the vendor's Me tab in another.

## Run the street test with two phones

1. **Vendor phone:**
   - Open `https://…workers.dev/vendor`.
   - Enter a shop name and market, then tap **ສ້າງຮ້ານທົດລອງ** (Create test shop).
   - Tap the screen once so the browser allows sound.
2. **Tourist phone:** open the camera and scan the QR on the vendor's screen, then follow the steps and pay.
3. **Vendor phone:** the payment pops up with a chime. It lands in **Alerts** and is counted in **Sales**.
4. **Alipay or WeChat:** flip the switch on the vendor's Home to **Alipay · WeChat**. The tourist then only sees Alipay and WeChat Pay. This matches the real setup, where those two use a separate QR.
5. **Second phone for the same shop:** in **Me**, tap **ເປີດຮ້ານນີ້ໃນໂທລະສັບອື່ນ** (Open this shop on another phone) and send the link.
6. **Paper sticker:** in **Me**, tap **ພິມສະຕິກເກີ QR** (Print the QR sticker).

**Tips for the real test**
- Keep the vendor page open in the front. The Keep screen on switch in **Me** stops the screen from sleeping where the browser allows it.
- If the vendor phone loses signal, it reconnects by itself and picks up any payments it missed.
- Most phones have no Lao voice in the browser, so expect the chime. The Android voice kit (`../voice-kit`) is where the Lao voice lives.

## Things to know before showing it

- **Not a bank QR:** the QR opens the test page. A real tourist's bank app would not understand it. In the real product, the QR on Home is the vendor's own LaoQR from their bank.
- **No login:** anyone who knows a shop's 6-letter code can add test payments to it. That is fine for a test with fake money, but it is not how a real version would work.
- **Short history:** each shop keeps its latest 500 payments.
- **Lao text:** the Lao wording still needs a check by a native speaker. The Chinese, Thai and Vietnamese on the tourist page need the same check.

## API (for reference)

| Method and path | Body | Returns |
|---|---|---|
| `POST /api/shops` | `{name, area}` | `{id}` |
| `GET /api/shops/:id` | | `{id, name, area, created}` |
| `POST /api/shops/:id/pay` | `{kip, app}` | `{sale}` |
| `GET /api/shops/:id/sales` | | `{sales}` |
| `GET /api/shops/:id/ws` | | WebSocket that receives `{type:"sale", sale}` |

- **kip:** a whole number from 1,000 to 100,000,000.
- **app:** one of `th`, `vn`, `kh`, `up`, `la`, `ali`, `wx`.
- **WebSocket:** send `ping` to get `pong`.
