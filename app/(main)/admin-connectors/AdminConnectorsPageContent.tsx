"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ChevronRight, Search } from "lucide-react";
import { SourceLogo } from "@/components/admin-connectors/SourceLogo";
import {
  getAdminConnectorSource,
  listAdminConnectorSources,
  matchesCatalogSearch,
} from "@/lib/admin-connectors/catalog";
import {
  COMING_SOON_COPY,
  SOURCE_CATEGORIES,
  isCatalogSourceReady,
  warnsFullAccount,
  type AdminConnectorSource,
} from "@/lib/admin-connectors/types";
import { guidedConnectorType } from "@/lib/admin-connectors/guided";
import { controlLoc, fieldLoc } from "@/lib/ui-control-locators";
import { cn } from "@/lib/utils";
import { ConnectorWizard } from "../connectors/ConnectorWizard";
import { AdminConnectorWizard } from "./AdminConnectorWizard";

export default function AdminConnectorsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sources = listAdminConnectorSources();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<AdminConnectorSource | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const visible = useMemo(
    () => sources.filter((source) => matchesCatalogSearch(source, query)),
    [sources, query]
  );

  useEffect(() => {
    const requested = searchParams.get("source");
    if (!requested) return;
    const source = getAdminConnectorSource(requested);
    if (source && isCatalogSourceReady(source)) setSelected(source);
    router.replace("/admin-connectors", { scroll: false });
  }, [router, searchParams]);

  function openSource(source: AdminConnectorSource) {
    setNotice(null);
    setSelected(source);
  }

  function closeWizard() {
    setSelected(null);
  }

  const guidedType = selected ? guidedConnectorType(selected.id) : null;

  return (
    <div className="w-full font-sans pb-24">
      <div className="mb-8 mt-2">
        <div className="flex items-center text-[13px] text-gray-500 font-medium mb-3">
          <span>Operations</span>
          <ChevronRight className="h-3 w-3 mx-1.5" />
          <span className="text-[#2548C9] font-semibold">Admin Connectors</span>
        </div>
        <h1 className="text-[32px] font-bold text-[#111827] tracking-tight mb-2">Admin Connectors</h1>
        <p className="text-[15px] text-gray-500 font-medium leading-relaxed max-w-[720px]">
          Pick a source and add it. Jira, GitHub, Teams, and Email use the same guided flow as Connectors.
          Other sources use the catalog form. Indexed documents go to Ask — not into
          releases or tickets. Status, sync, and delete stay on{" "}
          <Link href="/connectors" className="text-[#2548C9] hover:underline">
            Connectors
          </Link>
          .
        </p>
        <label className="relative mt-5 block max-w-[420px]">
          <span className="sr-only">Search sources</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sources"
            autoComplete="off"
            className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm text-gray-900 focus:border-[#2548C9] focus:outline-none focus:ring-1 focus:ring-[#2548C9]"
            {...fieldLoc("admin_connectors_search", "search")}
          />
        </label>
      </div>

      {notice && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          {notice}{" "}
          <Link href="/connectors" className="font-semibold text-[#2548C9] hover:underline">
            Open Connectors
          </Link>
        </div>
      )}

      {visible.length === 0 && (
        <p className="text-sm text-gray-500">No sources match that search.</p>
      )}

      {SOURCE_CATEGORIES.map((category) => {
        const tiles = visible.filter((source) => source.category === category.id);
        if (tiles.length === 0) return null;
        return (
          <section key={category.id} className="mb-10">
            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-gray-500 mb-3">
              {category.label}
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {tiles.map((source) => {
                const ready = isCatalogSourceReady(source);
                const fullAccount = warnsFullAccount(source);
                const body = (
                  <>
                    <SourceLogo sourceId={source.id} />
                    <span className="mt-3 text-center text-[13px] font-semibold text-[#111827] leading-snug">
                      {source.label}
                    </span>
                    {!ready && (
                      <span className="mt-2 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600">
                        Coming soon
                      </span>
                    )}
                    {fullAccount && ready && (
                      <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-amber-800">
                        <AlertTriangle className="h-3 w-3" />
                        Full account
                      </span>
                    )}
                    {!ready && source.comingSoon && (
                      <span className="mt-1 px-1 text-center text-[11px] text-gray-500 leading-snug">
                        {COMING_SOON_COPY[source.comingSoon]}
                      </span>
                    )}
                  </>
                );

                const className = cn(
                  "flex min-h-[168px] flex-col items-center justify-center rounded-2xl border p-4 text-center transition-colors",
                  ready
                    ? "border-gray-200 bg-white shadow-sm hover:border-[#2548C9] hover:shadow-md"
                    : "border-gray-200 bg-gray-50 opacity-80"
                );

                if (!ready) {
                  return (
                    <div
                      key={source.id}
                      className={className}
                      title={source.comingSoon ? COMING_SOON_COPY[source.comingSoon] : undefined}
                      {...controlLoc(`admin_connectors_tile_${source.id}`)}
                    >
                      {body}
                    </div>
                  );
                }

                return (
                  <button
                    key={source.id}
                    type="button"
                    className={className}
                    onClick={() => openSource(source)}
                    {...controlLoc(`admin_connectors_tile_${source.id}`)}
                  >
                    {body}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      {selected && guidedType && (
        <ConnectorWizard
          key={selected.id}
          mode="create"
          existingConnector={null}
          initialType={guidedType}
          onClose={closeWizard}
          onSaved={() => {
            setSelected(null);
            setNotice(`${selected.label} was added. Indexing will show on Connectors.`);
          }}
        />
      )}
      {selected && !guidedType && (
        <AdminConnectorWizard
          key={selected.id}
          source={selected}
          onClose={closeWizard}
          onSaved={() => {
            setSelected(null);
            setNotice(`${selected.label} was added. Indexing will show on Connectors.`);
          }}
        />
      )}
    </div>
  );
}
