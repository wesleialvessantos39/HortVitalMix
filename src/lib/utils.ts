/**
 * Application utility functions.
 */

/**
 * Combines conditional CSS class names safely.
 */
export function cn(...classes: Array<string | boolean | undefined | null>): string {
  return classes.filter(Boolean).join(' ').trim();
}

/**
 * Formats timestamps into human-readable localized dates.
 */
export function formatDate(timestamp: number | Date, locale = 'pt-BR'): string {
  const date = typeof timestamp === 'number' ? new Date(timestamp) : timestamp;
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/**
 * Extracts a safe user-friendly message from an unknown error.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Ocorreu um erro inesperado. Tente novamente.';
}
