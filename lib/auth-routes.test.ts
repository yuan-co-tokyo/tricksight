import { describe, expect, it } from "vitest";

import { isAuthRoute, isProtectedRoute } from "./auth-routes";

describe("auth route classification", () => {
  it.each(["/login", "/register"])("treats %s as an auth route", (path) => {
    expect(isAuthRoute(path)).toBe(true);
  });

  it.each([
    "/dashboard",
    "/dashboard/recent",
    "/videos/new",
    "/history",
    "/profile/settings",
  ])("treats %s as protected", (path) => {
    expect(isProtectedRoute(path)).toBe(true);
  });

  it.each(["/", "/login/help", "/dashboard-preview", "/api/auth/session"])(
    "does not overmatch %s",
    (path) => {
      expect(isProtectedRoute(path)).toBe(false);
    },
  );
});
