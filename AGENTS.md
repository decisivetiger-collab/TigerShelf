# TigerShelf agent notes

TigerShelf is for a local-first Korean webnovel translation workflow.

Priorities:

1. Keep the original uploaded EPUB private and local.
2. Preserve source chapter order exactly.
3. Translate faithfully, not as a summary or rewrite.
4. Use square brackets instead of angle brackets in generated translations.
5. Keep glossary terms, names, pronouns, ranks, stats, and magic terms consistent.
6. Prefer simple working features over complicated architecture.
7. Make the app usable from an iPhone browser while the PC runs the local dev server.

Current MVP architecture:

- React + Vite browser UI
- Browser IndexedDB for project storage
- JSZip for EPUB parsing and EPUB export
- Express local API proxy in `server/index.mjs`
- OpenAI Responses API calls through `/api/translate`

Do not put API keys in frontend code. Keep them in `.env` only.
