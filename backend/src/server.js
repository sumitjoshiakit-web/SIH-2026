import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import crypto from 'node:crypto';

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

const RULES = [
  { id: 'LM-01', key: 'manufacturer', title: 'Manufacturer / packer / importer details', pattern: /(manufactur|manufactured|marketed|packed by|packer|importer)/i, weight: 15 },
  { id: 'LM-02', key: 'origin', title: 'Country of origin (where applicable)', pattern: /(country of origin|made in|product of)/i, weight: 10 },
  { id: 'LM-03', key: 'commodity', title: 'Common / generic commodity name', pattern: /(product|commodity|contents|ingredients|material)/i, weight: 10 },
  { id: 'LM-04', key: 'quantity', title: 'Net quantity', pattern: /(net\s*(qty|quantity|weight|wt|vol)|\b\d+(?:\.\d+)?\s?(kg|g|mg|l|ml)\b)/i, weight: 15 },
  { id: 'LM-05', key: 'date', title: 'Month / year of manufacture or packing', pattern: /(mfg|manufactur(ed|e)?|packed|pkd|\bdate\b|\b\d{1,2}[/-]\d{4}\b)/i, weight: 10 },
  { id: 'LM-06', key: 'mrp', title: 'MRP inclusive of all taxes', pattern: /(m\.?r\.?p|maximum retail price|retail sale price)/i, weight: 20 },
  { id: 'LM-07', key: 'consumerCare', title: 'Consumer care details', pattern: /(consumer care|customer care|helpline|toll[- ]free|contact us|email)/i, weight: 10 },
];

function evaluateText(text = '') {
  const normalized = text.replace(/\s+/g, ' ').trim();
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

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'legalmetrix-scanner-api', version: '1.0.0' }));
app.get('/api/rules', (_req, res) => res.json({ framework: 'Legal Metrology Packaged Commodities screening', rules: RULES.map(({ pattern, ...rule }) => rule) }));

app.post('/api/inspections', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'image is required' });
  const inspectionId = crypto.randomUUID();
  res.status(201).json({ inspectionId, filename: req.file.originalname, mimeType: req.file.mimetype, size: req.file.size, message: 'Image accepted. Client OCR can submit extractedText to /api/inspections/analyze.' });
});

app.post('/api/inspections/analyze', (req, res) => {
  const { extractedText = '', productName = 'Unknown product', ocrConfidence = null } = req.body;
  if (!extractedText.trim()) return res.status(400).json({ error: 'extractedText is required' });
  const evaluation = evaluateText(extractedText);
  res.status(200).json({ inspectionId: crypto.randomUUID(), productName, ocrConfidence, generatedAt: new Date().toISOString(), ...evaluation, disclaimer: 'Screening aid only. Findings must be verified against the current applicable Legal Metrology rules and amendments before enforcement action.' });
});

app.post('/api/reports', (req, res) => {
  const { product, checks = [], score = 0, extractedText = '', status = 'NEEDS_REVIEW' } = req.body;
  res.json({ reportId: crypto.randomUUID(), generatedAt: new Date().toISOString(), product: product || 'Unknown product', score, status, checks, extractedText });
});

app.listen(PORT, () => console.log(`LegalMetriX Scanner API running on port ${PORT}`));
