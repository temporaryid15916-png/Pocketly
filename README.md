# POCKETLY — Smart Money. Better Life.

Premium offline-first personal finance PWA. Tracks income, expenses, budgets, and savings **on this device only**. No account server.

## Publish on GitHub Pages

1. Create a new GitHub repository (public).
2. Upload **all files in this folder** to the repository root (or a `docs/` folder if you prefer).
   - `index.html`
   - `app.js`
   - `manifest.webmanifest`
   - `sw.js`
   - `icons/` (all four PNGs)
3. In the repo **Settings → Pages**:
   - Source: **Deploy from a branch**
   - Branch: `main` (or `master`), folder `/` (or `/docs`)
4. Wait a minute, then open `https://YOUR_USERNAME.github.io/YOUR_REPO/`
5. Use **HTTPS** only. Service worker and install prompts require a secure origin.

## Install on Android (Chrome)

1. Open the live GitHub Pages URL in **Chrome**.
2. Tap **Install app** in the header, or Chrome menu → **Install app** / **Add to Home screen**.
3. Confirm the install prompt.
4. Launch from the home-screen icon — the app opens in **standalone** mode (no browser chrome).

## Install on iPhone / iPad (Safari)

1. Open the live URL in **Safari** (not Chrome-in-iOS).
2. Tap the **Share** button (□↑).
3. Choose **Add to Home Screen**.
4. Confirm. Launch from the new icon for standalone mode.

iOS does **not** support the Android-style `beforeinstallprompt` flow. The in-app Install button shows accurate Safari instructions on iPhone/iPad.

## Desktop (Chrome / Edge)

Use the **Install app** button when the browser offers it, or the browser menu → Install.

## Data safety

- Storage key: `pocketly.ledger.v1` (unchanged). Existing ledgers continue to work.
- All records stay in the browser’s local storage until you export or erase them.
- PIN is stored as a salted hash, not as plain digits. Client-side PIN is not full encryption.

## Offline

After the first successful load over HTTPS, the app shell is cached. You can open and use the ledger without a network connection. Financial data is not sent to external servers.

## Local development

```bash
# From this folder
python3 -m http.server 8080
# Open http://localhost:8080
```

## What’s included

- Premium hybrid fintech UI (warm ivory / cream, deep forest green, emerald accents)
- Full dashboard, history, budget, savings, insights, months, alerts, settings
- Bengali + English
- Light / Dark / System themes
- Installable PWA (manifest + service worker + maskable icons)
- Onboarding, help guide, empty states
