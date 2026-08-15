export type AuthOperation = "sign-in" | "sign-up";

type AuthErrorLike = {
  code?: string;
  status?: number;
};

export function authErrorMessage(
  error: AuthErrorLike,
  operation: AuthOperation,
): string {
  if (error.status === 429) {
    return "試行回数が多すぎます。少し時間をおいてからもう一度お試しください。";
  }

  switch (error.code) {
    case "INVALID_EMAIL":
      return "メールアドレスの形式を確認してください。";
    case "PASSWORD_TOO_SHORT":
      return "パスワードは8文字以上で入力してください。";
    case "PASSWORD_TOO_LONG":
      return "パスワードが長すぎます。128文字以内で入力してください。";
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "このメールアドレスは既に登録されています。ログインするか、別のメールアドレスをお使いください。";
    case "INVALID_EMAIL_OR_PASSWORD":
    case "INVALID_PASSWORD":
    case "USER_NOT_FOUND":
    case "CREDENTIAL_ACCOUNT_NOT_FOUND":
      return "メールアドレスまたはパスワードが正しくありません。";
    default:
      return operation === "sign-up"
        ? "登録できませんでした。入力内容を確認して、もう一度お試しください。"
        : "ログインできませんでした。入力内容を確認して、もう一度お試しください。";
  }
}
