import 'dotenv/config';

import cors from 'cors';
import crypto from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import multer from 'multer';

import {
  evaluateCompliance,
  getRuleSummary,
} from './engine/compliance.engine.js';
import { extractLabelText } from './services/gemini.service.js';
import { extractWithPaddle, isPaddleConfigured } from './services/paddle.service.js';
import { prepareImage } from './services/image.service.js';
import { buildInspectionReport } from './services/report.service.js';
import {
  clearInspections,
  isSupabaseConfigured,
  listInspections,
  requireUser,
  saveInspection,
} from './services/supabase.service.js';

const app = express();

const PORT = process.env.PORT || 5000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024,
    files: 8,
  },
});

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    service: 'legalmetrix-scanner-api',
    version: '4.0.0',
    ai: Boolean(GEMINI_API_KEY),
    primaryOcr: GEMINI_MODEL,
    fallbackOcr: isPaddleConfigured() ? 'PaddleOCR' : null,
    rules: getRuleSummary().ruleCount,
    persistence: isSupabaseConfigured() ? 'supabase' : 'local-only',
  });
});

app.get('/api/rules', (_request, response) => {
  response.json(getRuleSummary());
});

app.post('/api/inspections', upload.array('images', 8), (request, response) => {
  if (!request.files?.length) {
    return response.status(400).json({ error: 'At least one image is required.' });
  }

  return response.status(201).json({
    inspectionId: crypto.randomUUID(),
    files: request.files.map((file) => ({
      filename: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
    })),
    message: 'Images accepted.',
  });
});

app.post('/api/ocr', upload.array('images', 8), async (request, response) => {
  if (!request.files?.length) {
    return response.status(400).json({ error: 'At least one product image is required.' });
  }

  try {
    const preparedImages = await Promise.all(
      request.files.map((file) => prepareImage(file)),
    );

    try {
      const geminiResult = await extractLabelText({
        files: preparedImages,
        apiKey: GEMINI_API_KEY,
        model: GEMINI_MODEL,
      });

      return response.json({
        ...geminiResult,
        ocrPath: 'gemini',
        photoCount: request.files.length,
      });
    } catch (geminiError) {
      console.warn('Gemini OCR failed. Starting PaddleOCR fallback.', {
        status: geminiError?.status,
        message: geminiError?.message,
      });

      if (!isPaddleConfigured()) {
        return response.status(geminiError?.status || 502).json({
          error: geminiError?.message || 'Gemini OCR failed.',
          ocrPath: 'gemini',
          fallbackAvailable: false,
        });
      }

      try {
        const paddleResult = await extractWithPaddle(
          preparedImages.map((image, index) => ({
            ...image,
            originalname: request.files[index]?.originalname,
          })),
        );

        return response.json({
          ...paddleResult,
          ocrPath: 'paddle-fallback',
          fallbackReason: geminiError?.message || 'Gemini OCR failed.',
          photoCount: request.files.length,
        });
      } catch (paddleError) {
        console.error('Both OCR providers failed.', {
          gemini: geminiError?.message,
          paddle: paddleError?.message,
        });

        return response.status(502).json({
          error: 'Both Gemini OCR and PaddleOCR fallback failed.',
          details: {
            gemini: geminiError?.message || 'Gemini OCR failed.',
            paddle: paddleError?.message || 'PaddleOCR failed.',
          },
          ocrPath: 'failed',
          fallbackAvailable: true,
        });
      }
    }
  } catch (error) {
    console.error('Image preparation failed:', error);
    return response.status(422).json({
      error: 'One or more uploaded images could not be processed.',
    });
  }
});

app.post('/api/inspections/analyze', (request, response) => {
  const {
    extractedText = '',
    productName = 'Unknown product',
    ocrConfidence = null,
    ocrProvider = '',
  } = request.body;

  if (!String(extractedText).trim()) {
    return response.status(400).json({ error: 'extractedText is required.' });
  }

  const evaluation = evaluateCompliance(extractedText);

  return response.status(200).json({
    inspectionId: crypto.randomUUID(),
    productName,
    ocrConfidence,
    ocrProvider,
    generatedAt: new Date().toISOString(),
    ...evaluation,
    disclaimer:
      'Screening aid only. OCR/text screening cannot establish every visual, measurement, applicability, commodity-specific or amendment-specific requirement. Findings must be verified against the current applicable Legal Metrology rules and amendments before enforcement action.',
  });
});

app.post('/api/inspections/persist', async (request, response) => {
  try {
    if (!isSupabaseConfigured()) {
      return response.status(503).json({ error: 'Cloud history is not configured.' });
    }

    const user = await requireUser(request);
    const saved = await saveInspection(user.id, request.body);

    return response.status(201).json({ inspection: saved });
  } catch (error) {
    return response.status(error?.status || 500).json({
      error: error?.message || 'Could not save inspection.',
    });
  }
});

app.get('/api/history', async (request, response) => {
  try {
    if (!isSupabaseConfigured()) {
      return response.status(503).json({ error: 'Cloud history is not configured.' });
    }

    const user = await requireUser(request);
    const history = await listInspections(user.id, request.query.limit);

    return response.json({ history });
  } catch (error) {
    return response.status(error?.status || 500).json({
      error: error?.message || 'Could not load inspection history.',
    });
  }
});

app.delete('/api/history', async (request, response) => {
  try {
    if (!isSupabaseConfigured()) {
      return response.status(503).json({ error: 'Cloud history is not configured.' });
    }

    const user = await requireUser(request);
    await clearInspections(user.id);

    return response.status(204).send();
  } catch (error) {
    return response.status(error?.status || 500).json({
      error: error?.message || 'Could not clear inspection history.',
    });
  }
});

app.post('/api/reports', (request, response) => {
  const {
    product,
    checks = [],
    score = 0,
    extractedText = '',
    status = 'NEEDS_REVIEW',
    ocrProvider = '',
    confidence = 0,
  } = request.body || {};

  const reportId = crypto.randomUUID();
  const generatedAt = new Date().toISOString();

  if (request.body?.format !== 'html') {
    return response.json({
      reportId,
      generatedAt,
      product: product || 'Unknown product',
      score,
      status,
      checks,
      extractedText,
    });
  }

  const html = buildInspectionReport({
    reportId,
    generatedAt,
    product,
    checks,
    score,
    extractedText,
    status,
    ocrProvider,
    confidence,
  });

  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader(
    'Content-Disposition',
    `attachment; filename="legalmetrix-report-${reportId}.html"`,
  );

  return response.status(200).send(html);
});

app.use((error, _request, response, _next) => {
  console.error('Unhandled server error:', error);

  if (error?.code === 'LIMIT_FILE_SIZE') {
    return response.status(413).json({ error: 'Each image must be 8 MB or smaller.' });
  }

  if (error?.code === 'LIMIT_FILE_COUNT') {
    return response.status(413).json({ error: 'A maximum of 8 images can be uploaded.' });
  }

  return response.status(500).json({ error: 'Internal server error.' });
});

app.listen(PORT, () => {
  console.log(`LegalMetriX Scanner API running on port ${PORT}`);
});
