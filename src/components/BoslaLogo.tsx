interface BoslaLogoProps {
  size?: number;
  variant?: 'dark' | 'light';
  className?: string;
}

export function BoslaLogo({ size = 44, variant = 'light', className = '' }: BoslaLogoProps) {
  const src = variant === 'dark' ? '/bosla-logo-transparent.png' : '/bosla-logo.png';

  return (
    <img
      src={src}
      alt="شعار بوصلة التطبيقات"
      width={size}
      height={size}
      referrerPolicy="no-referrer"
      style={{ width: size, height: size }}
      className={`object-contain select-none shrink-0 ${
        variant === 'light' ? 'rounded-xl bg-white' : ''
      } ${className}`}
    />
  );
}
