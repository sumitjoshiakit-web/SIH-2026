import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Tesseract from 'tesseract.js';
import './styles.css';

const REQUIRED_FIELDS = [
  ['manufacturer', 'Manufacturer / packer / importer details'],
  ['origin', 'Country of origin (where applicable)'],
  ['commodity', 'Common / generic commodity name'],
  ['quantity', 'Net quantity'],
  ['date', 'Month / year of manufacture or packing'],
  ['mrp', 'MRP inclusive of all taxes'],
  ['consumerCare', 'Consumer care details'],
];

const FIELD_PATTERNS = {
  manufacturer: /(manufactur|manufactured|marketed|packed\s*by|packer|importer|निर्माता|निर्मित|पैक|आयातक)/i,
  origin: /(country\s+of\s+origin|made\s+in|product\s+of|origin\s*[:\-]|निर्मित\s*स्थान|उत्पत्ति|देश)/i,
  commodity: /(product|commodity|contents|ingredients|material|powder|spices?|उत्पाद|सामग्री|वस्तु|मसाला)/i,
  quantity: /(net\s*(qty|quantity|weight|wt|vol)|net\s*wt\.?|\b\d+(?:\.\d+)?\s?(?:kg|g|mg|l|ml)\b|शुद्ध\s*(मात्रा|वजन)|मात्रा)/i,
  date: /(mfg|manufactur(ed|e)?|packed|pkd|use\s*by|best\s*before|\bdate\b|\b\d{1,2}[/-]\d{4}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)['’\s-]*\d{4}\b|निर्माण|पैकिंग|तिथि|उपयोग)/i,
  mrp: /(m\.?r\.?p|maximum\s+retail\s+price|retail\s+sale\s+price|अधिकतम\s*खुदरा\s*मूल्य|खुदरा\s*मूल्य)/i,
  consumerCare: /(consumer\s+care|customer\s+care|helpline|toll[- ]free|contact\s+us|e[- ]?mail|email|phone|mobile|उपभोक्ता\s*देखभाल|हेल्पलाइन|संपर्क)/i,
};

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

function PhotoPreview({ item, index, onRemove }) {
  return <div className="photo-thumb">
    <img src={item.url} alt={`Product photo ${index + 1}`} draggable="false" onClick={(e) => e.stopPropagation()} />
    <button type="button" aria-label={`Remove photo ${index + 1}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(index); }}>×</button>
  </div>;
}

function App() {
  const [files, setFiles] = useState([]);
  const [scanResult, setScanResult] = useState(null);
  const [ocrText, setOcrText] = useState('');
  const [confidence, setConfidence] = useState(0);
  const [ocrProvider, setOcrProvider] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showAllRules, setShowAllRules] = useState(false);
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem('legalmetrix-history') || '[]'); } catch { return []; }
  });
  const cameraRef = useRef(null);
  const galleryRef = useRef(null);

  useEffect(() => () => files.forEach(item => URL.revokeObjectURL(item.url)), []);
  useEffect(() => { localStorage.setItem('legalmetrix-history', JSON.stringify(history)); }, [history]);

  const checks = useMemo(() => REQUIRED_FIELDS.map(([key, label]) => ({
    key, label, pass: !!ocrText && FIELD_PATTERNS[key].test(ocrText),
  })), [ocrText]);
  const fallbackScore = ocrText ? Math.round((checks.filter(c => c.pass).length / checks.length) * 100) : 0;
  const fallbackStatus = !ocrText ? 'Ready to scan' : fallbackScore >= 85 ? 'Likely compliant' : fallbackScore >= 60 ? 'Needs review' : 'Potential non-compliance';
  const displayScore = scanResult?.score ?? fallbackScore;
  const displayStatus = scanResult?.status ? scanResult.status.replaceAll('_',' ').replace(/\b\w/g, x => x.toUpperCase()) : fallbackStatus;
  const displayChecks = scanResult?.checks || checks.map(c => ({ key: c.key, title: c.label, status: c.pass ? 'PASS' : 'REVIEW', evidence: c.pass ? 'Detected in OCR' : null }));
  const visibleChecks = showAllRules ? displayChecks : displayChecks.slice(0, 4);

  function addFiles(selectedFiles) {
    const incoming = Array.from(selectedFiles || []).filter(f => f.type.startsWith('image/'));
    if (!incoming.length) { setError('Please select one or more JPG/PNG image files.'); return; }
    const remaining = Math.max(0, 8 - files.length);
    if (!remaining) { setError('Maximum 8 product photos can be scanned at once.'); return; }
    setError('');
    const accepted = incoming.slice(0, remaining).map(file => ({ file, url: URL.createObjectURL(file) }));
    setFiles(prev => [...prev, ...accepted]);
    setOcrText(''); setConfidence(0); setOcrProvider(''); setScanResult(null); setShowAllRules(false);
  }

  function removePhoto(index) {
    setFiles(prev => {
      const removed = prev[index];
      if (removed) URL.revokeObjectURL(removed.url);
      return prev.filter((_, i) => i !== index);
    });
    setOcrText(''); setConfidence(0); setScanResult(null); setShowAllRules(false);
  }

  async function tesseractFallback() {
    const results = [];
    let language = 'eng+hin';
    for (const item of files) {
      try {
        const result = await Tesseract.recognize(item.file, language, {
          logger: message => {
            if (message.status === 'recognizing text') setConfidence(Math.round((message.progress || 0) * 100));
          },
        });
        results.push(result);
      } catch (error) {
        console.warn('Hindi+English Tesseract failed, retrying English:', error);
        const result = await Tesseract.recognize(item.file, 'eng', {
          logger: message => message.status === 'recognizing text' && setConfidence(Math.round((message.progress || 0) * 100)),
        });
        results.push(result);
        language = 'eng';
      }
    }
    const text = results.map((r, i) => `[Photo ${i + 1}]\n${String(r.data.text || '').trim()}`).filter(section => section.replace(/\[Photo \d+\]\s*/, '').trim()).join('\n\n');
    const avgConfidence = Math.round(results.reduce((sum, r) => sum + (Number(r.data.confidence) || 0), 0) / Math.max(results.length, 1));
    return { extractedText: text, confidence: avgConfidence, productName: files[0]?.file.name || 'Unknown product', provider: `Tesseract.js fallback • ${language === 'eng+hin' ? 'Hindi + English' : 'English'}` };
  }

  async function scan() {
    if (!files.length || busy) return;
    setBusy(true); setError(''); setScanResult(null); setShowAllRules(false);
    try {
      let ocr;
      if (API_BASE) {
        const formData = new FormData();
        files.forEach(item => formData.append('images', item.file, item.file.name));
        try {
          const response = await fetch(`${API_BASE}/api/ocr`, { method: 'POST', body: formData });
          if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.error || 'AI OCR request failed');
          }
          const data = await response.json();
          ocr = { extractedText: data.extractedText, confidence: data.confidence, productName: data.productName, provider: `${data.provider || 'AI Vision'} • ${data.model || ''}`.trim() };
        } catch (aiError) {
          setError(`AI OCR unavailable, using local Hindi + English OCR fallback: ${aiError.message}`);
          ocr = await tesseractFallback();
        }
      } else {
        ocr = await tesseractFallback();
      }

      const text = String(ocr.extractedText || '').trim();
      if (!text) throw new Error('No readable text was found. Capture clearer label photos and try again.');
      setOcrText(text); setConfidence(Math.round(Number(ocr.confidence) || 0)); setOcrProvider(ocr.provider || 'OCR');

      let backendResult = null;
      if (API_BASE) {
        const response = await fetch(`${API_BASE}/api/inspections/analyze`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ extractedText: text, productName: ocr.productName, ocrConfidence: ocr.confidence }),
        });
        if (response.ok) backendResult = await response.json();
      }

      const resultScore = Math.round((REQUIRED_FIELDS.filter(([key]) => FIELD_PATTERNS[key].test(text)).length / REQUIRED_FIELDS.length) * 100);
      const result = backendResult || {
        score: resultScore,
        status: resultScore >= 85 ? 'LIKELY_COMPLIANT' : resultScore >= 60 ? 'NEEDS_REVIEW' : 'POTENTIAL_NON_COMPLIANCE',
        checks: REQUIRED_FIELDS.map(([key, label]) => ({ key, title: label, status: FIELD_PATTERNS[key].test(text) ? 'PASS' : 'REVIEW', evidence: FIELD_PATTERNS[key].test(text) ? 'Detected in OCR' : null })),
      };
      setScanResult(result);
      setHistory(prev => [{ id: crypto.randomUUID(), name: `${files.length} photo${files.length > 1 ? 's' : ''} • ${ocr.productName || files[0].file.name}`, score: result.score, scannedAt: new Date().toLocaleString() }, ...prev].slice(0, 12));
    } catch (e) { setError(e.message || 'OCR failed. Try clearer label images.'); }
    finally { setBusy(false); }
  }

  function downloadBlob(content, type, filename) {
    const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  async function downloadReport() {
    if (!ocrText || !scanResult) return;
    const payload = {
      format: 'html', product: scanResult.productName || files[0]?.file.name || 'Unknown product', checks: displayChecks,
      score: displayScore, extractedText: ocrText, status: displayStatus, ocrProvider, confidence,
    };
    if (API_BASE) {
      try {
        const response = await fetch(`${API_BASE}/api/reports`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (response.ok) {
          const blob = await response.blob();
          downloadBlob(blob, 'text/html;charset=utf-8', `legalmetrix-report-${Date.now()}.html`);
          return;
        }
      } catch (error) { console.warn('Server report failed, using local report:', error); }
    }
    const safe = value => String(value ?? '').replace(/[&<>\"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '\"':'&quot;', "'":'&#39;' }[c]));
    const rows = displayChecks.map(c => `<tr><td>${safe(c.title || c.label)}</td><td>${safe(c.status)}</td><td>${safe(c.evidence || 'Not confidently detected')}</td></tr>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LegalMetriX Scanner Report</title><style>body{font-family:Arial,sans-serif;max-width:900px;margin:40px auto;padding:0 20px;color:#172033}h1{margin-bottom:4px}table{width:100%;border-collapse:collapse;margin-top:24px}td,th{border:1px solid #d9dee8;padding:10px;text-align:left}pre{white-space:pre-wrap;background:#f5f7fb;padding:16px;border-radius:10px}.score{font-size:36px;font-weight:700}</style></head><body><h1>LegalMetriX Scanner</h1><p>Inspection screening report</p><p class="score">${safe(displayScore)}/100</p><p><b>Product:</b> ${safe(payload.product)}<br><b>Status:</b> ${safe(displayStatus)}<br><b>OCR:</b> ${safe(ocrProvider)} (${safe(confidence)}%)<br><b>Generated:</b> ${safe(new Date().toLocaleString())}</p><h2>Declaration checks</h2><table><thead><tr><th>Requirement</th><th>Status</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table><h2>Extracted label text</h2><pre>${safe(ocrText)}</pre><p><small>Screening aid only. Findings must be verified against the current applicable Legal Metrology rules and amendments before enforcement action.</small></p></body></html>`;
    downloadBlob(html, 'text/html;charset=utf-8', `legalmetrix-scanner-report-${Date.now()}.html`);
  }

  return <div className="app-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark">LM</span><div><b>LegalMetriX Scanner</b><small>SIH 26034 • LegalMetriX Scanner</small></div></div><span className="official-chip">Inspector Mode</span></header>
    <main>
      <section className="hero"><div><p className="eyebrow">LEGAL METROLOGY • FIELD INSPECTION</p><h1>Scan. Validate. Explain.</h1><p>Capture a package label with your phone camera and check mandatory declarations in seconds.</p></div><div className="hero-flow"><span>01 Scan</span><span>02 AI OCR</span><span>03 Rules</span><span>04 Report</span></div></section>
      <section className="grid">
        <div id="scanner" className="panel upload-panel">
          <div className="panel-head"><div><h2>Product scanner</h2><p>Camera capture is optimized for mobile.</p></div><span className="badge">{ocrProvider ? `${ocrProvider.split(' • ')[0]} ${confidence}%` : `OCR ${confidence || '—'}%`}</span></div>
          <input ref={cameraRef} className="hidden-input" type="file" accept="image/*" capture="environment" multiple onChange={e => addFiles(e.target.files)} />
          <input ref={galleryRef} className="hidden-input" type="file" accept="image/*" multiple onChange={e => addFiles(e.target.files)} />
          <div className="scan-actions"><button className="camera-btn" type="button" onClick={() => cameraRef.current?.click()}><span>⌾</span><b>Add Product Photo</b><small>Capture another side</small></button><button className="gallery-btn" type="button" onClick={() => galleryRef.current?.click()}><span>▧</span><b>Add from Gallery</b><small>Select multiple photos</small></button></div>
          <div className="dropzone" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>
            {files.length ? <div className="photo-grid">{files.map((item, i) => <PhotoPreview key={`${item.file.name}-${item.file.lastModified}-${i}`} item={item} index={i} onRemove={removePhoto} />)}</div> : <><div className="upload-icon">↑</div><strong>Drop one or more label images here</strong><span>For round/cylindrical packs, capture multiple sides</span></>}
          </div>
          {files.length > 0 && <div className="file-row"><span>{files.length} photo{files.length > 1 ? 's' : ''} selected</span><button className="primary" type="button" onClick={scan} disabled={busy}>{busy ? `Scanning ${confidence}%` : 'Run compliance scan'}</button></div>}
          {error && <div className="error">{error}</div>}
        </div>
        <div className="panel score-panel"><div className="score-ring" style={{ '--score': `${displayScore * 3.6}deg` }}><div><b>{displayScore}</b><span>/ 100</span></div></div><p className="eyebrow">COMPLIANCE SCREEN</p><h2>{displayStatus}</h2><p>{ocrText ? `${displayChecks.filter(c => c.status === 'PASS' || c.pass).length} of ${displayChecks.length} core declarations detected.` : 'Scan a product to calculate the screening score.'}</p><button className="secondary" type="button" disabled={!ocrText} onClick={downloadReport}>Export inspection report</button></div>
      </section>
      <section className="panel checklist"><div className="panel-head"><div><h2>Mandatory declaration checks</h2><p>AI OCR findings are shown as evidence for inspector review.</p></div><span className={`status ${displayScore >= 85 ? 'good' : displayScore >= 60 ? 'warn' : 'bad'}`}>{displayStatus}</span></div><div className="rule-summary"><span className="rule-count">{displayChecks.length} rules mapped</span><span>Showing {Math.min(4, displayChecks.length)} essential checks first</span></div><div className="check-grid">{visibleChecks.map((c, index) => { const pass = c.status === 'PASS' || c.pass; return <div className="check" key={c.key || c.ruleId}><span className={pass ? 'dot pass' : 'dot fail'}>{pass ? '✓' : '!'}</span><div><b>{c.title || c.label}</b><small>{ocrText ? (pass ? (c.evidence ? `Detected: ${c.evidence}` : 'Detected in label text') : 'Not confidently detected') : 'Waiting for scan'}</small></div></div>; })}</div>{displayChecks.length > 4 && <button className="view-all-rules" type="button" onClick={() => setShowAllRules(value => !value)} aria-expanded={showAllRules}>{showAllRules ? 'Show less ↑' : `View all ${displayChecks.length} rules ›`}</button>}{ocrText && <div className="evidence"><div className="panel-head"><div><h3>Extracted label text</h3><p>{ocrProvider || 'OCR'} • Review text before relying on a finding.</p></div></div><pre>{ocrText}</pre></div>}</section>
      <section className="panel history"><div className="panel-head"><div><h2>Inspection history</h2><p>Recent scans stored on this device.</p></div></div>{history.length === 0 ? <div className="empty">No scans yet. Your first inspection will appear here.</div> : <div className="history-list">{history.map(item => <div className="history-row" key={item.id}><span className="mini-file">IMG</span><div><b>{item.name}</b><small>{item.scannedAt}</small></div><strong>{item.score}%</strong></div>)}</div>}</section>
    </main>
    <a className="direct-scan-fab" href="/?scan=1#scanner" aria-label="Open direct scanner">⌾<span>Quick Scan</span></a>
    <nav className="mobile-nav"><button type="button" onClick={() => window.scrollTo({top:0, behavior:'smooth'})}>⌂<span>Scanner</span></button><button type="button" onClick={() => document.querySelector('.checklist')?.scrollIntoView({behavior:'smooth'})}>✓<span>Checks</span></button><button type="button" onClick={() => document.querySelector('.history')?.scrollIntoView({behavior:'smooth'})}>◷<span>History</span></button></nav>
    <footer>LegalMetriX Scanner • SIH 26034 • Prototype for enforcement decision support</footer>
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);