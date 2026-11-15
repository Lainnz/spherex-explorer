# SPHEREx Xplorer — frontend

Local demo website (Next.js + TypeScript + Tailwind CSS).

## Run it (PowerShell)

```powershell
cd D:\Projects\SPHEREx-Xplorer\frontend
npm install      # first time only (and after package.json changes)
npm run dev
```

Then open http://localhost:3000. Stop the server with Ctrl+C.

## Folder map

- `app/page.tsx` — landing page (`/`)
- `app/explore/page.tsx` — Stellar View page (`/explore?ra=..&dec=..`)
- `app/layout.tsx` — wrapper shared by every page (font, page title)
- `app/globals.css` — global styles and Tailwind
- `components/` — reusable pieces (e.g. the header)
- `public/brand/` — copies of the logos (originals stay in `../assets`)
