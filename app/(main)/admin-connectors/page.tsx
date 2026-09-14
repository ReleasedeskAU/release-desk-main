"use client";

import { Suspense } from "react";
import { TablePageSuspenseFallback } from "@/components/ui/TableSkeleton";
import AdminConnectorsPageContent from "./AdminConnectorsPageContent";

export default function AdminConnectorsPage() {
  return (
    <Suspense fallback={<TablePageSuspenseFallback />}>
      <AdminConnectorsPageContent />
    </Suspense>
  );
}
