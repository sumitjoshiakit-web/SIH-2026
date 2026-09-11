import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import crypto from 'node:crypto';
import sharp from 'sharp';

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 8 } });
const PORT = process.env.PORT || 5000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.7-flash';
const GEMINI_FALLBACK_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash'];
const GEMINI_MAX_INLINE_BYTES = 19 * 1024 * 1024;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const RULES = [
  { id: 'LM-01', key: 'manufacturerIdentity', title: 'Manufacturer / packer / importer name', legalBasis: 'Rule 6(1)(a), Rule 10', pattern: /(manufactur(?:er|ed|ing)?|manufactured\s+by|packed\s+by|packer|importer|निर्माता|निर्मित|पैक(?:र|िंग)?|आयातक)/i, weight: 8 },
  { id: 'LM-02', key: 'completeAddress', title: 'Complete manufacturer / packer / importer address', legalBasis: 'Rule 10(1)', pattern: /((address|addr\.?|पता)\s*[:\-]?|\b\d{6}\b|pin\s*(code)?|pincode|\b(?:uttarakhand|delhi|mumbai|india|ind|up|uttar\s*pradesh)\b)/i, weight: 7 },
  { id: 'LM-03', key: 'actualBusinessName', title: 'Actual corporate / business name identifiable', legalBasis: 'Rule 10(2)', pattern: /(manufactured\s+by|packed\s+by|marketed\s+by|imported\s+by|निर्माता|पैक|आयातक|manufactur|packer|importer)/i, weight: 4 },
  { id: 'LM-04', key: 'origin', title: 'Country of origin (where applicable)', legalBasis: 'Rule 6 / imported packages', pattern: /(country\s+of\s+origin|made\s+in|product\s+of|origin\s*[:\-]|country\s*[:\-]|निर्मित\s*स्थान|उत्पत्ति|देश\s*का\s*मूल)/i, weight: 5 },
  { id: 'LM-05', key: 'commodity', title: 'Common / generic name of commodity', legalBasis: 'Rule 6(1)(b)', pattern: /(product|commodity|contents|material|powder|spices?|rice|flour|soap|detergent|shampoo|oil|sugar|salt|tea|coffee|biscuits?|उत्पाद|सामग्री|वस्तु|मसाला|चावल|आटा|साबुन|तेल|चीनी|नमक)/i, weight: 8 },
  { id: 'LM-06', key: 'multiProductDetails', title: 'Name + number/quantity of each product where package has multiple products', legalBasis: 'Rule 6(1)(b)', pattern: /(combo|pack\s+of|set\s+of|pieces?|pcs|units?|pair|each|x\s*\d+|\b\d+\s*(?:pcs|pieces|units?|items?)\b|कॉम्बो|पीस|नग)/i, weight: 4, conditional: true },
  { id: 'LM-07', key: 'quantity', title: 'Net quantity in standard unit / number', legalBasis: 'Rule 6(1)(c), Rules 11–13', pattern: /(net\s*(qty|quantity|weight|wt|vol)|net\s*wt\.?|शुद्ध\s*(मात्रा|वजन)|\b\d+(?:\.\d+)?\s?(?:kg|g|mg|l|ml|m|cm|mm|sq\.?\s?m|cm2|m2|pcs|pieces|units?|unit|n|u)\b)/i, weight: 10 },
  { id: 'LM-08', key: 'manufactureDate', title: 'Month and year of manufacture / packing / applicable date declaration', legalBasis: 'Rule 6(1)(d) and amendments', pattern: /(mfg|mfd|manufactur(?:ed|e)?|packed|pkd|date\s*(of)?\s*(mfg|manufacture|packing)|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)['’\s\/-]*\d{2,4}\b|\b(?:0?[1-9]|1[0-2])['’\s\/-]*\d{4}\b|निर्माण|पैकिंग|निर्मित|तिथि)/i, weight: 8 },
  { id: 'LM-09', key: 'bestBefore', title: 'Best before / use by date where commodity may become unfit for human consumption', legalBasis: 'Rule 6(1)(da) / applicable commodity', pattern: /(best\s*before|use\s*by|expiry|exp\.?\s*date|use\s*before|उपयोग\s*करें|समाप्ति|बेस्ट\s*बिफोर)/i, weight: 5, conditional: true },
  { id: 'LM-10', key: 'mrp', title: 'Maximum Retail Price (MRP) / retail sale price', legalBasis: 'Rule 6(1)(e)', pattern: /(m\.?r\.?p|maximum\s*(retail|retail\s+sale)\s*price|retail\s*sale\s*price|अधिकतम\s*खुदरा\s*मूल्य|खुदरा\s*मूल्य)/i, weight: 10 },
  { id: 'LM-11', key: 'mrpInclusiveTaxes', title: 'MRP stated inclusive of all taxes', legalBasis: 'Rule 2(m), Rule 6(1)(e)', pattern: /(m\.?r\.?p|maximum\s*retail\s*price)[^\n]{0,80}(incl\.?|inclusive)\s*(of\s*)?(all\s*)?tax(?:es)?|incl\.?\s*of\s*all\s*tax(?:es)?|सभी\s*कर|करों\s*सहित/i, weight: 6 },
  { id: 'LM-12', key: 'unitSalePrice', title: 'Unit sale price in prescribed unit where applicable', legalBasis: 'Rule 6(11), amendments effective from 2022/2024', pattern: /(unit\s*sale\s*price|unit\s*price|per\s*(g|gram|kg|kilogram|ml|millilitre|litre|l|cm|centimetre|m|metre|number|unit)|प्रति\s*(ग्राम|किलोग्राम|मिलीलीटर|लीटर|इकाई|नग|संख्या))/i, weight: 7, conditional: true },
  { id: 'LM-13', key: 'consumerCare', title: 'Consumer care contact: name/address/phone/email', legalBasis: 'Rule 6(2)', pattern: /(consumer\s+care|customer\s+care|consumer\s+complaint|helpline|toll[- ]?free|contact\s+us|e[- ]?mail|email|phone|mobile|care@|उपभोक्ता\s*देखभाल|हेल्पलाइन|संपर्क|ईमेल|मोबाइल|फोन)/i, weight: 8 },
  { id: 'LM-14', key: 'dimensions', title: 'Dimensions where dimensions are relevant', legalBasis: 'Rule 6(1)(f), Rules 14–17', pattern: /(dimension|dimensions|size\s*[:x×]|length|width|height|depth|diameter|लंबाई|चौड़ाई|ऊंचाई|गहराई|आकार|आयाम|\b\d+(?:\.\d+)?\s*[x×]\s*\d+)/i, weight: 4, conditional: true },
  { id: 'LM-15', key: 'quantityUnits', title: 'Quantity uses an appropriate standard unit / number', legalBasis: 'Rules 12–13', pattern: /\b\d+(?:\.\d+)?\s?(?:g|kg|mg|ml|l|m|cm|mm|m2|cm2|sq\.?\s?m|litre|liter|gram|kilogram|metre|meter|centimetre|centimeter|N|U|pcs|pieces|units?)\b/i, weight: 5 },
  { id: 'LM-16', key: 'quantityMisleadingWords', title: 'No misleading quantity wording detected', legalBasis: 'Rule 12(6)', pattern: /\b(?:minimum|not\s+less\s+than|average|about|approximately|approx\.?|कम\s*से\s*कम|लगभग|औसत|न्यूनतम)\b/i, weight: 5, negative: true },
  { id: 'LM-17', key: 'language', title: 'Mandatory declarations in Hindi (Devanagari) or English', legalBasis: 'Rule 9(4)', pattern: /[A-Za-z]{2,}|[\u0900-\u097F]{2,}/, weight: 3 },
  { id: 'LM-18', key: 'visualManner', title: 'Legible, prominent and prescribed presentation', legalBasis: 'Rules 7–9', visualOnly: true },
  { id: 'LM-19', key: 'principalDisplayPanel', title: 'Required declarations appear on principal display panel', legalBasis: 'Rule 8', visualOnly: true },
  { id: 'LM-20', key: 'contrast', title: 'MRP and net quantity numerals contrast with background', legalBasis: 'Rule 9(1)(b)', visualOnly: true },
  { id: 'LM-21', key: 'quantitySpacing', title: 'Required clear space around quantity declaration', legalBasis: 'Rule 8(1)', visualOnly: true },
  { id: 'LM-22', key: 'outerWrapper', title: 'Outer wrapper/container carries required declarations where applicable', legalBasis: 'Rule 9(3)', visualOnly: true },
];

function evaluateText(text = '') {
  const normalized = String(text).replace(/\s+/g, ' ').trim();
  const checks = RULES.map(rule => {
    if (rule.visualOnly) return { ruleId: rule.id, key: rule.key, title: rule.title, legalBasis: rule.legalBasis, status: 'REVIEW', evidence: null, message: 'Image/layout verification required; OCR alone cannot prove this requirement.', weight: 0, visualOnly: true };
    const match = normalized.match(rule.pattern);
    if (rule.negative) {
      const pass = !match;
      return { ruleId: rule.id, key: rule.key, title: rule.title, legalBasis: rule.legalBasis, status: pass ? 'PASS' : 'FAIL', evidence: match ? match[0] : null, message: pass ? 'No misleading quantity wording detected in OCR.' : 'Potentially misleading quantity wording detected; manual verification required.', weight: rule.weight, conditional: Boolean(rule.conditional) };
    }
    const status = match ? 'PASS' : 'REVIEW';
    return { ruleId: rule.id, key: rule.key, title: rule.title, legalBasis: rule.legalBasis, status, evidence: match ? match[0] : null, message: match ? 'Required declaration/pattern detected in OCR.' : rule.conditional ? 'Conditional requirement not confidently detected; determine applicability and verify manually.' : 'Declaration was not confidently detected; manual verification required.', weight: rule.weight, conditional: Boolean(rule.conditional) };
  });
  const scoreChecks = checks.filter(item => !item.visualOnly && !item.conditional);
  const totalWeight = scoreChecks.reduce((sum, item) => sum + item.weight, 0);
  const earnedWeight = scoreChecks.reduce((sum, item) => sum + (item.status === 'PASS' ? item.weight : 0), 0);
  const score = totalWeight ? Math.round((earnedWeight / totalWeight) * 100) : 0;
  const hardFailures = checks.filter(item => item.status === 'FAIL');
  const visualReviewRequired = checks.some(item => item.visualOnly);
  const conditionalReviewRequired = checks.some(item => item.conditional && item.status !== 'PASS');
  const status = hardFailures.length || score < 50 ? 'POTENTIAL_NON_COMPLIANCE' : score >= 85 && !conditionalReviewRequired ? 'LIKELY_COMPLIANT' : 'NEEDS_REVIEW';
  return { score, status, checks, visualReviewRequired, conditionalReviewRequired };
}

function extractGeminiText(payload) {
  return (payload?.candidates || []).flatMap(candidate => candidate?.content?.parts || []).map(part => part?.text || '').join('\n').trim();
}
function parseJsonResponse(text) {
  try { return JSON.parse(text); } catch (_) {}
  const match = String(text).match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI returned an invalid OCR response.');
  return JSON.parse(match[0]);
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function isRetryableStatus(status) { return [408, 429, 500, 502, 503, 504].includes(status); }

async function callGemini(model, parts) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0,
      maxOutputTokens: 8192,
      responseSchema: {
        type: 'object', additionalProperties: false,
        properties: {
          productName: { type: 'string' }, text: { type: 'string' }, confidence: { type: 'integer' },
          fields: { type: 'object', additionalProperties: false, properties: {
            manufacturer: { type: 'string' }, origin: { type: 'string' }, commodity: { type: 'string' }, quantity: { type: 'string' }, date: { type: 'string' }, mrp: { type: 'string' }, consumerCare: { type: 'string' },
          }, required: ['manufacturer', 'origin', 'commodity', 'quantity', 'date', 'mrp', 'consumerCare'] },
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
      const timeout = setTimeout(() => controller.abort(), 60000);
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY }, body: JSON.stringify(body), signal: controller.signal });
      clearTimeout(timeout);
      const payload = await response.json().catch(() => ({}));
      if (response.ok) return { payload, model };
      const message = payload?.error?.message || `Gemini request failed with HTTP ${response.status}.`;
      lastError = Object.assign(new Error(message), { status: response.status });
      if (!isRetryableStatus(response.status)) break;
    } catch (error) { lastError = error; }
    if (attempt < 3) await sleep(800 * (2 ** (attempt - 1)));
  }
  throw lastError || new Error(`Gemini OCR failed for ${model}.`);
}

async function prepareImage(file) {
  let output = await sharp(file.buffer, { failOn: 'none' }).rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: false }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  if (output.length > 3.2 * 1024 * 1024) output = await sharp(file.buffer, { failOn: 'none' }).rotate().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: false }).jpeg({ quality: 78, mozjpeg: true }).toBuffer();
  return { mimeType: 'image/jpeg', buffer: output };
}

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'legalmetrix-scanner-api', version: '2.4.0', ai: Boolean(GEMINI_API_KEY), model: GEMINI_MODEL, rules: RULES.length }));
app.get('/api/rules', (_req, res) => res.json({ framework: 'Legal Metrology (Packaged Commodities) Rules, 2011 screening map', ruleCount: RULES.length, rules: RULES.map(({ pattern, ...rule }) => rule) }));
app.post('/api/inspections', upload.array('images', 8), (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'At least one image is required' });
  const inspectionId = crypto.randomUUID();
  res.status(201).json({ inspectionId, files: req.files.map(file => ({ filename: file.originalname, mimeType: file.mimetype, size: file.size })), message: 'Images accepted.' });
});

app.post('/api/ocr', upload.array('images', 8), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'At least one product image is required' });
  if (!GEMINI_API_KEY) return res.status(503).json({ error: 'GEMINI_API_KEY is not configured on the backend.' });
  try {
    const prepared = [];
    for (const file of req.files) prepared.push(await prepareImage(file));
    const totalBytes = prepared.reduce((sum, item) => sum + item.buffer.length, 0);
    if (totalBytes > GEMINI_MAX_INLINE_BYTES) return res.status(413).json({ error: 'The selected photos are still too large for Gemini. Please use fewer photos or lower-resolution images.' });

    const parts = [{ text: `You are the high-accuracy OCR engine for LegalMetriX Scanner. Read the supplied packaged-product label photos as a document, not as a general image caption.

OBJECTIVE: recover every actually visible character useful for Legal Metrology screening. Inspect each photo carefully and combine different sides of the same package.

STRICT ACCURACY RULES:
1. Transcribe only text visibly present. NEVER invent, autocomplete, infer, or correct a value because it seems likely.
2. Preserve exact spelling, punctuation, decimal points, rupee symbols, registration numbers, dates, batch codes, phone numbers, email addresses, MRP, quantities and units.
3. Preserve English and Devanagari/Hindi text. Do not translate.
4. Pay special attention to tiny text: MRP, Net Quantity, Mfg/Pkd, Best Before/Use By, manufacturer/packer/importer, address/PIN, FSSAI/licence numbers, consumer-care contacts, country of origin and unit sale price.
5. If a character is genuinely unreadable, use [unclear] rather than guessing.
6. Treat photos as different views of one package. Remove exact duplicate lines only after preserving the clearest version.
7. Do NOT decide compliance or legal status. OCR only.
8. Confidence is text-legibility confidence from 0-100, not a compliance score.

Return ONLY JSON matching the supplied schema. Put the full useful transcription in `text`, grouped as PHOTO 1, PHOTO 2, etc. Fields must contain the best exact visible value or an empty string.` }];
    prepared.forEach((image, index) => { parts.push({ text: `PHOTO ${index + 1}` }); parts.push({ inline_data: { mime_type: image.mimeType, data: image.buffer.toString('base64') } }); });

    const models = [...new Set([GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS])];
    let result = null; let lastError = null;
    for (const model of models) {
      try { result = await callGemini(model, parts); break; }
      catch (error) { lastError = error; console.warn(`Gemini OCR failed on ${model}: ${error?.message || error}`); }
    }
    if (!result) {
      const safeMessage = lastError?.message || 'All Gemini OCR models failed after retries.';
      console.error('Gemini OCR final failure:', { status: lastError?.status, message: safeMessage });
      return res.status(502).json({ error: `Gemini OCR failed: ${safeMessage}` });
    }
    const parsed = parseJsonResponse(extractGeminiText(result.payload));
    const text = String(parsed.text || '').trim();
    if (!text) return res.status(502).json({ error: 'Gemini responded successfully but returned no readable label text.' });
    res.json({ provider: 'Google Gemini Vision OCR', model: result.model, productName: parsed.productName || 'Unknown product', extractedText: text, confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 0)), fields: parsed.fields || {}, notes: Array.isArray(parsed.notes) ? parsed.notes : [], photoCount: req.files.length });
  } catch (error) {
    console.error('AI OCR error:', error);
    if (error?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Each image must be 8 MB or smaller.' });
    res.status(502).json({ error: error?.message || 'AI OCR failed.' });
  }
});

app.post('/api/inspections/analyze', (req, res) => {
  const { extractedText = '', productName = 'Unknown product', ocrConfidence = null } = req.body;
  if (!String(extractedText).trim()) return res.status(400).json({ error: 'extractedText is required' });
  const evaluation = evaluateText(extractedText);
  res.status(200).json({ inspectionId: crypto.randomUUID(), productName, ocrConfidence, generatedAt: new Date().toISOString(), ...evaluation, disclaimer: 'Screening aid only. OCR/text screening cannot establish every visual, measurement, applicability, commodity-specific or amendment-specific requirement. Findings must be verified against the current applicable Legal Metrology rules and amendments before enforcement action.' });
});

function escapeHtml(value) { return String(value ?? '').replace(/[&<>\"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '\"':'&quot;', "'":'&#39;' }[c])); }
app.post('/api/reports', (req, res) => {
  const { product, checks = [], score = 0, extractedText = '', status = 'NEEDS_REVIEW', ocrProvider = '', confidence = 0 } = req.body || {};
  const reportId = crypto.randomUUID(); const generatedAt = new Date().toISOString();
  if (req.body?.format === 'html') {
    const rows = (Array.isArray(checks) ? checks : []).map(check => `<tr><td>${escapeHtml(check.ruleId || '')}</td><td>${escapeHtml(check.title || check.label)}</td><td>${escapeHtml(check.legalBasis || '')}</td><td>${escapeHtml(check.status || 'REVIEW')}</td><td>${escapeHtml(check.evidence || 'Not confidently detected')}</td></tr>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LegalMetriX Inspection Report</title><style>body{font-family:Arial,sans-serif;max-width:1100px;margin:0 auto;padding:32px 20px;color:#172033}h1{margin-bottom:4px}.meta{line-height:1.7}.score{font-size:42px;font-weight:700;margin:20px 0 4px}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{border:1px solid #d9dee8;padding:10px;text-align:left;vertical-align:top}th{background:#f5f7fb}pre{white-space:pre-wrap;background:#f5f7fb;padding:16px;border-radius:10px}.notice{margin-top:24px;font-size:12px;color:#5c6575}</style></head><body><h1>LegalMetriX Scanner</h1><p>Legal Metrology declaration screening report</p><p class="score">${escapeHtml(score)}/100</p><div class="meta"><b>Product:</b> ${escapeHtml(product || 'Unknown product')}<br><b>Status:</b> ${escapeHtml(status)}<br><b>OCR:</b> ${escapeHtml(ocrProvider || 'OCR')} (${escapeHtml(confidence)}%)<br><b>Report ID:</b> ${escapeHtml(reportId)}<br><b>Generated:</b> ${escapeHtml(new Date(generatedAt).toLocaleString())}</div><h2>Rule-by-rule checks</h2><table><thead><tr><th>Rule</th><th>Requirement</th><th>Legal basis</th><th>Status</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table><h2>Extracted label text</h2><pre>${escapeHtml(extractedText)}</pre><p class="notice">Screening aid only. A photograph/OCR scan cannot by itself prove actual quantity, font size, colour contrast, placement, applicability, commodity-specific exemptions or all current amendments. Findings must be verified against the current applicable Legal Metrology requirements before enforcement action.</p></body></html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="legalmetrix-report-${reportId}.html"`); return res.status(200).send(html);
  }
  return res.json({ reportId, generatedAt, product: product || 'Unknown product', score, status, checks, extractedText });
});
app.listen(PORT, () => console.log(`LegalMetriX Scanner API running on port ${PORT}`));
