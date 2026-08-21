import apiClient from "./client";

/**
 * Permanently delete the signed-in account and every record attached to it.
 *
 * The backend deletes Firestore data first and the Firebase Auth user last, so
 * a partial failure leaves the account reachable rather than orphaning data.
 * Requires the literal string "DELETE" as confirmation.
 */
export async function deleteAccount(): Promise<{ documents_deleted: number }> {
  const { data } = await apiClient.delete("/api/account", {
    data: { confirmation: "DELETE" },
  });
  return data;
}

/** Everything stored under the account, as JSON — offered alongside deletion. */
export async function exportAccountData(): Promise<Record<string, any>> {
  const { data } = await apiClient.get("/api/account/export", { timeout: 60000 });
  return data;
}
