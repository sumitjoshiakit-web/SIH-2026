export default function ScorePanel({
  score,
  status,
  hasResult,
  passCount,
  totalChecks,
  reviewCount,
  onDownloadReport,
}) {
  return (
    <div className="panel score-panel">
      <div
        className="score-ring"
        style={{ '--score': `${score * 3.6}deg` }}
      >
        <div>
          <b>{score}</b>
          <span>/ 100</span>
        </div>
      </div>

      <p className="eyebrow">COMPLIANCE SCREEN</p>
      <h2>{status}</h2>
      <p>
        {hasResult
          ? `${passCount} of ${totalChecks} declaration checks passed${
              reviewCount ? ` • ${reviewCount} need review` : ''
            }.`
          : 'Scan a product to calculate the AI screening score.'}
      </p>

      <button
        className="secondary"
        type="button"
        disabled={!hasResult}
        onClick={onDownloadReport}
      >
        Export inspection report
      </button>
    </div>
  );
}
