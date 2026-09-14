import { redirect } from "next/navigation";

/**
 * Old full-page wizard URLs stay on the catalog and open the modal.
 */
export default async function AdminConnectorSourceRedirect({
  params,
}: {
  params: Promise<{ source: string }>;
}) {
  const { source } = await params;
  redirect(`/admin-connectors?source=${encodeURIComponent(source)}`);
}
