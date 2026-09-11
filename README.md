# LegalMetriX Scanner — SIH 26034

LegalMetriX Scanner is an AI-assisted screening system for checking mandatory declarations on packaged commodities under the Legal Metrology (Packaged Commodities) Rules, 2011.

The application accepts multiple product-label photos, extracts visible label text with Google Gemini Vision OCR, evaluates the extracted text against mapped Legal Metrology rules, and generates an inspection report.

## SIH Problem Statement

- **Problem ID:** 26034
- **Organization:** Ministry of Consumer Affairs, Food & Public Distribution
- **Department:** Department of Consumer Affairs

## Current Application Flow

```text
Product Photos
      ↓
Image Preprocessing
      ↓
Gemini Vision OCR
      ↓
Extracted Label Text
      ↓
Legal Metrology Rule Engine
      ↓
Rule-by-Rule Findings
      ↓
Compliance Screening Score
      ↓
Inspection Report
```

## Key Features

- Capture or upload multiple product-label photos.
- Support different sides of round or cylindrical packages.
- Preprocess images before sending them to Gemini.
- Use Gemini Vision for structured OCR extraction.
- Preserve English and Devanagari text without translating it.
- Avoid AI guessing when label text is unclear.
- Use OCR confidence as a readability indicator, separate from compliance score.
- Evaluate 22 mapped Legal Metrology screening rules.
- Distinguish `PASS`, `REVIEW`, and `FAIL` findings.
- Keep visual-only requirements marked for manual/image verification.
- Store recent inspection history locally in the browser.
- Export an HTML inspection report.
- Run as a mobile-friendly PWA.

## Project Structure

```text
SIH-2026/
├── backend/
│   ├── .env.example
│   ├── package.json
│   └── src/
│       ├── engine/
│       │   └── compliance.engine.js
│       ├── rules/
│       │   └── legalMetrology.rules.js
│       ├── services/
│       │   ├── gemini.service.js
│       │   ├── image.service.js
│       │   └── report.service.js
│       └── server.js
│
├── frontend/
│   ├── public/
│   │   ├── app-icon.svg
│   │   ├── legalmetrix-logo.svg
│   │   ├── manifest.webmanifest
│   │   ├── scanner-icon.svg
│   │   └── sw.js
│   ├── src/
│   │   ├── components/
│   │   │   ├── Checklist.jsx
│   │   │   ├── Header.jsx
│   │   │   ├── HistoryPanel.jsx
│   │   │   ├── Icon.jsx
│   │   │   ├── PhotoPreview.jsx
│   │   │   ├── ScannerPanel.jsx
│   │   │   └── ScorePanel.jsx
│   │   ├── constants/
│   │   │   └── rules.js
│   │   ├── services/
│   │   │   └── api.js
│   │   ├── main.jsx
│   │   ├── registerServiceWorker.js
│   │   └── styles.css
│   ├── index.html
│   └── package.json
│
└── README.md
```

## Backend Architecture

### `server.js`

Responsible only for application setup and HTTP endpoints.

### `services/gemini.service.js`

Handles:

- Gemini Vision requests
- Structured OCR schema
- Retry handling
- Model fallback
- JSON parsing
- OCR confidence extraction

### `services/image.service.js`

Handles image rotation, resizing, and JPEG optimization before OCR.

### `engine/compliance.engine.js`

Runs the Legal Metrology screening logic and calculates the weighted score.

### `rules/legalMetrology.rules.js`

Contains the rule definitions separately from the application logic.

### `services/report.service.js`

Generates the downloadable HTML inspection report and safely escapes report content.

## Gemini Configuration

Create `backend/.env` from `.env.example`:

```env
PORT=5000
GEMINI_API_KEY=your_google_ai_studio_api_key
GEMINI_MODEL=gemini-3.8-flash
```

The API key must remain on the backend. It must not be exposed in frontend environment variables or client-side code.

The OCR service uses the configured model first and can fall back to compatible Gemini models when a retryable model/API failure occurs.

## Frontend Configuration

Set the deployed backend URL in the frontend environment:

```env
VITE_API_URL=https://your-backend-domain.example.com
```

## Run Locally

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Backend

```bash
cd backend
npm install
npm run dev
```

## Compliance Disclaimer

LegalMetriX Scanner is a screening and decision-support prototype. OCR and rule matching cannot by themselves prove every visual, measurement, applicability, commodity-specific, or amendment-specific requirement.

Final enforcement decisions must be verified against the current applicable Legal Metrology requirements and official government guidance.

## Demo Narrative

**Scan → Extract → Validate → Explain → Report → History**
