import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 8787);

app.use(cors());
app.use(express.json({ limit: '20mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, model: process.env.OPENAI_MODEL || 'gpt-5.5' });
});

function extractText(payload) {
  if (payload.output_text) return payload.output_text;
  const parts = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'output_text' && content.text) parts.push(content.text);
      if (content.type === 'text' && content.text) parts.push(content.text);
    }
  }
  return parts.join('\n').trim();
}

app.post('/api/translate', async (req, res) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(400).send('Missing OPENAI_API_KEY. Put it in .env and restart npm run dev.');
    }

    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) return res.status(400).send('Missing translation prompt.');

    const model = process.env.OPENAI_MODEL || req.body?.model || 'gpt-5.5';
    const upstream = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        input: prompt,
        max_output_tokens: 12000
      })
    });

    const text = await upstream.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }

    if (!upstream.ok) {
      const message = json?.error?.message || text || `OpenAI request failed with ${upstream.status}`;
      return res.status(upstream.status).send(message);
    }

    const output = extractText(json);
    if (!output) return res.status(502).send('OpenAI returned no text output.');
    res.json({ text: output, model });
  } catch (error) {
    console.error(error);
    res.status(500).send(error.message || 'Unknown server error.');
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`TigerShelf API running at http://localhost:${port}`);
});
