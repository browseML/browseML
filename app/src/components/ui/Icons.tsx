import React from 'react';

// Send: an arrow pointing forward (right), the way a message goes; not turned down, where it read as "dock".
export const IconSend: React.FC = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false"
    fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 12h15M13 5l7 7-7 7" />
  </svg>
);

export const IconTerminal: React.FC = () => (
  <span className="inline-block w-4 h-4 text-green-400 font-mono font-bold">
    {'>'}
  </span>
);

export const IconType: React.FC = () => (
  <span className="inline-block w-4 h-4 text-blue-600 font-bold">
    T
  </span>
);

export const IconMenu: React.FC = () => (
  <span className="inline-block w-4 h-4 text-gray-600">
    ☰
  </span>
);

export const IconX: React.FC = () => (
  <span className="inline-block w-4 h-4 text-gray-600">
    ✕
  </span>
); 