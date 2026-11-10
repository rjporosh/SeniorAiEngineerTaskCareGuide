/** Only same-site relative paths are honoured after sign-in (prevents open redirects). */
export const safeNext = (n: string | null): string => (n && /^\/(?!\/)[\w\-./%?=&]*$/.test(n) ? n : '/');
