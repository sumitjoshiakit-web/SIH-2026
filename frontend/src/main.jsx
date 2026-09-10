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

function PhotoPreview({ file, index, onRemove }) { const [src, setSrc] = useState(''); React.useEffect(() => { const u = URL.createObjectURL(file); setSrc(u); return () => URL.revokeObjectURL(u); }, [file]); return <div className="photo-thumb"><img src={src} alt={`Product photo ${index + 1}`} /><button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(index); }}>×</button></div>; }

function App() {
  const [file, setFile] = useState(null);
  const [files, setFiles] = useState([]);
  const [preview, setPreview] = useState('');
  const [scanResult, setScanResult] = useState(null);
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
  const displayScore = scanResult?.score ?? score;
  const displayStatus = scanResult?.status ? scanResult.status.replaceAll('_',' ').replace(/\b\w/g,x=>x.toUpperCase()) : status;
  const displayChecks = scanResult?.checks || checks.map(c=>({key:c.key,title:c.label,status:c.pass?'PASS':'REVIEW',evidence:c.pass?'Detected in OCR':null}));

  function handleFiles(selectedFiles) {
    const incoming = Array.from(selectedFiles || []).filter(f => f.type.startsWith('image/'));
    if (!incoming.length) { setError('Please select one or more JPG/PNG image files.'); return; }
    setError('');
    setFiles(prev => [...prev, ...incoming].slice(0, 8));
    setOcrText(''); setConfidence(0); setScanResult(null);
  }

  function removePhoto(index) {
    setFiles(prev => prev.filter((_, i) => i !== index));
  }


  async function scan() {
    if (!files.length) return;
    setBusy(true); setError('');
    try {
      const results = [];
      for (const currentFile of files) {
        const result = await Tesseract.recognize(currentFile, 'eng', {
          logger: message => message.status === 'recognizing text' && setConfidence(Math.round((message.progress || 0) * 100)),
        });
        results.push(result);
      }
      const text = results.map((r, i) => `[Photo ${i + 1}]\\n${r.data.text.trim()}`).join('\\n\\n');
      const avgConfidence = Math.round(results.reduce((sum, r) => sum + (r.data.confidence || 0), 0) / results.length);
      setOcrText(text); setConfidence(avgConfidence);
      const resultScore = Math.round((REQUIRED_FIELDS.filter(([key]) => FIELD_PATTERNS[key].test(text)).length / REQUIRED_FIELDS.length) * 100);
      let backendResult = null;
      const apiBase = import.meta.env.VITE_API_URL;
      if (apiBase) { try { const response = await fetch(`${apiBase.replace(/\/$/, '')}/api/inspections/analyze`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({extractedText:text, productName:files[0].name, ocrConfidence:avgConfidence}) }); if (!response.ok) throw new Error('Compliance API request failed'); backendResult = await response.json(); } catch (apiError) { setError(`OCR completed, but backend check failed: ${apiError.message}`); } }
      setScanResult(backendResult || {score:resultScore, status:resultScore>=85?'LIKELY_COMPLIANT':resultScore>=60?'NEEDS_REVIEW':'POTENTIAL_NON_COMPLIANCE', checks:REQUIRED_FIELDS.map(([key,label])=>({key,title:label,status:FIELD_PATTERNS[key].test(text)?'PASS':'REVIEW',evidence:FIELD_PATTERNS[key].test(text)?'Detected in OCR':null}))});
      setHistory(prev => [{ id: crypto.randomUUID(), name: `${files.length} photo${files.length > 1 ? 's' : ''} • ${files[0].name}`, score: resultScore, scannedAt: new Date().toLocaleString() }, ...prev].slice(0, 8));
    } catch (e) { setError(e.message || 'OCR failed. Try clearer label images.'); }
    finally { setBusy(false); }
  }

  function downloadReport() {
    const report = { productImages: files.map(f => f.name), generatedAt: new Date().toISOString(), ocrConfidence: confidence, score: displayScore, status: displayStatus, checks: displayChecks, extractedText: ocrText, note: 'Prototype screening report. Verify findings against the current applicable Legal Metrology rules/amendments before enforcement action.' };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `legalmetrix-scanner-report-${Date.now()}.json`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 100);
  }

  return <div className="app-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark">LM</span><div><b>LegalMetriX Scanner</b><small>SIH 26034 • LegalMetriX Scanner</small></div></div><span className="official-chip">Inspector Mode</span></header>
    <main>
      <section className="hero"><div><p className="eyebrow">LEGAL METROLOGY • FIELD INSPECTION</p><h1>Scan. Validate. Explain.</h1><p>Capture a package label with your phone camera and check mandatory declarations in seconds.</p></div><div className="hero-flow"><span>01 Scan</span><span>02 OCR</span><span>03 Rules</span><span>04 Report</span></div></section>

      <section className="grid">
        <div id="scanner" className="panel upload-panel">
          <div className="panel-head"><div><h2>Product scanner</h2><p>Camera capture is optimized for mobile.</p></div><span className="badge">OCR {confidence || '—'}%</span></div>
          <input ref={cameraRef} className="hidden-input" type="file" accept="image/*" capture="environment" multiple onChange={e => handleFiles(e.target.files)} />
          <input ref={galleryRef} className="hidden-input" type="file" accept="image/*" multiple onChange={e => handleFiles(e.target.files)} />
          <div className="scan-actions"><button className="camera-btn" onClick={() => cameraRef.current?.click()}><span>⌾</span><b>Add Product Photo</b><small>Capture another side</small></button><button className="gallery-btn" onClick={() => galleryRef.current?.click()}><span>▧</span><b>Add from Gallery</b><small>Select multiple photos</small></button></div>
          <label className="dropzone" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}>
            {files.length ? <div className="photo-grid">{files.map((f, i) => <PhotoPreview key={`${f.name}-${i}`} file={f} index={i} onRemove={removePhoto} />)}</div> : <><div className="upload-icon">↑</div><strong>Drop one or more label images here</strong><span>For round/cylindrical packs, capture multiple sides</span></>}
          </label>
          {files.length > 0 && <div className="file-row"><span>{files.length} photo{files.length > 1 ? 's' : ''} selected</span><button className="primary" onClick={scan} disabled={busy}>{busy ? `Scanning ${confidence}%` : 'Run compliance scan'}</button></div>}
          {error && <div className="error">{error}</div>}
        </div>

        <div className="panel score-panel"><div className="score-ring" style={{ '--score': `${displayScore * 3.6}deg` }}><div><b>{displayScore}</b><span>/ 100</span></div></div><p className="eyebrow">COMPLIANCE SCREEN</p><h2>{displayStatus}</h2><p>{ocrText ? `${displayChecks.filter(c => c.status === 'PASS' || c.pass).length} of ${displayChecks.length} core declarations detected.` : 'Scan a product to calculate the screening score.'}</p><button className="secondary" disabled={!ocrText} onClick={downloadReport}>Export inspection report</button></div>
      </section>

      <section className="panel checklist"><div className="panel-head"><div><h2>Mandatory declaration checks</h2><p>OCR findings are shown as evidence for inspector review.</p></div><span className={`status ${score >= 85 ? 'good' : score >= 60 ? 'warn' : 'bad'}`}>{status}</span></div><div className="check-grid">{displayChecks.map(c => { const pass = c.status === 'PASS' || c.pass; return <div className="check" key={c.key || c.ruleId}><span className={pass ? 'dot pass' : 'dot fail'}>{pass ? '✓' : '!'}</span><div><b>{c.title || c.label}</b><small>{ocrText ? (pass ? (c.evidence ? `Detected: ${c.evidence}` : 'Detected in label text') : 'Not confidently detected') : 'Waiting for scan'}</small></div></div>})}</div>{ocrText && <div className="evidence"><div className="panel-head"><div><h3>Extracted label text</h3><p>Review OCR before relying on a finding.</p></div></div><pre>{ocrText}</pre></div>}</section>

      <section className="panel history"><div className="panel-head"><div><h2>Inspection history</h2><p>Recent local scans.</p></div></div>{history.length === 0 ? <div className="empty">No scans yet. Your first inspection will appear here.</div> : <div className="history-list">{history.map(item => <div className="history-row" key={item.id}><span className="mini-file">IMG</span><div><b>{item.name}</b><small>{item.scannedAt}</small></div><strong>{item.score}%</strong></div>)}</div>}</section>
    </main>
    <a className="direct-scan-fab" href="/?scan=1#scanner" aria-label="Open direct scanner">⌾<span>Quick Scan</span></a><nav className="mobile-nav"><button onClick={() => window.scrollTo({top:0, behavior:'smooth'})}>⌂<span>Scanner</span></button><button onClick={() => document.querySelector('.checklist')?.scrollIntoView({behavior:'smooth'})}>✓<span>Checks</span></button><button onClick={() => document.querySelector('.history')?.scrollIntoView({behavior:'smooth'})}>◷<span>History</span></button></nav>
    <footer>LegalMetriX Scanner • SIH 26034 • Prototype for enforcement decision support</footer>
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
