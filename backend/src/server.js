import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import crypto from 'node:crypto';

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 8 },
});
const PORT = process.env.PORT || 5000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_FALLBACK_MODELS = ['gemini-2.5-flash-lite', 'gemini-2.0-flash'];

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const RULES = [
  { id: 'LM-01', key: 'manufacturer', title: 'Manufacturer / packer / importer details', pattern: /(manufactur|manufactured|marketed|packed\s*by|packer|importer)/i, weight: 15 },
  { id: 'LM-02', key: 'origin', title: 'Country of origin (where applicable)', pattern: /(country\s+of\s+origin|made\s+in|product\s+of|origin\s*[:\-])/i, weight: 10 },
  { id: 'LM-03', key: 'commodity', title: 'Common / generic commodity name', pattern: /(product|commodity|contents|ingredients|material|powder|spices?)/i, weight: 10 },
  { id: 'LM-04', key: 'quantity', title: 'Net quantity', pattern: /(net\s*(qty|quantity|weight|wt|vol)|net\s*wt\.?|\b\d+(?:\.\d+)?\s?(kg|g|mg|l|ml)\b)/i, weight: 15 },
  { id: 'LM-05', key: 'date', title: 'Month / year of manufacture or packing', pattern: /(mfg|manufactur(ed|e)?|packed|pkd|use\s*by|best\s*before|\bdate\b|\b\d{1,2}[/-]\d{4}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)['’\s-]*\d{4}\b)/i, weight: 10 },
  { id: 'LM-06', key: 'mrp', title: 'MRP inclusive of all taxes', pattern: /(m\.?r\.?p|maximum\s+retail\s+price|retail\s+sale\s+price)/i, weight: 20 },
  { id: 'LM-07', key: 'consumerCare', title: 'Consumer care details', pattern: /(consumer\s+care|customer\s+care|helpline|toll[- ]free|contact\s+us|e[- ]?mail|email|phone|mobile)/i, weight: 10 },
];

function evaluateText(text = '') {
  const normalized = String(text).replace(/\s+/g, ' ').trim();
  const checks = RULES.map(rule => {
    const match = normalized.match(rule.pattern);
    return {
      ruleId: rule.id,
      key: rule.key,
      title: rule.title,
      status: match ? 'PASS' : 'REVIEW',
      evidence: match ? match[0] : null,
      message: match ? 'Declaration pattern detected.' : 'Declaration was not confidently detected; manual verification required.',
      weight: rule.weight,
    };
  });
  const score = checks.reduce((sum, item) => sum + (item.status === 'PASS' ? item.weight : 0), 0);
  const status = score >= 85 ? 'LIKELY_COMPLIANT' : score >= 60 ? 'NEEDS_REVIEW' : 'POTENTIAL_NON_COMPLIANCE';
  return { score, status, checks };
}

function extractGeminiText(payload) {
  return (payload?.candidates || [])
    .flatMap(candidate => candidate?.content?.parts || [])
    .map(part => part?.text || '')
    .join('\n')
    .trim();
}

function parseJsonResponse(text) {
  try { return JSON.parse(text); } catch (_) {}
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI returned an invalid OCR response.');
  return JSON.parse(match[0]);
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function isRetryableStatus(status) {
  return [408, 429, 500, 502, 503, 504].includes(status);
}

async function callGemini(model, parts) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          productName: { type: 'string' },
          text: { type: 'string' },
          confidence: { type: 'integer' },
          fields: {
            type: 'object',
            properties: {
              manufacturer: { type: 'string' }, origin: { type: 'string' }, commodity: { type: 'string' },
              quantity: { type: 'string' }, date: { type: 'string' }, mrp: { type: 'string' }, consumerCare: { type: 'string' },
            },
          },
          notes: { type: 'array', items: { type: 'string' } },
        },
        required: ['productName', 'text', 'confidence', 'fields', 'notes'],
      },
    },
  };

  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45000);
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const payload = await response.json().catch(() => ({}));
      if (response.ok) return { payload, model };

      const message = payload?.error?.message || `Gemini request failed with HTTP ${response.status}.`;
      lastError = Object.assign(new Error(message), { status: response.status });
      if (!isRetryableStatus(response.status)) break;
    } catch (error) {
      lastError = error;
    }

    if (attempt < 3) await sleep(800 * (2 ** (attempt - 1)));
  }
  throw lastError || new Error(`Gemini OCR failed for ${model}.`);
}

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'legalmetrix-scanner-api', version: '2.1.0', ai: Boolean(GEMINI_API_KEY), model: GEMINI_MODEL }));
app.get('/api/rules', (_req, res) => res.json({ framework: 'Legal Metrology Packaged Commodities screening', rules: RULES.map(({ pattern, ...rule }) => rule) }));

app.post('/api/inspections', upload.array('images', 8), (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'At least one image is required' });
  const inspectionId = crypto.randomUUID();
  res.status(201).json({ inspectionId, files: req.files.map(file => ({ filename: file.originalname, mimeType: file.mimetype, size: file.size })), message: 'Images accepted.' });
});

app.post('/api/ocr', upload.array('images', 8), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'At least one product image is required' });
  if (!GEMINI_API_KEY) return res.status(503).json({ error: 'GEMINI_API_KEY is not configured on the backend.' });

  try {
    const parts = [{ text: `You are the OCR engine for LegalMetriX Scanner. Inspect all supplied product-package images together. Transcribe ONLY text that is actually visible; do not guess, infer, or invent missing declarations. Preserve English and Hindi text where visible. Combine information across different sides of the same package and remove exact duplicate lines.

Return JSON with this exact shape:
{
  "productName": "string",
  "text": "all visible label text, organized by side/photo",
  "confidence": 0,
  "fields": {
    "manufacturer": "string or empty",
    "origin": "string or empty",
    "commodity": "string or empty",
    "quantity": "string or empty",
    "date": "string or empty",
    "mrp": "string or empty",
    "consumerCare": "string or empty"
  },
  "notes": ["string"]
}

Confidence must be an integer from 0 to 100 and should reflect legibility of the visible text, not legal compliance. If a field is not visible, leave it empty.` }];

    for (const [index, file] of req.files.entries()) {
      parts.push({ text: `PHOTO ${index + 1} (${file.originalname})` });
      parts.push({ inline_data: { mime_type: file.mimetype, data: file.buffer.toString('base64') } });
    }

    const models = [...new Set([GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS])];
    let result = null;
    let lastError = null;

    for (const model of models) {
      try {
        result = await callGemini(model, parts);
        if (model !== GEMINI_MODEL) console.warn(`Gemini OCR fallback succeeded with ${model}`);
        break;
      } catch (error) {
        lastError = error;
        console.warn(`Gemini OCR failed on ${model}: ${error?.message || error}`);
      }
    }

    if (!result) {
      const status = lastError?.status || 503;
      return res.status(status >= 400 && status < 600 ? 502 : 503).json({ error: lastError?.message || 'All Gemini OCR models failed after retries.' });
    }

    const parsed = parseJsonResponse(extractGeminiText(result.payload));
    const text = String(parsed.text || '').trim();
    if (!text) return res.status(502).json({ error: 'AI could not read usable text from the supplied images.' });

    res.json({
      provider: 'Google Gemini Vision',
      model: result.model,
      productName: parsed.productName || 'Unknown product',
      extractedText: text,
      confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 0)),
      fields: parsed.fields || {},
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      photoCount: req.files.length,
    });
  } catch (error) {
    console.error('AI OCR error:', error);
    res.status(502).json({ error: error?.message || 'AI OCR failed.' });
  }
});

app.post('/api/inspections/analyze', (req, res) => {
  const { extractedText = '', productName = 'Unknown product', ocrConfidence = null } = req.body;
  if (!String(extractedText).trim()) return res.status(400).json({ error: 'extractedText is required' });
  const evaluation = evaluateText(extractedText);
  res.status(200).json({ inspectionId: crypto.randomUUID(), productName, ocrConfidence, generatedAt: new Date().toISOString(), ...evaluation, disclaimer: 'Screening aid only. Findings must be verified against the current applicable Legal Metrology rules and amendments before enforcement action.' });
});

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>\"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '\"':'&quot;', "'":'&#39;' }[c]));
}

app.post('/api/reports', (req, res) => {
  const { product, checks = [], score = 0, extractedText = '', status = 'NEEDS_REVIEW', ocrProvider = '', confidence = 0 } = req.body || {};
  const reportId = crypto.randomUUID();
  const generatedAt = new Date().toISOString();

  if (req.body?.format === 'html') {
    const rows = (Array.isArray(checks) ? checks : []).map(check => `<tr><td>${escapeHtml(check.title || check.label)}</td><td>${escapeHtml(check.status || 'REVIEW')}</td><td>${escapeHtml(check.evidence || 'Not confidently detected')}</td></tr>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LegalMetriX Inspection Report</title><style>body{font-family:Arial,sans-serif;max-width:900px;margin:0 auto;padding:32px 20px;color:#172033}h1{margin-bottom:4px}.meta{line-height:1.7}.score{font-size:42px;font-weight:700;margin:20px 0 4px}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{border:1px solid #d9dee8;padding:10px;text-align:left;vertical-align:top}th{background:#f5f7fb}pre{white-space:pre-wrap;background:#f5f7fb;padding:16px;border-radius:10px}.notice{margin-top:24px;font-size:12px;color:#5c6575}</style></head><body><h1>LegalMetriX Scanner</h1><p>Inspection screening report</p><p class="score">${escapeHtml(score)}/100</p><div class="meta"><b>Product:</b> ${escapeHtml(product || 'Unknown product')}<br><b>Status:</b> ${escapeHtml(status)}<br><b>OCR:</b> ${escapeHtml(ocrProvider || 'OCR')} (${escapeHtml(confidence)}%)<br><b>Report ID:</b> ${escapeHtml(reportId)}<br><b>Generated:</b> ${escapeHtml(new Date(generatedAt).toLocaleString())}</div><h2>Declaration checks</h2><table><thead><tr><th>Requirement</th><th>Status</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table><h2>Extracted label text</h2><pre>${escapeHtml(extractedText)}</pre><p class="notice">Screening aid only. Findings must be verified against the current applicable Legal Metrology rules and amendments before enforcement action.</p></body></html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="legalmetrix-report-${reportId}.html"`);
    return res.status(200).send(html);
  }

  return res.json({ reportId, generatedAt, product: product || 'Unknown product', score, status, checks, extractedText });
});

app.listen(PORT, () => console.log(`LegalMetriX Scanner API running on port ${PORT}`));
