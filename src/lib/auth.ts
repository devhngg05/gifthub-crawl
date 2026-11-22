export interface AdminAuthResult {
  authorized: boolean;
  status: 200 | 401 | 503;
  error?: string;
}

export function verifyAdminSecret(
  headerValue: string | null,
): AdminAuthResult {
  void headerValue;
  return { authorized: false, status: 401 };
}
