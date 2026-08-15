import { getSessionCookie } from "better-auth/cookies";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { isAuthRoute, isProtectedRoute } from "./lib/auth-routes";

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const authRoute = isAuthRoute(pathname);
  const protectedRoute = isProtectedRoute(pathname);

  if (!authRoute && !protectedRoute) {
    return NextResponse.next();
  }

  // ProxyではUX向上のためCookieの存在だけを楽観的に確認する。
  // 全リクエストへのDB往復を避け、セキュリティ境界をServer Component側に固定し、
  // 将来Edgeランタイムへ移す余地も残すため、ここではDBへ接続しない。
  const hasSessionCookie = Boolean(getSessionCookie(request));

  if (protectedRoute && !hasSessionCookie) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (authRoute && hasSessionCookie) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
