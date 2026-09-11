function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>\"']/g, (character) => {
    const entities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '\"': '&quot;',
      "'": '&#39;',
    };

    return entities[character];
  });
}

export function buildInspectionReport({
  reportId,
  generatedAt,
  product,
  checks,
  score,
  extractedText,
  status,
  ocrProvider,
  confidence,
}) {
  const rows = (Array.isArray(checks) ? checks : [])
    .map(
      (check) => `
        <tr>
          <td>${escapeHtml(check.ruleId || '')}</td>
          <td>${escapeHtml(check.title || check.label || '')}</td>
          <td>${escapeHtml(check.legalBasis || '')}</td>
          <td>${escapeHtml(check.status || 'REVIEW')}</td>
          <td>${escapeHtml(check.evidence || 'Not confidently detected')}</td>
        </tr>
      `,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LegalMetriX Inspection Report</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      max-width: 1100px;
      margin: 0 auto;
      padding: 32px 20px;
      color: #172033;
    }

    h1 { margin-bottom: 4px; }

    .meta { line-height: 1.7; }

    .score {
      font-size: 42px;
      font-weight: 700;
      margin: 20px 0 4px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 18px;
    }

    th,
    td {
      border: 1px solid #d9dee8;
      padding: 10px;
      text-align: left;
      vertical-align: top;
    }

    th { background: #f5f7fb; }

    pre {
      white-space: pre-wrap;
      background: #f5f7fb;
      padding: 16px;
      border-radius: 10px;
    }

    .notice {
      margin-top: 24px;
      font-size: 12px;
      color: #5c6575;
    }
  </style>
</head>
<body>
  <h1>LegalMetriX Scanner</h1>
  <p>Legal Metrology declaration screening report</p>

  <p class="score">${escapeHtml(score)}/100</p>

  <div class="meta">
    <b>Product:</b> ${escapeHtml(product || 'Unknown product')}<br>
    <b>Status:</b> ${escapeHtml(status)}<br>
    <b>OCR:</b> ${escapeHtml(ocrProvider || 'OCR')} (${escapeHtml(confidence)}%)<br>
    <b>Report ID:</b> ${escapeHtml(reportId)}<br>
    <b>Generated:</b> ${escapeHtml(new Date(generatedAt).toLocaleString())}
  </div>

  <h2>Rule-by-rule checks</h2>
  <table>
    <thead>
      <tr>
        <th>Rule</th>
        <th>Requirement</th>
        <th>Legal basis</th>
        <th>Status</th>
        <th>Evidence</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <h2>Extracted label text</h2>
  <pre>${escapeHtml(extractedText)}</pre>

  <p class="notice">
    Screening aid only. A photograph/OCR scan cannot by itself prove actual
    quantity, font size, colour contrast, placement, applicability,
    commodity-specific exemptions or all current amendments. Findings must be
    verified against the current applicable Legal Metrology requirements
    before enforcement action.
  </p>
</body>
</html>`;
}
