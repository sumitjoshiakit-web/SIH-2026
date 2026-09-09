# LegalMetriX Scanner — SIH 26034

Software System to check compliance of packaged commodities under the Legal Metrology (Packaged Commodities) Rules, 2011 by scanning product images and labels.

## SIH Problem Statement
- **ID:** 26034
- **Organization:** Ministry of Consumer Affairs, Food & Public Distribution
- **Department:** Department of Consumer Affairs

## Proposed Solution
LegalMetriX Scanner combines OCR, image evidence, a versioned rule engine and inspection history to help enforcement officials screen packaged commodities.

### Core flow
1. Upload/capture package label images.
2. OCR extracts declarations and bounding boxes.
3. Normalize extracted text into structured fields.
4. Run versioned Legal Metrology checks.
5. Highlight missing/suspicious declarations and evidence regions.
6. Produce a compliance score and violation summary.
7. Save inspection history and export a report.

## MVP Checks
- Manufacturer / packer / importer details
- Country of origin for imported products
- Common/generic commodity name
- Net quantity
- Month/year of manufacture or packing
- Best before / use by where applicable
- MRP inclusive of all taxes
- Consumer care details
- Dimensions where applicable
- Unit sale price where applicable
- Basic OCR confidence/readability warnings

> This is a screening/decision-support prototype, not a legal determination. Rules are versioned because the Department of Consumer Affairs publishes amendments and advisories.

## Official source
Department of Consumer Affairs: https://consumeraffairs.gov.in/pages/legal-metrology-act

## Planned architecture
- **Frontend:** React + Vite + Tesseract.js
- **Backend:** Node.js + Express
- **Database:** Supabase/PostgreSQL
- **Reports:** browser PDF/print + structured JSON export
- **Deployment:** Vercel frontend + server deployment for API

## Run locally
```bash
cd frontend
npm install
npm run dev
```

For the API:
```bash
cd backend
npm install
npm run dev
```

## Team demo narrative
**Scan → Extract → Validate → Explain → Report → History**
