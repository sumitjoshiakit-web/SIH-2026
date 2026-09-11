import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import './styles.css';

import Header, { MobileNavigation } from './components/Header';
import ScannerPanel from './components/ScannerPanel';
import ScorePanel from './components/ScorePanel';
import Checklist from './components/Checklist';
import HistoryPanel from './components/HistoryPanel';

import {
  HISTORY_STORAGE_KEY,
  INITIAL_CHECKS,
  LOGO_SRC,
  MAX_HISTORY_ITEMS,
  MAX_PHOTOS,
} from './constants/rules';
import { analyzeInspection, createReport, runOcr } from './services/api';

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function formatStatus(status) {
  if (!status) return 'Ready to scan';

  return status
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function downloadBlob(content, type, filename) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 500);
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
  const [history, setHistory] = useState(loadHistory);

  const cameraRef = useRef(null);
  const galleryRef = useRef(null);

  useEffect(() => {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    const sections = ['scanner', 'checks', 'history']
      .map((id) => document.getElementById(id))
      .filter(Boolean);

    if (!('IntersectionObserver' in window)) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleSection = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        if (visibleSection) {
          setActiveNav(visibleSection.target.id);
        }
      },
      {
        rootMargin: '-20% 0px -55% 0px',
        threshold: [0.15, 0.4, 0.7],
      },
    );

    sections.forEach((section) => observer.observe(section));

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!error) return undefined;

    const timer = setTimeout(() => setError(''), 8000);
    return () => clearTimeout(timer);
  }, [error]);

  useEffect(() => {
    return () => {
      files.forEach((item) => URL.revokeObjectURL(item.url));
    };
  }, [files]);

  const checks = scanResult?.checks?.length ? scanResult.checks : INITIAL_CHECKS;
  const visibleChecks = showAllRules ? checks : checks.slice(0, 4);
  const score = scanResult?.score ?? 0;
  const status = formatStatus(scanResult?.status);
  const passCount = checks.filter((check) => check.status === 'PASS').length;
  const reviewCount = checks.filter((check) => check.status === 'REVIEW').length;

  function resetResults() {
    setOcrText('');
    setConfidence(0);
    setOcrProvider('');
    setScanResult(null);
    setShowAllRules(false);
  }

  function addFiles(selectedFiles) {
    const incoming = Array.from(selectedFiles || []).filter((file) =>
      file.type.startsWith('image/'),
    );

    if (!incoming.length) {
      setError('Please select one or more JPG/PNG image files.');
      return;
    }

    const remainingSlots = MAX_PHOTOS - files.length;

    if (remainingSlots <= 0) {
      setError(`Maximum ${MAX_PHOTOS} product photos can be scanned at once.`);
      return;
    }

    setError('');
    setFiles((currentFiles) => [
      ...currentFiles,
      ...incoming.slice(0, remainingSlots).map((file) => ({
        file,
        url: URL.createObjectURL(file),
      })),
    ]);
    resetResults();
  }

  function removePhoto(index) {
    setFiles((currentFiles) => {
      const removedFile = currentFiles[index];

      if (removedFile) {
        URL.revokeObjectURL(removedFile.url);
      }

      return currentFiles.filter((_, currentIndex) => currentIndex !== index);
    });

    resetResults();
  }

  async function scan() {
    if (!files.length || busy) return;

    setBusy(true);
    setError('');
    setScanResult(null);
    setShowAllRules(false);
    setConfidence(0);

    try {
      const ocrResult = await runOcr(files);
      const text = String(ocrResult.extractedText || '').trim();

      if (!text) {
        throw new Error(
          'AI could not read the label. Capture clearer product photos and try again.',
        );
      }

      const nextConfidence = Math.round(Number(ocrResult.confidence) || 0);

      setOcrText(text);
      setConfidence(nextConfidence);
      setOcrProvider(
        `${ocrResult.provider || 'AI Vision'}${
          ocrResult.model ? ` • ${ocrResult.model}` : ''
        }`,
      );

      const result = await analyzeInspection({
        extractedText: text,
        productName: ocrResult.productName,
        ocrConfidence: nextConfidence,
      });

      setScanResult(result);
      setHistory((currentHistory) => [
        {
          id: crypto.randomUUID(),
          name: `${files.length} photo${files.length > 1 ? 's' : ''} • ${
            ocrResult.productName || files[0].file.name
          }`,
          score: result.score,
          scannedAt: new Date().toLocaleString(),
        },
        ...currentHistory,
      ].slice(0, MAX_HISTORY_ITEMS));
    } catch (scanError) {
      setError(scanError.message || 'AI OCR failed. Try clearer label images.');
    } finally {
      setBusy(false);
    }
  }

  function clearHistory() {
    if (!history.length) return;

    if (window.confirm('Clear all inspection history from this device?')) {
      setHistory([]);
    }
  }

  async function downloadReport() {
    if (!ocrText || !scanResult) return;

    try {
      const report = await createReport({
        product: scanResult.productName || files[0]?.file.name || 'Unknown product',
        checks,
        score,
        extractedText: ocrText,
        status,
        ocrProvider,
        confidence,
      });

      downloadBlob(
        report,
        'text/html;charset=utf-8',
        `legalmetrix-report-${Date.now()}.html`,
      );
    } catch (reportError) {
      setError(reportError.message || 'Could not export report.');
    }
  }

  function scrollTo(id) {
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="app-shell">
      <Header onNavigate={scrollTo} />

      <main className="page">
        <section className="hero">
          <div>
            <p className="eyebrow">PACKAGED COMMODITY INSPECTION</p>
            <h1>
              Scan. Check. <span>Verify.</span>
            </h1>
            <p className="hero-copy">
              Upload clear label photos to screen mandatory declarations under
              the Legal Metrology (Packaged Commodities) Rules.
            </p>
          </div>
        </section>

        <section className="grid">
          <ScannerPanel
            files={files}
            busy={busy}
            confidence={confidence}
            ocrProvider={ocrProvider}
            error={error}
            dragActive={dragActive}
            cameraRef={cameraRef}
            galleryRef={galleryRef}
            onAddFiles={addFiles}
            onRemovePhoto={removePhoto}
            onScan={scan}
            onSetDragActive={setDragActive}
            onClearError={() => setError('')}
          />

          <ScorePanel
            score={score}
            status={status}
            hasResult={Boolean(scanResult)}
            passCount={passCount}
            totalChecks={checks.length}
            reviewCount={reviewCount}
            onDownloadReport={downloadReport}
          />
        </section>

        <Checklist
          checks={checks}
          visibleChecks={visibleChecks}
          showAllRules={showAllRules}
          status={status}
          score={score}
          ocrText={ocrText}
          ocrProvider={ocrProvider}
          hasResult={Boolean(scanResult)}
          onToggleRules={() => setShowAllRules((value) => !value)}
        />

        <HistoryPanel history={history} onClear={clearHistory} />
      </main>

      <MobileNavigation activeNav={activeNav} onNavigate={scrollTo} />

      <footer>
        Legal Metrology Scanner • Packaged Commodity Inspection
      </footer>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
