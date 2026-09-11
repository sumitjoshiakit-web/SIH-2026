const DEFAULT_MODEL = 'gemini-3.8-flash';
const FALLBACK_MODELS = [
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
];

const MAX_INLINE_IMAGE_BYTES = 19 * 1024 * 1024;
const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];

const OCR_INSTRUCTIONS = `You are the high-accuracy OCR engine for LegalMetriX Scanner. Read the supplied packaged-product label photos as a document, not as a general image caption.

OBJECTIVE: recover every actually visible character useful for Legal Metrology screening. Inspect each photo carefully and combine different sides of the same package.

STRICT ACCURACY RULES:
1. Transcribe only text visibly present. NEVER invent, autocomplete, infer, or correct a value because it seems likely.
2. Preserve exact spelling, punctuation, decimal points, rupee symbols, registration numbers, dates, batch codes, phone numbers, email addresses, MRP, quantities and units.
3. Preserve English and Devanagari/Hindi text. Do not translate.
4. Pay special attention to tiny text: MRP, Net Quantity, Mfg/Pkd, Best Before/Use By, manufacturer/packer/importer, address/PIN, FSSAI/licence numbers, consumer-care contacts, country of origin and unit sale price.
5. If a character is genuinely unreadable, use [unclear] rather than guessing.
6. Treat photos as different views of the same package. Remove exact duplicate lines only after preserving the clearest version.
7. Do NOT decide compliance or legal status. OCR only.
8. Confidence is text-legibility confidence from 0-100, not a compliance score.

Return ONLY JSON matching the supplied schema. Put the full useful transcription in text, grouped as PHOTO 1, PHOTO 2, etc. Fields must contain the best exact visible value or an empty string.`;

function buildResponseSchema() {
  // Keep this schema compatible with the Gemini REST generateContent API.
  // Do not use JSON Schema keywords that this endpoint/model may reject.
  return {
    type: 'object',
    properties: {
      productName: { type: 'string' },
      text: { type: 'string' },
      confidence: { type: 'integer' },
      fields: {
        type: 'object',
        properties: {
          manufacturer: { type: 'string' },
          origin: { type: 'string' },
          commodity: { type: 'string' },
          quantity: { type: 'string' },
          date: { type: 'string' },
          mrp: { type: 'string' },
          consumerCare: { type: 'string' },
        },
        required: [
          'manufacturer',
          'origin',
          'commodity',
          'quantity',
          'date',
          'mrp',
          'consumerCare',
        ],
      },
      notes: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['productName', 'text', 'confidence', 'fields', 'notes'],
  };
}

function buildRequestBody(parts) {
  return {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      maxOutputTokens: 8192,
      responseSchema: buildResponseSchema(),
    },
  };
}

function getGeminiUrl(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

function isRetryable(status) {
  return RETRYABLE_STATUS_CODES.includes(status);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function callModel(model, parts, apiKey) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(getGeminiUrl(model), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(buildRequestBody(parts)),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => ({}));

    if (response.ok) {
      return { payload, model };
    }

    const error = new Error(
      payload?.error?.message ||
        `Gemini request failed with HTTP ${response.status}.`,
    );
    error.status = response.status;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function callWithRetries(model, parts, apiKey) {
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await callModel(model, parts, apiKey);
    } catch (error) {
      lastError = error;

      if (!isRetryable(error?.status) || attempt === 3) {
        throw error;
      }

      await delay(800 * 2 ** (attempt - 1));
    }
  }

  throw lastError;
}

function extractText(payload) {
  return (payload?.candidates || [])
    .flatMap((candidate) => candidate?.content?.parts || [])
    .map((part) => part?.text || '')
    .join('\n')
    .trim();
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = String(text).match(/\{[\s\S]*\}/);

    if (!match) {
      throw new Error('AI returned an invalid OCR response.');
    }

    return JSON.parse(match[0]);
  }
}

export async function extractLabelText({ files, apiKey, model = DEFAULT_MODEL }) {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the backend.');
  }

  const preparedImages = files;
  const totalBytes = preparedImages.reduce(
    (total, image) => total + image.buffer.length,
    0,
  );

  if (totalBytes > MAX_INLINE_IMAGE_BYTES) {
    const error = new Error(
      'The selected photos are still too large for Gemini. Please use fewer photos or lower-resolution images.',
    );
    error.status = 413;
    throw error;
  }

  const parts = [{ text: OCR_INSTRUCTIONS }];

  preparedImages.forEach((image, index) => {
    parts.push({ text: `PHOTO ${index + 1}` });
    parts.push({
      inline_data: {
        mime_type: image.mimeType,
        data: image.buffer.toString('base64'),
      },
    });
  });

  const models = [...new Set([model, ...FALLBACK_MODELS])];
  let result;
  let lastError;

  for (const currentModel of models) {
    try {
      result = await callWithRetries(currentModel, parts, apiKey);
      break;
    } catch (error) {
      lastError = error;
      console.warn(
        `Gemini OCR failed on ${currentModel}: ${error?.message || error}`,
      );
    }
  }

  if (!result) {
    throw lastError || new Error('All Gemini OCR models failed after retries.');
  }

  const parsed = parseJson(extractText(result.payload));
  const extractedText = String(parsed.text || '').trim();

  if (!extractedText) {
    throw new Error(
      'Gemini responded successfully but returned no readable label text.',
    );
  }

  return {
    provider: 'Google Gemini Vision OCR',
    model: result.model,
    productName: parsed.productName || 'Unknown product',
    extractedText,
    confidence: Math.max(
      0,
      Math.min(100, Number(parsed.confidence) || 0),
    ),
    fields: parsed.fields || {},
    notes: Array.isArray(parsed.notes) ? parsed.notes : [],
  };
}

export { DEFAULT_MODEL };
