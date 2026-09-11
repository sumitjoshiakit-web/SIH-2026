import Icon from './Icon';

export default function PhotoPreview({ item, index, onRemove }) {
  return (
    <div className="photo-thumb">
      <img
        src={item.url}
        alt={`Product photo ${index + 1}`}
        draggable="false"
      />

      <button
        type="button"
        aria-label={`Remove photo ${index + 1}`}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onRemove(index);
        }}
      >
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}
