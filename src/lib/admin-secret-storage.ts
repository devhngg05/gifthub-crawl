const ADMIN_SECRET_STORAGE_KEY = "gtr_admin_secret";

export function readStoredAdminSecret(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.sessionStorage.getItem(ADMIN_SECRET_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveStoredAdminSecret(secret: string): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(ADMIN_SECRET_STORAGE_KEY, secret);
  } catch {
    // Ignore storage restriction errors
  }
}

export function clearStoredAdminSecret(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.removeItem(ADMIN_SECRET_STORAGE_KEY);
  } catch {
    // Ignore storage restriction errors
  }
}
