# Yomitan Frequency Combiner

A static web app to combine multiple Yomitan dictionary `.zip` files into a single archive for easy download.

No backend — everything runs in the browser.

## Development

```bash
cd frontend
npm install
npm run dev
```

## Build

```bash
cd frontend
npm run build
# output in frontend/dist/
```

## Deploy

Push to GitHub and connect to [Netlify](https://netlify.com), [Vercel](https://vercel.com), or [Cloudflare Pages](https://pages.cloudflare.com) with:
- **Build command:** `npm run build`
- **Publish directory:** `frontend/dist`
