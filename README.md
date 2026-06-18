# TigerShelf

TigerShelf is a local-first web app for Korean webnovel translation workflows.

It is built for the exact workflow we have been using manually:

- import a DRM-free EPUB
- keep the original novel private and local
- split the EPUB into chapter-like spine sections
- preserve source text beside translations
- maintain an updatable glossary/styleguide
- translate chapters through a local API proxy
- export translated text or a simple reading EPUB

## Current MVP status

This is the first working foundation. It is not polished yet, but it gives us a real app to iterate on instead of doing everything by hand in chat.

Included now:

- Novel library/gallery stored in browser IndexedDB
- EPUB import and chapter extraction
- Metadata and cover extraction when available
- Chapter list with source/translation panes
- Glossary editor
- Translation range runner with adjustable concurrency
- Local Express API proxy for OpenAI Responses API calls
- TXT export
- Basic EPUB export

## Run it on your PC

1. Install Node.js 20 or newer.
2. Open a terminal in this repo folder.
3. Run:

```bash
npm install
cp .env.example .env
```

4. Open `.env` and paste your OpenAI API key:

```bash
OPENAI_API_KEY=sk-proj-your-key-here
```

5. Start the app:

```bash
npm run dev
```

6. Open the web address Vite prints, usually:

```text
http://localhost:5173
```

## Use it from your iPhone on the same Wi-Fi

When the app is running on your PC, Vite also prints a Network URL like:

```text
http://192.168.x.x:5173
```

Open that URL in Safari on your iPhone.

## Security note

The OpenAI API key stays in `.env` on your computer and is used by the local Express server. The browser app calls `/api/translate`; it does not need the key pasted into the web page.

Do not deploy this as a public website with your API key on the server unless you add authentication.

## Translation workflow

Recommended first pass:

1. Import a Korean EPUB.
2. Review the detected chapter list.
3. Add or edit glossary terms.
4. Translate a small range first, like chapters 1–3.
5. Read the output and patch glossary terms.
6. Increase batch size once the glossary feels stable.

For OpenNovel-style behavior, the goal is:

1. Split whole novel by chapter.
2. Generate whole-novel glossary candidates.
3. Translate chapters in controlled parallel batches.
4. Run consistency repair pass.
5. Export final EPUB/TXT/DOCX.

## Next things to build

- Better chapter detection for messy EPUBs
- Glossary candidate generation
- Correction pass that rewrites older translated chapters after glossary changes
- DOCX export
- Queue persistence and retry buttons
- Better EPUB cover embedding
- Optional server-side project storage
