interface BoslaLogoProps {
  size?: number;
  variant?: 'navy' | 'white';
}

export function BoslaLogo({ size = 44, variant = 'navy' }: BoslaLogoProps) {
  const bg = variant === 'navy' ? '#101D35' : '#FFFFFF';
  const ring = variant === 'navy' ? '#D5B45C' : '#101D35';
  const needlePrimary = '#2878E8';
  const needleAccent = '#D5B45C';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="شعار بوصلة التطبيقات"
    >
      <rect width="64" height="64" rx="18" fill={bg} />
      <circle cx="32" cy="32" r="21" stroke={ring} strokeWidth="2.2" strokeOpacity="0.9" />
      <circle cx="32" cy="32" r="15.5" stroke={needlePrimary} strokeWidth="1" strokeDasharray="3 3" strokeOpacity="0.55" />
      {/* Cardinal ticks */}
      <path d="M32 8V12M32 52V56M8 32H12M52 32H56" stroke={needleAccent} strokeWidth="2" strokeLinecap="round" />
      {/* Compass needle */}
      <path d="M32 14L38.5 32L32 29.5L25.5 32L32 14Z" fill={needlePrimary} />
      <path d="M32 50L25.5 32L32 34.5L38.5 32L32 50Z" fill={needleAccent} />
      <circle cx="32" cy="32" r="3.2" fill="#FFFFFF" stroke={bg} strokeWidth="1.2" />
    </svg>
  );
}
