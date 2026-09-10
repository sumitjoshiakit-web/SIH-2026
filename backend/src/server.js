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
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.7-flash';

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

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'legalmetrix-scanner-api', version: '2.0.0', ai: Boolean(GEMINI_API_KEY), model: GEMINI_MODEL }));
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

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
      body: JSON.stringify({
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
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      const message = payload?.error?.message || 'Gemini OCR request failed.';
      return res.status(502).json({ error: message });
    }

    const parsed = parseJsonResponse(extractGeminiText(payload));
    const text = String(parsed.text || '').trim();
    if (!text) return res.status(502).json({ error: 'AI could not read usable text from the supplied images.' });

    res.json({
      provider: 'Google Gemini Vision',
      model: GEMINI_MODEL,
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

app.post('/api/reports', (req, res) => {
  const { product, checks = [], score = 0, extractedText = '', status = 'NEEDS_REVIEW' } = req.body;
  res.json({ reportId: crypto.randomUUID(), generatedAt: new Date().toISOString(), product: product || 'Unknown product', score, status, checks, extractedText });
});

app.listen(PORT, () => console.log(`LegalMetriX Scanner API running on port ${PORT}`));
