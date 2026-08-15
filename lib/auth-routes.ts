const AUTH_ROUTE_PATHS = new Set(["/login", "/register"]);

// 保護画面を追加するときは、この配列へルートの先頭パスを1箇所追加する。
export const PROTECTED_ROUTE_PREFIXES = [
  "/dashboard",
  "/videos",
  "/history",
  "/profile",
] as const;

export function isAuthRoute(pathname: string) {
  return AUTH_ROUTE_PATHS.has(pathname);
}

export function isProtectedRoute(pathname: string) {
  return PROTECTED_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
