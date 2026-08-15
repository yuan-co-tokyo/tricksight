import { describe, expect, it } from "vitest";

import { authErrorMessage } from "./auth-error";

describe("authErrorMessage", () => {
  it("メール重複を日本語で案内する", () => {
    expect(
      authErrorMessage(
        { code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL", status: 422 },
        "sign-up",
      ),
    ).toContain("既に登録されています");
  });

  it("認証失敗でユーザーの存在を明かさない", () => {
    const invalidPassword = authErrorMessage(
      { code: "INVALID_PASSWORD", status: 401 },
      "sign-in",
    );
    const missingUser = authErrorMessage(
      { code: "USER_NOT_FOUND", status: 401 },
      "sign-in",
    );

    expect(invalidPassword).toBe(
      "メールアドレスまたはパスワードが正しくありません。",
    );
    expect(missingUser).toBe(invalidPassword);
  });

  it("未知の生エラー文を表示せず操作別の文言へ置き換える", () => {
    expect(authErrorMessage({ code: "DATABASE_ERROR" }, "sign-up")).toBe(
      "登録できませんでした。入力内容を確認して、もう一度お試しください。",
    );
    expect(authErrorMessage({ code: "DATABASE_ERROR" }, "sign-in")).toBe(
      "ログインできませんでした。入力内容を確認して、もう一度お試しください。",
    );
  });
});
