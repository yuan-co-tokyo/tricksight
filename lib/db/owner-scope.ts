import { eq } from "drizzle-orm";

import { practiceSessions } from "./schema";

export function requireUserId(userId: string) {
  if (userId.trim().length === 0) {
    throw new Error("userId is required for every owned database operation.");
  }

  return userId;
}

/**
 * Single application ownership predicate. Tables without user_id must join
 * through sessions before applying this scope.
 */
export function ownerScope(userId: string) {
  return eq(practiceSessions.userId, requireUserId(userId));
}
