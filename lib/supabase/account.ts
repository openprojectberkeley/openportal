import type { SupabaseClient, User } from "@supabase/supabase-js";

export type AccountInfo = {
  email?: string | null;
  phone?: string | null;
  name?: string | null;
};

type JwtClaims = Record<string, unknown>;

function readString(value: unknown): string | null | undefined {
  return typeof value === "string" ? value : undefined;
}

export function accountInfoFromClaims(
  claims: JwtClaims | null | undefined,
): AccountInfo | null {
  if (!claims) {
    return null;
  }

  const userMetadata =
    claims.user_metadata && typeof claims.user_metadata === "object"
      ? (claims.user_metadata as JwtClaims)
      : null;

  return {
    email: readString(claims.email),
    phone: readString(claims.phone),
    name:
      readString(claims.name) ??
      readString(userMetadata?.name) ??
      readString(userMetadata?.full_name),
  };
}

export function accountInfoFromUser(
  user: User | null | undefined,
): AccountInfo | null {
  if (!user) {
    return null;
  }

  return {
    email: user.email,
    phone: user.phone,
    name: user.user_metadata?.name ?? user.user_metadata?.full_name,
  };
}

export async function getAuthClaims(
  supabase: SupabaseClient,
): Promise<JwtClaims | null> {
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    return null;
  }

  return data.claims as JwtClaims;
}

export async function getAccountInfo(
  supabase: SupabaseClient,
): Promise<AccountInfo | null> {
  const claims = await getAuthClaims(supabase);
  return accountInfoFromClaims(claims);
}

export function subscribeToAccountInfo(
  supabase: SupabaseClient,
  onAccountInfo: (account: AccountInfo | null) => void,
): () => void {
  getAccountInfo(supabase).then(onAccountInfo);

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => {
    onAccountInfo(accountInfoFromUser(session?.user));
  });

  return () => subscription.unsubscribe();
}
