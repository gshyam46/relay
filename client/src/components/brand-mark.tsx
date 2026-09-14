/** Shared Relay monogram. The adjacent wordmark provides the accessible name. */
export function BrandMark({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false"><rect width="48" height="48" rx="10" fill="var(--color-brand, #2446E8)" /><path d="M12 11h6v26h-6V11Zm9 0h5c7 0 11 3.5 11 9 0 4.2-2.4 7.2-6.5 8.4L38 37h-7.8L21 25.3V23h4.6c3.5 0 5.2-1 5.2-3s-1.7-3-5.2-3H21v-6Z" fill="var(--color-surface, #FFFEFA)" /></svg>;
}
