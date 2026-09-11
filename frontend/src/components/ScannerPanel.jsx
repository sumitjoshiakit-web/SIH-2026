import Icon from './Icon';
import PhotoPreview from './PhotoPreview';

export default function ScannerPanel({
  files,
  busy,
  confidence,
  ocrProvider,
  error,
  dragActive,
  cameraRef,
  galleryRef,
  onAddFiles,
  onRemovePhoto,
  onScan,
  onSetDragActive,
  onClearError,
}) {
  return (
    <div id="scanner" className="panel upload-panel">
      <div className="panel-head">
        <div>
          <h2>Product scanner</h2>
          <p>Start with a clear photo of the label.</p>
        </div>
        <span className="badge">
          {ocrProvider
            ? `${ocrProvider.split(' • ')[0]} ${confidence}%`
            : 'AI OCR —'}
        </span>
      </div>

      <input
        ref={cameraRef}
        className="hidden-input"
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        onChange={(event) => onAddFiles(event.target.files)}
      />

      <input
        ref={galleryRef}
        className="hidden-input"
        type="file"
        accept="image/*"
        multiple
        onChange={(event) => onAddFiles(event.target.files)}
      />

      <div className="scan-actions">
        <button
          className="camera-btn"
          type="button"
          onClick={() => cameraRef.current?.click()}
        >
          <Icon name="camera" size={24} />
          <span>
            <b>Add Product Photo</b>
            <small>Capture another side</small>
          </span>
        </button>

        <button
          className="gallery-btn"
          type="button"
          onClick={() => galleryRef.current?.click()}
        >
          <Icon name="gallery" size={24} />
          <span>
            <b>Add from Gallery</b>
            <small>Select multiple photos</small>
          </span>
        </button>
      </div>

      <div
        className={`dropzone ${dragActive ? 'drag-active' : ''}`}
        onDragEnter={(event) => {
          event.preventDefault();
          onSetDragActive(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target) {
            onSetDragActive(false);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          onSetDragActive(false);
          onAddFiles(event.dataTransfer.files);
        }}
      >
        {files.length ? (
          <div className="photo-grid">
            {files.map((item, index) => (
              <PhotoPreview
                key={`${item.file.name}-${item.file.lastModified}-${index}`}
                item={item}
                index={index}
                onRemove={onRemovePhoto}
              />
            ))}
          </div>
        ) : (
          <>
            <div className="upload-icon">
              <Icon name="upload" size={22} />
            </div>
            <strong>
              {dragActive
                ? 'Drop images to add them'
                : 'Drop one or more label images here'}
            </strong>
            <span>For round/cylindrical packs, capture multiple sides</span>
          </>
        )}
      </div>

      {files.length > 0 && (
        <div className="file-row">
          <span>
            {files.length} photo{files.length > 1 ? 's' : ''} selected
          </span>
          <button
            className="primary"
            type="button"
            onClick={onScan}
            disabled={busy}
          >
            {busy ? `Scanning ${confidence}%` : 'Run AI compliance scan'}
          </button>
        </div>
      )}

      {busy && (
        <div className="scan-progress" role="status" aria-live="polite">
          <div className="progress-top">
            <span>AI OCR → Legal Metrology analysis</span>
            <b>{confidence}%</b>
          </div>
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${Math.max(4, confidence)}%` }}
            />
          </div>
          <small>Using Gemini Vision AI only.</small>
        </div>
      )}

      {error && (
        <div className="error" role="alert">
          <span>{error}</span>
          <button
            type="button"
            aria-label="Dismiss error"
            onClick={onClearError}
          >
            <Icon name="x" size={17} />
          </button>
        </div>
      )}
    </div>
  );
}
