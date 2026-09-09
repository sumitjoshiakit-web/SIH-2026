import React, { useMemo, useRef, useState } from 'react';
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
  manufacturer: /(manufactur|manufactured|marketed|packed by|packer|importer)/i,
  origin: /(country of origin|made in|product of)/i,
  commodity: /(product|commodity|contents|ingredients|material)/i,
  quantity: /(net (qty|quantity|weight|wt|vol)|\b\d+(?:\.\d+)?\s?(?:kg|g|mg|l|ml|cm|m)\b)/i,
  date: /(mfg|manufactur(ed|e)?|packed|pkd|\bdate\b|\b\d{1,2}[/-]\d{4}\b)/i,
  mrp: /(m\.?r\.?p|maximum retail price|retail sale price)/i,
  consumerCare: /(consumer care|customer care|helpline|toll[- ]free|contact us|email)/i,
};

function App() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [ocrText, setOcrText] = useState('');
  const [confidence, setConfidence] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);
  const cameraRef = useRef(null);
  const galleryRef = useRef(null);

  const checks = useMemo(() => REQUIRED_FIELDS.map(([key, label]) => ({
    key, label, pass: !!ocrText && FIELD_PATTERNS[key].test(ocrText),
  })), [ocrText]);
  const passed = checks.filter(c => c.pass).length;
  const score = ocrText ? Math.round((passed / checks.length) * 100) : 0;
  const status = !ocrText ? 'Ready to scan' : score >= 85 ? 'Likely compliant' : score >= 60 ? 'Needs review' : 'Potential non-compliance';

  function handleFile(selected) {
    if (!selected) return;
    if (!selected.type.startsWith('image/')) { setError('Please select a JPG, PNG or other image file.'); return; }
    setError(''); setFile(selected); setOcrText(''); setConfidence(0);
    setPreview(URL.createObjectURL(selected));
  }

  async function scan() {
    if (!file) return;
    setBusy(true); setError('');
    try {
      const result = await Tesseract.recognize(file, 'eng', {
        logger: message => message.status === 'recognizing text' && setConfidence(Math.round((message.progress || 0) * 100)),
      });
      const text = result.data.text.trim();
      setOcrText(text); setConfidence(Math.round(result.data.confidence || 0));
      const resultScore = Math.round((REQUIRED_FIELDS.filter(([key]) => FIELD_PATTERNS[key].test(text)).length / REQUIRED_FIELDS.length) * 100);
      setHistory(prev => [{ id: crypto.randomUUID(), name: file.name, score: resultScore, scannedAt: new Date().toLocaleString() }, ...prev].slice(0, 8));
    } catch (e) { setError(e.message || 'OCR failed. Try a clearer label image.'); }
    finally { setBusy(false); }
  }

  function downloadReport() {
    const report = { productImage: file?.name || null, generatedAt: new Date().toISOString(), ocrConfidence: confidence, score, status, checks, extractedText: ocrText, note: 'Prototype screening report. Verify findings against the current applicable Legal Metrology rules/amendments before enforcement action.' };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `legalmetrix-report-${Date.now()}.json`; a.click(); URL.revokeObjectURL(url);
  }

  return <div className="app-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark">LM</span><div><b>LegalMetriX</b><small>SIH 26034 • Compliance Scanner</small></div></div><span className="official-chip">Inspector Mode</span></header>
    <main>
      <section className="hero"><div><p className="eyebrow">LEGAL METROLOGY • FIELD INSPECTION</p><h1>Scan. Validate. Explain.</h1><p>Capture a package label with your phone camera and check mandatory declarations in seconds.</p></div><div className="hero-flow"><span>01 Scan</span><span>02 OCR</span><span>03 Rules</span><span>04 Report</span></div></section>

      <section className="grid">
        <div className="panel upload-panel">
          <div className="panel-head"><div><h2>Product scanner</h2><p>Camera capture is optimized for mobile.</p></div><span className="badge">OCR {confidence || '—'}%</span></div>
          <input ref={cameraRef} className="hidden-input" type="file" accept="image/*" capture="environment" onChange={e => handleFile(e.target.files[0])} />
          <input ref={galleryRef} className="hidden-input" type="file" accept="image/*" onChange={e => handleFile(e.target.files[0])} />
          <div className="scan-actions"><button className="camera-btn" onClick={() => cameraRef.current?.click()}><span>⌾</span><b>Take Photo</b><small>Use camera</small></button><button className="gallery-btn" onClick={() => galleryRef.current?.click()}><span>▧</span><b>Choose Image</b><small>From gallery</small></button></div>
          <label className="dropzone" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}>
            {preview ? <img src={preview} alt="Uploaded product label" /> : <><div className="upload-icon">↑</div><strong>Drop label image here</strong><span>Desktop upload • JPG / PNG</span></>}
          </label>
          {file && <div className="file-row"><span title={file.name}>{file.name}</span><button className="primary" onClick={scan} disabled={busy}>{busy ? `Scanning ${confidence}%` : 'Run compliance scan'}</button></div>}
          {error && <div className="error">{error}</div>}
        </div>

        <div className="panel score-panel"><div className="score-ring" style={{ '--score': `${score * 3.6}deg` }}><div><b>{score}</b><span>/ 100</span></div></div><p className="eyebrow">COMPLIANCE SCREEN</p><h2>{status}</h2><p>{ocrText ? `${passed} of ${checks.length} core declarations detected.` : 'Scan a product to calculate the screening score.'}</p><button className="secondary" disabled={!ocrText} onClick={downloadReport}>Export inspection report</button></div>
      </section>

      <section className="panel checklist"><div className="panel-head"><div><h2>Mandatory declaration checks</h2><p>OCR findings are shown as evidence for inspector review.</p></div><span className={`status ${score >= 85 ? 'good' : score >= 60 ? 'warn' : 'bad'}`}>{status}</span></div><div className="check-grid">{checks.map(c => <div className="check" key={c.key}><span className={c.pass ? 'dot pass' : 'dot fail'}>{c.pass ? '✓' : '!'}</span><div><b>{c.label}</b><small>{ocrText ? (c.pass ? 'Detected in label text' : 'Not confidently detected') : 'Waiting for scan'}</small></div></div>)}</div>{ocrText && <div className="evidence"><div className="panel-head"><div><h3>Extracted label text</h3><p>Review OCR before relying on a finding.</p></div></div><pre>{ocrText}</pre></div>}</section>

      <section className="panel history"><div className="panel-head"><div><h2>Inspection history</h2><p>Recent local scans.</p></div></div>{history.length === 0 ? <div className="empty">No scans yet. Your first inspection will appear here.</div> : <div className="history-list">{history.map(item => <div className="history-row" key={item.id}><span className="mini-file">IMG</span><div><b>{item.name}</b><small>{item.scannedAt}</small></div><strong>{item.score}%</strong></div>)}</div>}</section>
    </main>
    <nav className="mobile-nav"><button onClick={() => window.scrollTo({top:0, behavior:'smooth'})}>⌂<span>Scanner</span></button><button onClick={() => document.querySelector('.checklist')?.scrollIntoView({behavior:'smooth'})}>✓<span>Checks</span></button><button onClick={() => document.querySelector('.history')?.scrollIntoView({behavior:'smooth'})}>◷<span>History</span></button></nav>
    <footer>LegalMetriX • SIH 26034 • Prototype for enforcement decision support</footer>
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
