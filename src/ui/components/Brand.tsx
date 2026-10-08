/** Convertly mark: a circular "convert" arrow forming a C on a teal tile. */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg class="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="cv-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#2fc9b5" />
          <stop offset="1" stop-color="#0a7a70" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#cv-mark)" />
      <path d="M22.4 11.6A7.6 7.6 0 1 0 23.3 20" fill="none" stroke="#fff" stroke-width="2.7" stroke-linecap="round" />
      <path d="M18.3 10.3l4.4.9-.9 4.4" fill="none" stroke="#fff" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round" />
      <circle cx="16" cy="16" r="2.3" fill="#fff" />
    </svg>
  );
}
