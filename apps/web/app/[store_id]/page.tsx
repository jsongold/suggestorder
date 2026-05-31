import { redirect } from "next/navigation";

/**
 * Legacy route. The customer flow moved to /e/{entry_id} (entry-centric).
 * Anyone landing on the old /{store_id} URL is redirected to the root.
 */
export default async function LegacyStorePage({
  params,
}: {
  params: Promise<{ store_id: string }>;
}): Promise<never> {
  // Consume the param so Next.js generated PageProps types stay satisfied.
  await params;
  redirect("/");
}
