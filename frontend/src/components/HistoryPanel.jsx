import Icon from './Icon';

export default function HistoryPanel({ history, onClear }) {
  return (
    <section id="history" className="panel history">
      <div className="panel-head">
        <div>
          <h2>Inspection history</h2>
          <p>Recent scans stored on this device.</p>
        </div>

        {history.length > 0 && (
          <button
            className="clear-history"
            type="button"
            onClick={onClear}
          >
            <Icon name="trash" size={15} />
            Clear history
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <div className="empty">
          No scans yet. Your first inspection will appear here.
        </div>
      ) : (
        <div className="history-list">
          {history.map((item) => (
            <div className="history-row" key={item.id}>
              <span className="mini-file">IMG</span>
              <div>
                <b>{item.name}</b>
                <small>{item.scannedAt}</small>
              </div>
              <strong>{item.score}%</strong>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
