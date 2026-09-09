import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'legalmetrix-api' }));

app.post('/api/inspections', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'image is required' });
  res.status(201).json({
    message: 'Image received. Connect OCR/rules pipeline here.',
    inspectionId: crypto.randomUUID(),
    filename: req.file.originalname,
    size: req.file.size,
  });
});

app.post('/api/reports', (req, res) => {
  const { product, checks = [], score = 0 } = req.body;
  res.json({
    reportId: crypto.randomUUID(),
    generatedAt: new Date().toISOString(),
    product: product || 'Unknown product',
    score,
    checks,
  });
});

app.listen(PORT, () => console.log(`LegalMetriX API running on http://localhost:${PORT}`));
