const DEFAULT_PADDLE_URL = 'http://localhost:8000';

function getPaddleUrl() {
  return (process.env.PADDLE_OCR_URL || DEFAULT_PADDLE_URL).replace(/\/$/, '');
}

export async function extractWithPaddle(files) {
  const formData = new FormData();

  files.forEach((image, index) => {
    const extension = image.originalname?.split('.').pop() || 'jpg';
    const filename = `photo-${index + 1}.${extension}`;

    formData.append(
      'images',
      new Blob([image.buffer], { type: image.mimeType || 'image/jpeg' }),
      filename,
    );
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  try {
    const response = await fetch(`${getPaddleUrl()}/ocr`, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = new Error(
        payload?.detail || `PaddleOCR failed with HTTP ${response.status}.`,
      );
      error.status = response.status;
      throw error;
    }

    if (!String(payload.extractedText || '').trim()) {
      throw new Error('PaddleOCR completed but returned no readable text.');
    }

    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

export function isPaddleConfigured() {
  return Boolean(process.env.PADDLE_OCR_URL);
}
