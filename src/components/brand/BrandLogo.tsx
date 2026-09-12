import type { PublicConfig } from '../../../shared/contracts/configuration';
import { DEFAULT_GLOBAL_CONFIGURATION } from '../../../shared/config/defaultConfiguration';

interface BrandLogoProps {
  brand?: PublicConfig['brand'];
  compact?: boolean;
}

export function BrandLogo({
  brand = DEFAULT_GLOBAL_CONFIGURATION.brand,
  compact = false,
}: BrandLogoProps) {
  return (
    <div className="brand-logo" aria-label={brand.logoAltText}>
      <svg className="brand-mark" viewBox="0 0 48 48" aria-hidden="true">
        <rect width="48" height="48" rx="14" fill="currentColor" opacity="0.08" />
        <path d="M24 34V17" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        <path d="M24 23C18 23 14 19 14 14c6 0 10 3 10 9Z" fill="currentColor" />
        <path d="M24 28c7 0 11-4 11-10-7 0-11 4-11 10Z" fill="currentColor" opacity="0.72" />
      </svg>
      <div className="brand-wording">
        <strong>HortiVital<span>Mix</span></strong>
        {!compact && <small>{brand.tagline}</small>}
      </div>
    </div>
  );
}
