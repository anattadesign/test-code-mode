/** Minimal shape of the Admin GraphQL client returned by authenticate.admin / appProxy. */
export interface AdminClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

export class AdminGraphqlError extends Error {}

/** Run an Admin GraphQL operation and return `data`, throwing on top-level errors. */
export async function gql<T>(
  admin: AdminClient,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await admin.graphql(query, variables ? { variables } : undefined);
  const body = (await response.json()) as { data?: T; errors?: unknown };
  if (body.errors || !body.data) {
    throw new AdminGraphqlError(JSON.stringify(body.errors ?? "No data returned"));
  }
  return body.data;
}

export interface UserError {
  field?: string[] | null;
  message: string;
}

/** Turn mutation userErrors into a single message (or null when there are none). */
export function userErrorMessage(errors: UserError[] | null | undefined): string | null {
  if (!errors || errors.length === 0) return null;
  return errors.map((e) => e.message).join(" ");
}
