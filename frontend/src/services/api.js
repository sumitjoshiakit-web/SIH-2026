const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

function getApiUrl(path) {
  if (!API_BASE) {
    throw new Error(
      'AI OCR backend is not configured. Set VITE_API_URL to the deployed backend URL.',
    );
  }

  return `${API_BASE}${path}`;
}

async function parseResponse(response) {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    return response.json().catch(() => ({}));
  }

  return response.text();
}

async function request(path, options = {}) {
  const response = await fetch(getApiUrl(path), options);
  const body = await parseResponse(response);

  if (!response.ok) {
    const message =
      typeof body === 'object' && body?.error
        ? body.error
        : 'The server request failed.';

    throw new Error(message);
  }

  return body;
}

export async function runOcr(files) {
  const formData = new FormData();

  files.forEach(({ file }) => {
    formData.append('images', file, file.name);
  });

  return request('/api/ocr', {
    method: 'POST',
    body: formData,
  });
}

export function analyzeInspection({ extractedText, productName, ocrConfidence }) {
  return request('/api/inspections/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      extractedText,
      productName,
      ocrConfidence,
    }),
  });
}

export function createReport({
  product,
  checks,
  score,
  extractedText,
  status,
  ocrProvider,
  confidence,
}) {
  return request('/api/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      format: 'html',
      product,
      checks,
      score,
      extractedText,
      status,
      ocrProvider,
      confidence,
    }),
  });
}

export { API_BASE };
