import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { proxy } from "./proxy";

const SESSION_COOKIE = "better-auth.session_token=test-session-token";

function request(pathname: string, authenticated = false) {
  return new NextRequest(`http://localhost:3000${pathname}`, {
    headers: authenticated ? { cookie: SESSION_COOKIE } : undefined,
  });
}

describe("proxy", () => {
  it("redirects an unauthenticated protected request to login", () => {
    const response = proxy(request("/dashboard"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/login");
  });

  it("allows a protected request with a session cookie", () => {
    const response = proxy(request("/dashboard", true));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it.each(["/login", "/register"])(
    "redirects an authenticated %s request home",
    (pathname) => {
      const response = proxy(request(pathname, true));

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe("http://localhost:3000/");
    },
  );

  it("allows unauthenticated auth and public routes", () => {
    expect(proxy(request("/login")).status).toBe(200);
    expect(proxy(request("/")).status).toBe(200);
  });
});
