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

function Icon({ name, size = 22 }) {
  const paths = {
    camera: <><path d="M4 7h3l1.5-2h7L17 7h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"/><circle cx="12" cy="13" r="4"/></>,
    gallery: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1.5"/><path d="m21 16-5-5-5 6-3-3-5 5"/></>,
    upload: <><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 20h16"/></>,
    home: <><path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-6h6v6"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    scan: <><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8 12h8"/></>,
    x: <><path d="m6 6 12 12M18 6 6 18"/></>,
    trash: <><path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/></>,
  };
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function PhotoPreview({ item, index, onRemove }) {
  return <div className="photo-thumb">
    <img src={item.url} alt={`Product photo ${index + 1}`} draggable="false" onClick={e => e.stopPropagation()} />
    <button type="button" aria-label={`Remove photo ${index + 1}`} onClick={e => { e.preventDefault(); e.stopPropagation(); onRemove(index); }}><Icon name="x" size={16} /></button>
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
  const [dragActive, setDragActive] = useState(false);
  const [activeNav, setActiveNav] = useState('scanner');
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem('legalmetrix-history') || '[]'); } catch { return []; }
  });
  const cameraRef = useRef(null);
  const galleryRef = useRef(null);

  useEffect(() => () => files.forEach(item => URL.revokeObjectURL(item.url)), []);
  useEffect(() => { localStorage.setItem('legalmetrix-history', JSON.stringify(history)); }, [history]);
  useEffect(() => {
    const sections = ['scanner', 'checks', 'history'].map(id => document.getElementById(id)).filter(Boolean);
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) setActiveNav(visible.target.id);
    }, { rootMargin: '-20% 0px -55% 0px', threshold: [0.15, 0.4, 0.7] });
    sections.forEach(section => observer.observe(section));
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(''), 8000);
    return () => clearTimeout(timer);
  }, [error]);

  const checks = useMemo(() => REQUIRED_FIELDS.map(([key, label]) => ({ key, label, pass: !!ocrText && FIELD_PATTERNS[key].test(ocrText) })), [ocrText]);
  const fallbackScore = ocrText ? Math.round((checks.filter(c => c.pass).length / checks.length) * 100) : 0;
  const fallbackStatus = !ocrText ? 'Ready to scan' : fallbackScore >= 85 ? 'Likely compliant' : fallbackScore >= 60 ? 'Needs review' : 'Potential non-compliance';
  const displayScore = scanResult?.score ?? fallbackScore;
  const displayStatus = scanResult?.status ? scanResult.status.replaceAll('_', ' ').replace(/\b\w/g, x => x.toUpperCase()) : fallbackStatus;
  const displayChecks = scanResult?.checks || checks.map(c => ({ key: c.key, title: c.label, status: c.pass ? 'PASS' : 'REVIEW', evidence: c.pass ? 'Detected in OCR' : null }));
  const visibleChecks = showAllRules ? displayChecks : displayChecks.slice(0, 4);
  const reviewCount = displayChecks.filter(c => c.status === 'REVIEW').length;
  const passCount = displayChecks.filter(c => c.status === 'PASS' || c.pass).length;

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
        const result = await Tesseract.recognize(item.file, language, { logger: message => { if (message.status === 'recognizing text') setConfidence(Math.round((message.progress || 0) * 100)); } });
        results.push(result);
      } catch (error) {
        console.warn('Hindi+English Tesseract failed, retrying English:', error);
        const result = await Tesseract.recognize(item.file, 'eng', { logger: message => message.status === 'recognizing text' && setConfidence(Math.round((message.progress || 0) * 100)) });
        results.push(result); language = 'eng';
      }
    }
    const text = results.map((r, i) => `[Photo ${i + 1}]\n${String(r.data.text || '').trim()}`).filter(section => section.replace(/\[Photo \d+\]\s*/, '').trim()).join('\n\n');
    const avgConfidence = Math.round(results.reduce((sum, r) => sum + (Number(r.data.confidence) || 0), 0) / Math.max(results.length, 1));
    return { extractedText: text, confidence: avgConfidence, productName: files[0]?.file.name || 'Unknown product', provider: `Tesseract.js fallback • ${language === 'eng+hin' ? 'Hindi + English' : 'English'}` };
  }

  async function scan() {
    if (!files.length || busy) return;
    setBusy(true); setError(''); setScanResult(null); setShowAllRules(false); setConfidence(0);
    try {
      let ocr;
      if (API_BASE) {
        const formData = new FormData();
        files.forEach(item => formData.append('images', item.file, item.file.name));
        try {
          const response = await fetch(`${API_BASE}/api/ocr`, { method: 'POST', body: formData });
          if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || 'AI OCR request failed'); }
          const data = await response.json();
          ocr = { extractedText: data.extractedText, confidence: data.confidence, productName: data.productName, provider: `${data.provider || 'AI Vision'} • ${data.model || ''}`.trim() };
        } catch (aiError) {
          setError(`AI OCR unavailable, using local Hindi + English OCR fallback: ${aiError.message}`);
          ocr = await tesseractFallback();
        }
      } else ocr = await tesseractFallback();

      const text = String(ocr.extractedText || '').trim();
      if (!text) throw new Error('No readable text was found. Capture clearer label photos and try again.');
      setOcrText(text); setConfidence(Math.round(Number(ocr.confidence) || 0)); setOcrProvider(ocr.provider || 'OCR');

      let backendResult = null;
      if (API_BASE) {
        const response = await fetch(`${API_BASE}/api/inspections/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ extractedText: text, productName: ocr.productName, ocrConfidence: ocr.confidence }) });
        if (response.ok) backendResult = await response.json();
      }

      const resultScore = Math.round((REQUIRED_FIELDS.filter(([key]) => FIELD_PATTERNS[key].test(text)).length / REQUIRED_FIELDS.length) * 100);
      const result = backendResult || { score: resultScore, status: resultScore >= 85 ? 'LIKELY_COMPLIANT' : resultScore >= 60 ? 'NEEDS_REVIEW' : 'POTENTIAL_NON_COMPLIANCE', checks: REQUIRED_FIELDS.map(([key, label]) => ({ key, title: label, status: FIELD_PATTERNS[key].test(text) ? 'PASS' : 'REVIEW', evidence: FIELD_PATTERNS[key].test(text) ? 'Detected in OCR' : null })) };
      setScanResult(result);
      setHistory(prev => [{ id: crypto.randomUUID(), name: `${files.length} photo${files.length > 1 ? 's' : ''} • ${ocr.productName || files[0].file.name}`, score: result.score, scannedAt: new Date().toLocaleString() }, ...prev].slice(0, 12));
    } catch (e) { setError(e.message || 'OCR failed. Try clearer label images.'); }
    finally { setBusy(false); }
  }

  function clearHistory() {
    if (!history.length) return;
    if (window.confirm('Clear all inspection history from this device?')) setHistory([]);
  }

  function downloadBlob(content, type, filename) {
    const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  async function downloadReport() {
    if (!ocrText || !scanResult) return;
    const payload = { format: 'html', product: scanResult.productName || files[0]?.file.name || 'Unknown product', checks: displayChecks, score: displayScore, extractedText: ocrText, status: displayStatus, ocrProvider, confidence };
    if (API_BASE) {
      try {
        const response = await fetch(`${API_BASE}/api/reports`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (response.ok) { const blob = await response.blob(); downloadBlob(blob, 'text/html;charset=utf-8', `legalmetrix-report-${Date.now()}.html`); return; }
      } catch (error) { console.warn('Server report failed, using local report:', error); }
    }
    const safe = value => String(value ?? '').replace(/[&<>\"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '\"':'&quot;', "'":'&#39;' }[c]));
    const rows = displayChecks.map(c => `<tr><td>${safe(c.title || c.label)}</td><td>${safe(c.status)}</td><td>${safe(c.evidence || 'Not confidently detected')}</td></tr>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LegalMetriX Scanner Report</title><style>body{font-family:Arial,sans-serif;max-width:900px;margin:40px auto;padding:0 20px;color:#172033}h1{margin-bottom:4px}table{width:100%;border-collapse:collapse;margin-top:24px}td,th{border:1px solid #d9dee8;padding:10px;text-align:left}pre{white-space:pre-wrap;background:#f5f7fb;padding:16px;border-radius:10px}.score{font-size:36px;font-weight:700}</style></head><body><h1>LegalMetriX Scanner</h1><p>Inspection screening report</p><p class="score">${safe(displayScore)}/100</p><p><b>Product:</b> ${safe(payload.product)}<br><b>Status:</b> ${safe(displayStatus)}<br><b>OCR:</b> ${safe(ocrProvider)} (${safe(confidence)}%)<br><b>Generated:</b> ${safe(new Date().toLocaleString())}</p><h2>Declaration checks</h2><table><thead><tr><th>Requirement</th><th>Status</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table><h2>Extracted label text</h2><pre>${safe(ocrText)}</pre><p><small>Screening aid only. Findings must be verified against the current applicable Legal Metrology rules and amendments before enforcement action.</small></p></body></html>`;
    downloadBlob(html, 'text/html;charset=utf-8', `legalmetrix-scanner-report-${Date.now()}.html`);
  }

  const scrollTo = id => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return <div className="app-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark">LM</span><div><b>LegalMetriX Scanner</b><small>SIH 26034 • LegalMetriX Scanner</small></div></div><span className="official-chip">Inspector Mode</span></header>
    <main>
      <section className="hero"><div><p className="eyebrow">LEGAL METROLOGY • FIELD INSPECTION</p><h1>Scan. Validate. Explain.</h1><p>Capture a package label with your phone camera and check mandatory declarations in seconds.</p></div><div className="hero-flow"><span>01 Scan</span><span>02 AI OCR</span><span>03 Rules</span><span>04 Report</span></div></section>
      <section className="grid">
        <div id="scanner" className="panel upload-panel">
          <div className="panel-head"><div><h2>Product scanner</h2><p>Start with a clear photo of the label.</p></div><span className="badge">{ocrProvider ? `${ocrProvider.split(' • ')[0]} ${confidence}%` : `OCR ${confidence || '—'}%`}</span></div>
          <input ref={cameraRef} className="hidden-input" type="file" accept="image/*" capture="environment" multiple onChange={e => addFiles(e.target.files)} />
          <input ref={galleryRef} className="hidden-input" type="file" accept="image/*" multiple onChange={e => addFiles(e.target.files)} />
          <div className="scan-actions"><button className="camera-btn" type="button" onClick={() => cameraRef.current?.click()}><Icon name="camera" size={24} /><span><b>Add Product Photo</b><small>Capture another side</small></span></button><button className="gallery-btn" type="button" onClick={() => galleryRef.current?.click()}><Icon name="gallery" size={24} /><span><b>Add from Gallery</b><small>Select multiple photos</small></span></button></div>
          <div className={`dropzone ${dragActive ? 'drag-active' : ''}`} onDragEnter={e => { e.preventDefault(); setDragActive(true); }} onDragOver={e => e.preventDefault()} onDragLeave={e => { if (e.currentTarget === e.target) setDragActive(false); }} onDrop={e => { e.preventDefault(); setDragActive(false); addFiles(e.dataTransfer.files); }}>
            {files.length ? <div className="photo-grid">{files.map((item, i) => <PhotoPreview key={`${item.file.name}-${item.file.lastModified}-${i}`} item={item} index={i} onRemove={removePhoto} />)}</div> : <><div className="upload-icon"><Icon name="upload" size={22} /></div><strong>{dragActive ? 'Drop images to add them' : 'Drop one or more label images here'}</strong><span>For round/cylindrical packs, capture multiple sides</span></>}
          </div>
          {files.length > 0 && <div className="file-row"><span>{files.length} photo{files.length > 1 ? 's' : ''} selected</span><button className="primary" type="button" onClick={scan} disabled={busy}>{busy ? `Scanning ${confidence}%` : 'Run compliance scan'}</button></div>}
          {busy && <div className="scan-progress" role="status" aria-live="polite"><div className="progress-top"><span>Analyzing label and checking declarations</span><b>{confidence}%</b></div><div className="progress-track"><div className="progress-fill" style={{ width: `${Math.max(4, confidence)}%` }} /></div><small>AI OCR → Legal Metrology rules → screening result</small></div>}
          {error && <div className="error" role="alert"><span>{error}</span><button type="button" aria-label="Dismiss error" onClick={() => setError('')}><Icon name="x" size={17} /></button></div>}
        </div>
        <div className="panel score-panel"><div className="score-ring" style={{ '--score': `${displayScore * 3.6}deg` }}><div><b>{displayScore}</b><span>/ 100</span></div></div><p className="eyebrow">COMPLIANCE SCREEN</p><h2>{displayStatus}</h2><p>{ocrText ? `${passCount} of ${displayChecks.length} declaration checks detected${reviewCount ? ` • ${reviewCount} need review` : ''}.` : 'Scan a product to calculate the screening score.'}</p><button className="secondary" type="button" disabled={!ocrText} onClick={downloadReport}>Export inspection report</button></div>
      </section>

      <section id="checks" className="panel checklist"><div className="panel-head"><div><h2>Mandatory declaration checks</h2><p>Start with the 4 most important checks. Expand when you need the full rule set.</p></div><span className={`status ${displayScore >= 85 ? 'good' : displayScore >= 60 ? 'warn' : 'bad'}`}>{displayStatus}</span></div><div className="rules-summary"><span><b>{displayChecks.length}</b> rules mapped</span><span className="summary-dot">•</span><span>4 essential checks first</span></div><div className="check-grid">{visibleChecks.map(c => { const pass = c.status === 'PASS' || c.pass; const review = c.status === 'REVIEW' || c.status === 'review'; return <div className={`check ${pass ? 'check-pass' : review ? 'check-review' : 'check-fail'}`} key={c.key || c.ruleId}><span className={`dot ${pass ? 'pass' : review ? 'review' : 'fail'}`}>{pass ? '✓' : review ? 'i' : '!'}</span><div><b>{c.title || c.label}</b><small>{ocrText ? (pass ? (c.evidence ? `Detected: ${c.evidence}` : 'Detected in label text') : review ? 'Not confidently detected — verify label' : (c.evidence || 'Potential issue detected')) : 'Waiting for scan'}</small></div></div>; })}</div>{displayChecks.length > 4 && <button type="button" className="view-all-rules" onClick={() => setShowAllRules(value => !value)}>{showAllRules ? 'Show less ↑' : `View all ${displayChecks.length} rules ›`}</button>}{ocrText && <div className="evidence"><div className="panel-head"><div><h3>Extracted label text</h3><p>{ocrProvider || 'OCR'} • Review text before relying on a finding.</p></div></div><pre>{ocrText}</pre></div>}</section>

      <section id="history" className="panel history"><div className="panel-head"><div><h2>Inspection history</h2><p>Recent scans stored on this device.</p></div>{history.length > 0 && <button className="clear-history" type="button" onClick={clearHistory}><Icon name="trash" size={15} /> Clear history</button>}</div>{history.length === 0 ? <div className="empty">No scans yet. Your first inspection will appear here.</div> : <div className="history-list">{history.map(item => <div className="history-row" key={item.id}><span className="mini-file">IMG</span><div><b>{item.name}</b><small>{item.scannedAt}</small></div><strong>{item.score}%</strong></div>)}</div>}</section>
    </main>
    <a className="direct-scan-fab" href="/?scan=1#scanner" aria-label="Open direct scanner"><Icon name="scan" size={22} /><span>Quick Scan</span></a>
    <nav className="mobile-nav" aria-label="Primary navigation"><button className={activeNav === 'scanner' ? 'active' : ''} type="button" aria-label="Go to Scanner" aria-current={activeNav === 'scanner' ? 'page' : undefined} onClick={() => scrollTo('scanner')}><Icon name="home" size={20} /><span>Scanner</span></button><button className={activeNav === 'checks' ? 'active' : ''} type="button" aria-label="Go to Checks" aria-current={activeNav === 'checks' ? 'page' : undefined} onClick={() => scrollTo('checks')}><Icon name="check" size={20} /><span>Checks</span></button><button className={activeNav === 'history' ? 'active' : ''} type="button" aria-label="Go to History" aria-current={activeNav === 'history' ? 'page' : undefined} onClick={() => scrollTo('history')}><Icon name="clock" size={20} /><span>History</span></button></nav>
    <footer>LegalMetriX Scanner • SIH 26034 • Prototype for enforcement decision support</footer>
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
