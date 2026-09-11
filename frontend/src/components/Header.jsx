import Icon from './Icon';
import { LOGO_SRC } from '../constants/rules';

export default function Header({ onNavigate }) {
  return (
    <header className="topbar">
      <a
        className="brand"
        href="#scanner"
        onClick={(event) => {
          event.preventDefault();
          onNavigate('scanner');
        }}
      >
        <img
          className="brand-logo"
          src={LOGO_SRC}
          alt="LegalMatriX-Scanner"
        />
        <span>LegalMatriX-Scanner</span>
      </a>
    </header>
  );
}

export function MobileNavigation({ activeNav, onNavigate }) {
  const items = [
    ['scanner', 'home', 'Scanner'],
    ['checks', 'check', 'Checks'],
    ['history', 'clock', 'History'],
  ];

  return (
    <nav className="mobile-nav" aria-label="Primary navigation">
      {items.map(([id, icon, label]) => (
        <button
          key={id}
          className={activeNav === id ? 'active' : ''}
          type="button"
          aria-label={`Go to ${label}`}
          aria-current={activeNav === id ? 'page' : undefined}
          onClick={() => onNavigate(id)}
        >
          <Icon name={icon} size={20} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
