import React, { useId } from 'react';

interface EngramLogoProps {
  size?: number;
  className?: string;
}

export const EngramLogo: React.FC<EngramLogoProps> = ({
  size = 24,
  className = '',
}) => {
  const uid = useId().replace(/:/g, '');
  const bgId = `engram-bg-${uid}`;
  const linkId = `engram-link-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={bgId} x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1E1E26" />
          <stop offset="100%" stopColor="#0D0D11" />
        </linearGradient>
        <linearGradient id={linkId} x1="17" y1="9" x2="22" y2="23" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#10B981" stopOpacity="0.55" />
          <stop offset="50%" stopColor="#8B5CF6" stopOpacity="0.65" />
          <stop offset="100%" stopColor="#34D399" stopOpacity="0.55" />
        </linearGradient>
      </defs>

      <rect
        x="1"
        y="1"
        width="30"
        height="30"
        rx="7"
        fill={`url(#${bgId})`}
        stroke="#2E2E38"
        strokeWidth="1.2"
      />

      {/* Subtle synaptic graph bridge linking memory trace endpoints */}
      <path
        d="M 21 9.5 L 17.5 16 L 21 22.5"
        stroke={`url(#${linkId})`}
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Geometric "E" spine and branches */}
      <path d="M 10 9.5 V 22.5" stroke="#F4F4F5" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M 10 9.5 H 20.5" stroke="#F4F4F5" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M 10 16 H 17" stroke="#A78BFA" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M 10 22.5 H 20.5" stroke="#F4F4F5" strokeWidth="2.4" strokeLinecap="round" />

      {/* Spine hub & terminal memory nodes */}
      <circle cx="10" cy="16" r="2.1" fill="#FAFAFA" />
      <circle cx="21" cy="9.5" r="2.4" fill="#10B981" />
      <circle cx="17.5" cy="16" r="2.2" fill="#8B5CF6" />
      <circle cx="21" cy="22.5" r="2.4" fill="#34D399" />
    </svg>
  );
};
