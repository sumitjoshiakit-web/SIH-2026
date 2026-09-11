const DEFAULT_MODEL = 'gemini-3.8-flash';
const FALLBACK_MODELS = ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash'];

// Gemini inline image requests are limited to 20 MB total request size.
// Keep raw images below that limit because base64 increases payload size.
const MAX_INLINE_IMAGE_BYTES = 14 * 1024 * 1024;
const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];

const OCR_INSTRUCTIONS = `You are the high-accuracy OCR engine for LegalMetriX Scanner.
Read the supplied packaged-product label photos as a document, not as a general image caption.

Recover every actually visible character useful for Legal Metrology screening. Inspect every photo and combine different sides of the same package.

Rules:
1. Transcribe only visible text. Never invent, autocomplete, infer, or correct values.
2. Preserve exact spelling, punctuation, decimals, rupee symbols, numbers, dates, batch codes, contacts, MRP, quantities and units.
3. Preserve English and Devanagari/Hindi text. Do not translate.
4. Pay special attention to MRP, Net Quantity, Mfg/Pkd, Best Before/Use By, manufacturer/packer/importer, address/PIN, FSSAI/licence numbers, consumer-care contacts, country of origin and unit sale price.
5. If a character is genuinely unreadable, use [unclear] instead of guessing.
6. Treat photos as different views of the same package and preserve the clearest version of repeated text.
7. Do not decide compliance. OCR only.
8. Confidence means text-legibility confidence from 0-100, not compliance.

Return ONLY JSON with these top-level keys:
productName, text, confidence, fields, notes.

fields must contain:
manufacturer, origin, commodity, quantity, date, mrp, consumerCare.
Use an empty string when a value is not visible. notes must be an array of strings. Put the useful transcription in text, grouped as PHOTO 1, PHOTO 2, etc.`;

function buildRequestBody(parts) {
  // Intentionally use JSON mode without responseSchema.
  // This avoids the response_schema parser error seen in the deployed API.
  return {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      maxOutputTokens: 8192,
    },
  };
}

function getGeminiUrl(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRetryable(status) {
  return RETRYABLE_STATUS_CODES.includes(status);
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
      payload?.error?.message || `Gemini request failed with HTTP ${response.status}.`,
    );
    error.status = response.status;
    throw error;
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('Gemini OCR request timed out after 60 seconds.');
      timeoutError.status = 408;
      throw timeoutError;
    }
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
  const cleanText = String(text || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleanText);
  } catch {
    const start = cleanText.indexOf('{');
    const end = cleanText.lastIndexOf('}');

    if (start === -1 || end <= start) {
      throw new Error('Gemini returned an invalid OCR JSON response.');
    }

    try {
      return JSON.parse(cleanText.slice(start, end + 1));
    } catch {
      throw new Error('Gemini returned malformed OCR JSON.');
    }
  }
}

function normalizeOcrResult(parsed) {
  const fields = parsed?.fields && typeof parsed.fields === 'object'
    ? parsed.fields
    : {};

  return {
    productName: String(parsed?.productName || 'Unknown product').trim(),
    extractedText: String(parsed?.text || '').trim(),
    confidence: Math.max(0, Math.min(100, Number(parsed?.confidence) || 0)),
    fields: {
      manufacturer: String(fields.manufacturer || '').trim(),
      origin: String(fields.origin || '').trim(),
      commodity: String(fields.commodity || '').trim(),
      quantity: String(fields.quantity || '').trim(),
      date: String(fields.date || '').trim(),
      mrp: String(fields.mrp || '').trim(),
      consumerCare: String(fields.consumerCare || '').trim(),
    },
    notes: Array.isArray(parsed?.notes)
      ? parsed.notes.map((note) => String(note)).filter(Boolean)
      : [],
  };
}

export async function extractLabelText({ files, apiKey, model = DEFAULT_MODEL }) {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the backend.');
  }

  const totalBytes = files.reduce(
    (total, image) => total + image.buffer.length,
    0,
  );

  if (totalBytes > MAX_INLINE_IMAGE_BYTES) {
    const error = new Error(
      'The selected photos are too large for Gemini. Please use fewer photos or lower-resolution images.',
    );
    error.status = 413;
    throw error;
  }

  const parts = [{ text: OCR_INSTRUCTIONS }];

  files.forEach((image, index) => {
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

  const parsed = normalizeOcrResult(parseJson(extractText(result.payload)));

  if (!parsed.extractedText) {
    throw new Error('Gemini responded successfully but returned no readable label text.');
  }

  return {
    provider: 'Google Gemini Vision OCR',
    model: result.model,
    ...parsed,
  };
}

export { DEFAULT_MODEL };
