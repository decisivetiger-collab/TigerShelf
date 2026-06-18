import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import JSZip from 'jszip';
import './styles.css';

const DB_NAME = 'tigershelf-mvp-v1';
const STORE = 'projects';

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(project) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ ...project, updatedAt: new Date().toISOString() });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function dbAll() {
  const db = await openDb();
  const rows = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return rows.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

async function dbDelete(id) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

function parseXml(text) {
  return new DOMParser().parseFromString(text, 'application/xml');
}

function resolvePath(base, href) {
  const stack = base ? base.split('/').filter(Boolean) : [];
  for (const part of href.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

function dirName(path) {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}

function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, nav, header, footer').forEach((node) => node.remove());
  const title = doc.querySelector('h1,h2,h3,title')?.textContent?.trim() || '';
  const body = doc.body || doc;
  let text = body.textContent || '';
  text = text
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title, text };
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function parseEpub(file) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const containerFile = zip.file('META-INF/container.xml');
  if (!containerFile) throw new Error('This EPUB is missing META-INF/container.xml.');

  const container = parseXml(await containerFile.async('text'));
  const opfPath = container.querySelector('rootfile')?.getAttribute('full-path');
  if (!opfPath) throw new Error('Could not find the EPUB package document.');

  const opf = parseXml(await zip.file(opfPath).async('text'));
  const base = dirName(opfPath);
  const meta = opf.querySelector('metadata');
  const getText = (selector) => meta?.querySelector(selector)?.textContent?.trim() || '';

  const manifest = new Map();
  opf.querySelectorAll('manifest item').forEach((item) => {
    manifest.set(item.getAttribute('id'), {
      id: item.getAttribute('id'),
      href: item.getAttribute('href'),
      mediaType: item.getAttribute('media-type'),
      properties: item.getAttribute('properties') || ''
    });
  });

  let coverDataUrl = '';
  const coverId = opf.querySelector('metadata meta[name="cover"]')?.getAttribute('content');
  const coverItem = manifest.get(coverId) || [...manifest.values()].find((item) => item.properties.includes('cover-image'));
  if (coverItem?.href) {
    const path = resolvePath(base, coverItem.href);
    const cover = zip.file(path);
    if (cover) coverDataUrl = await blobToDataUrl(await cover.async('blob'));
  }

  const spineIds = [...opf.querySelectorAll('spine itemref')]
    .map((item) => item.getAttribute('idref'))
    .filter(Boolean);

  const chapters = [];
  for (const idref of spineIds) {
    const item = manifest.get(idref);
    if (!item || !item.href || !/x?html|html/i.test(item.mediaType || item.href)) continue;
    const path = resolvePath(base, item.href);
    const entry = zip.file(path);
    if (!entry) continue;
    const html = await entry.async('text');
    const { title, text } = htmlToText(html);
    if (!text || text.length < 20) continue;
    chapters.push({
      id: uid(),
      index: chapters.length + 1,
      href: path,
      title: title || `Chapter ${chapters.length + 1}`,
      sourceText: text,
      translation: '',
      status: 'raw',
      error: ''
    });
  }

  return {
    id: uid(),
    title: getText('dc\\:title, title') || file.name.replace(/\.epub$/i, ''),
    originalFileName: file.name,
    author: getText('dc\\:creator, creator'),
    language: getText('dc\\:language, language') || 'ko',
    description: getText('dc\\:description, description'),
    coverDataUrl,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    glossary: [],
    notes: 'Imported from EPUB. Original file is not uploaded anywhere by TigerShelf.',
    chapters
  };
}

function glossaryText(project) {
  if (!project.glossary?.length) return 'No glossary entries yet.';
  return project.glossary
    .filter((row) => row.korean || row.english)
    .map((row) => `- ${row.korean || '?'} = ${row.english || '?'} [${row.type || 'term'}] ${row.notes || ''}`.trim())
    .join('\n');
}

function buildPrompt(project, chapter) {
  return `Translate Korean webnovel text into English faithfully and completely.

Rules:
- Do not summarize, shorten, rewrite, censor, add, remove, or invent content.
- Preserve chapter title, paragraph order, scene order, pacing, repetition, awkwardness, and authorial tone as much as possible while making English readable.
- Keep names, organizations, skills, stats, magic terms, ranks, items, and recurring terminology consistent.
- If gender, subject, or speaker is ambiguous in Korean, preserve ambiguity unless context clearly resolves it.
- Avoid angle brackets. Replace any < > style brackets with square brackets [ ].
- Output only the translated chapter text. Do not explain anything.

Novel: ${project.title}
Chapter: ${chapter.title}

Glossary and styleguide:
${glossaryText(project)}

Korean source:
${chapter.sourceText}`;
}

async function translateChapter(project, chapter) {
  const res = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: buildPrompt(project, chapter) })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Translation request failed: ${res.status}`);
  }
  const data = await res.json();
  return data.text?.trim() || '';
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeName(name) {
  return (name || 'tigershelf').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
}

function exportTxt(project) {
  const text = project.chapters
    .map((chapter) => `${chapter.title}\n\n${chapter.translation || chapter.sourceText}`)
    .join('\n\n\n');
  downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${safeName(project.title)}_translated_so_far.txt`);
}

function escapeHtml(value = '') {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

async function exportEpub(project) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);

  const chapters = project.chapters.filter((chapter) => chapter.translation || chapter.sourceText);
  const manifestItems = chapters.map((chapter, idx) => `<item id="chap${idx + 1}" href="chap${idx + 1}.xhtml" media-type="application/xhtml+xml"/>`).join('\n    ');
  const spineItems = chapters.map((_, idx) => `<itemref idref="chap${idx + 1}"/>`).join('\n    ');
  const navItems = chapters.map((chapter, idx) => `<li><a href="chap${idx + 1}.xhtml">${escapeHtml(chapter.title)}</a></li>`).join('\n      ');

  zip.file('OEBPS/package.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${project.id}</dc:identifier>
    <dc:title>${escapeHtml(project.title)}</dc:title>
    <dc:creator>${escapeHtml(project.author || '')}</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="style" href="style.css" media-type="text/css"/>
    ${manifestItems}
  </manifest>
  <spine>
    ${spineItems}
  </spine>
</package>`);

  zip.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Contents</title><link rel="stylesheet" href="style.css"/></head><body><nav epub:type="toc"><h1>Contents</h1><ol>${navItems}</ol></nav></body></html>`);
  zip.file('OEBPS/style.css', 'body{font-family:serif;line-height:1.55;margin:8%;} h1{font-size:1.35em;} p{margin:0 0 1em;}');

  chapters.forEach((chapter, idx) => {
    const paragraphs = (chapter.translation || chapter.sourceText).split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`).join('\n');
    zip.file(`OEBPS/chap${idx + 1}.xhtml`, `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${escapeHtml(chapter.title)}</title><link rel="stylesheet" href="style.css"/></head><body><h1>${escapeHtml(chapter.title)}</h1>${paragraphs}</body></html>`);
  });

  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' });
  downloadBlob(blob, `${safeName(project.title)}_translated_so_far.epub`);
}

function Progress({ project }) {
  const translated = project.chapters.filter((chapter) => chapter.translation).length;
  const total = project.chapters.length || 1;
  return (
    <div className="progress">
      <div style={{ width: `${Math.round((translated / total) * 100)}%` }} />
      <span>{translated}/{total} translated</span>
    </div>
  );
}

function App() {
  const [projects, setProjects] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [selectedChapterId, setSelectedChapterId] = useState('');
  const [rangeStart, setRangeStart] = useState(1);
  const [rangeEnd, setRangeEnd] = useState(3);
  const [concurrency, setConcurrency] = useState(2);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState('Ready.');

  useEffect(() => {
    dbAll().then((rows) => {
      setProjects(rows);
      if (rows[0]) setSelectedId(rows[0].id);
    });
  }, []);

  const project = useMemo(() => projects.find((item) => item.id === selectedId), [projects, selectedId]);
  const chapter = useMemo(() => project?.chapters.find((item) => item.id === selectedChapterId) || project?.chapters[0], [project, selectedChapterId]);

  async function refresh() {
    const rows = await dbAll();
    setProjects(rows);
  }

  async function saveProject(next) {
    await dbPut(next);
    await refresh();
    setSelectedId(next.id);
  }

  async function importFiles(files) {
    for (const file of files) {
      if (!file.name.toLowerCase().endsWith('.epub')) continue;
      setLog(`Importing ${file.name}...`);
      const parsed = await parseEpub(file);
      await saveProject(parsed);
      setLog(`Imported ${parsed.title}: ${parsed.chapters.length} chapters/sections.`);
    }
  }

  function patchSelectedProject(patch) {
    if (!project) return;
    const next = { ...project, ...patch, updatedAt: new Date().toISOString() };
    setProjects((rows) => rows.map((row) => (row.id === next.id ? next : row)));
    dbPut(next);
  }

  function patchChapter(chapterId, patch) {
    if (!project) return;
    patchSelectedProject({
      chapters: project.chapters.map((item) => (item.id === chapterId ? { ...item, ...patch } : item))
    });
  }

  async function translateOne(ch) {
    if (!project || !ch) return;
    patchChapter(ch.id, { status: 'translating', error: '' });
    try {
      setLog(`Translating ${ch.index}. ${ch.title}`);
      const text = await translateChapter(project, ch);
      patchChapter(ch.id, { translation: text, status: 'translated', translatedAt: new Date().toISOString(), error: '' });
      setLog(`Translated ${ch.index}. ${ch.title}`);
    } catch (error) {
      patchChapter(ch.id, { status: 'error', error: error.message });
      setLog(`Error: ${error.message}`);
    }
  }

  async function translateRange() {
    if (!project) return;
    setBusy(true);
    const queue = project.chapters.filter((ch) => ch.index >= rangeStart && ch.index <= rangeEnd && !ch.translation);
    let cursor = 0;
    async function worker() {
      while (cursor < queue.length) {
        const item = queue[cursor++];
        await translateOne(item);
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length || 1) }, worker));
    setBusy(false);
    setLog('Range finished. Review the chapters before exporting.');
  }

  function addGlossaryRow() {
    if (!project) return;
    patchSelectedProject({
      glossary: [...(project.glossary || []), { id: uid(), korean: '', english: '', type: 'term', notes: '', status: 'watch' }]
    });
  }

  function patchGlossary(id, field, value) {
    if (!project) return;
    patchSelectedProject({
      glossary: project.glossary.map((row) => (row.id === id ? { ...row, [field]: value } : row))
    });
  }

  async function deleteProject() {
    if (!project || !confirm(`Delete ${project.title}?`)) return;
    await dbDelete(project.id);
    const rows = await dbAll();
    setProjects(rows);
    setSelectedId(rows[0]?.id || '');
  }

  return (
    <div className="appShell">
      <aside className="sidebar">
        <div className="brand"><span>TS</span><div><strong>TigerShelf</strong><small>Novel translation workbench</small></div></div>
        <label className="importButton">Import EPUB<input type="file" accept=".epub,application/epub+zip" multiple onChange={(e) => importFiles([...e.target.files])} /></label>
        <div className="shelf">
          {projects.map((item) => (
            <button key={item.id} className={item.id === selectedId ? 'book active' : 'book'} onClick={() => setSelectedId(item.id)}>
              <div className="cover">{item.coverDataUrl ? <img src={item.coverDataUrl} /> : <span>{item.title.slice(0, 2).toUpperCase()}</span>}</div>
              <div><strong>{item.title}</strong><small>{item.chapters.length} chapters</small></div>
            </button>
          ))}
        </div>
      </aside>

      <main className="main">
        {!project ? (
          <section className="empty"><h1>Import a Korean EPUB to start.</h1><p>TigerShelf will split it into chapter-like sections, then let you translate and export it.</p></section>
        ) : (
          <>
            <section className="heroPanel">
              <div className="heroCover">{project.coverDataUrl ? <img src={project.coverDataUrl} /> : <span>{project.title.slice(0, 2).toUpperCase()}</span>}</div>
              <div className="heroText">
                <p className="eyebrow">Current project</p>
                <h1>{project.title}</h1>
                <p>{project.author || 'Unknown author'} · {project.language || 'ko'} · {project.chapters.length} chapters/sections</p>
                <Progress project={project} />
                <div className="buttonRow">
                  <button onClick={() => exportTxt(project)}>Export TXT</button>
                  <button onClick={() => exportEpub(project)}>Export EPUB</button>
                  <button className="danger" onClick={deleteProject}>Delete project</button>
                </div>
              </div>
            </section>

            <section className="panel">
              <h2>Translate range</h2>
              <div className="rangeGrid">
                <label>Start<input type="number" min="1" value={rangeStart} onChange={(e) => setRangeStart(Number(e.target.value))} /></label>
                <label>End<input type="number" min="1" value={rangeEnd} onChange={(e) => setRangeEnd(Number(e.target.value))} /></label>
                <label>Parallel jobs<input type="number" min="1" max="8" value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))} /></label>
                <button disabled={busy} onClick={translateRange}>{busy ? 'Translating...' : 'Translate range'}</button>
              </div>
              <p className="log">{log}</p>
            </section>

            <section className="layout">
              <div className="panel chapters">
                <h2>Chapters</h2>
                {project.chapters.map((item) => (
                  <button key={item.id} className={chapter?.id === item.id ? 'chapter active' : 'chapter'} onClick={() => setSelectedChapterId(item.id)}>
                    <span>{String(item.index).padStart(4, '0')}</span>
                    <strong>{item.title}</strong>
                    <em>{item.translation ? 'translated' : item.status}</em>
                  </button>
                ))}
              </div>

              <div className="panel editor">
                {chapter && (
                  <>
                    <div className="editorHead"><h2>{chapter.title}</h2><button disabled={busy} onClick={() => translateOne(chapter)}>Translate this</button></div>
                    {chapter.error && <p className="error">{chapter.error}</p>}
                    <label>Source Korean<textarea value={chapter.sourceText} readOnly /></label>
                    <label>English translation<textarea value={chapter.translation} onChange={(e) => patchChapter(chapter.id, { translation: e.target.value, status: e.target.value ? 'translated' : 'raw' })} /></label>
                  </>
                )}
              </div>
            </section>

            <section className="panel">
              <div className="editorHead"><h2>Glossary / styleguide</h2><button onClick={addGlossaryRow}>Add term</button></div>
              <div className="glossary">
                {(project.glossary || []).map((row) => (
                  <div className="glossaryRow" key={row.id}>
                    <input placeholder="Korean" value={row.korean} onChange={(e) => patchGlossary(row.id, 'korean', e.target.value)} />
                    <input placeholder="English" value={row.english} onChange={(e) => patchGlossary(row.id, 'english', e.target.value)} />
                    <input placeholder="type" value={row.type} onChange={(e) => patchGlossary(row.id, 'type', e.target.value)} />
                    <input placeholder="notes" value={row.notes} onChange={(e) => patchGlossary(row.id, 'notes', e.target.value)} />
                    <select value={row.status} onChange={(e) => patchGlossary(row.id, 'status', e.target.value)}><option>watch</option><option>locked</option></select>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
