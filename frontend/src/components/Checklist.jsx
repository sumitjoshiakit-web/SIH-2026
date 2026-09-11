export default function Checklist({
  checks,
  visibleChecks,
  showAllRules,
  status,
  score,
  ocrText,
  ocrProvider,
  hasResult,
  onToggleRules,
}) {
  return (
    <section id="checks" className="panel checklist">
      <div className="panel-head">
        <div>
          <h2>Mandatory declaration checks</h2>
          <p>
            All 22 mapped rules are visible before scanning. After scanning,
            AI fills their status.
          </p>
        </div>
        <span
          className={`status ${
            score >= 85 ? 'good' : score >= 60 ? 'warn' : 'bad'
          }`}
        >
          {status}
        </span>
      </div>

      <div className="rules-summary">
        <span>
          <b>{checks.length}</b> rules mapped
        </span>
        <span className="summary-dot">•</span>
        <span>4 essential checks first</span>
      </div>

      <div className="check-grid">
        {visibleChecks.map((check) => {
          const isPass = check.status === 'PASS';
          const isReview =
            check.status === 'REVIEW' || check.status === 'review';

          return (
            <div
              className={`check ${
                isPass
                  ? 'check-pass'
                  : isReview
                    ? 'check-review'
                    : 'check-fail'
              }`}
              key={check.key || check.ruleId}
            >
              <span
                className={`dot ${
                  isPass ? 'pass' : isReview ? 'review' : 'fail'
                }`}
              >
                {isPass ? '✓' : isReview ? 'i' : '!'}
              </span>

              <div>
                <b>{check.title}</b>
                <small>
                  {hasResult
                    ? isPass
                      ? check.evidence
                        ? `Detected: ${check.evidence}`
                        : 'Detected in AI OCR'
                      : isReview
                        ? check.message ||
                          'Not confidently detected — verify label'
                        : check.evidence || 'Potential issue detected'
                    : 'Waiting for AI scan'}
                </small>
              </div>
            </div>
          );
        })}
      </div>

      {checks.length > 4 && (
        <button
          type="button"
          className="view-all-rules"
          onClick={onToggleRules}
        >
          {showAllRules
            ? 'Show less ↑'
            : `View all ${checks.length} rules ›`}
        </button>
      )}

      {ocrText && (
        <div className="evidence">
          <div className="panel-head">
            <div>
              <h3>Extracted label text</h3>
              <p>
                {ocrProvider} • Review AI-extracted text before relying on a
                finding.
              </p>
            </div>
          </div>
          <pre>{ocrText}</pre>
        </div>
      )}
    </section>
  );
}
