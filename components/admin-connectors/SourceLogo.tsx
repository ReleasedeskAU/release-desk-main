"use client";

import type { ComponentType } from "react";
import { cn } from "@/lib/utils";
import type { IconProps } from "./vendor-logos/icon-props";
import SvgAirtable from "./vendor-logos/airtable";
import SvgAsana from "./vendor-logos/asana";
import SvgAws from "./vendor-logos/aws";
import SvgAxero from "./vendor-logos/axero";
import SvgBitbucket from "./vendor-logos/bitbucket";
import SvgBookstack from "./vendor-logos/bookstack";
import SvgBox from "./vendor-logos/box";
import SvgBraintrust from "./vendor-logos/braintrust";
import SvgCanvas from "./vendor-logos/canvas";
import SvgClickup from "./vendor-logos/clickup";
import SvgCloudflare from "./vendor-logos/cloudflare";
import SvgCoda from "./vendor-logos/coda";
import SvgConfluence from "./vendor-logos/confluence";
import SvgDiscord from "./vendor-logos/discord";
import SvgDiscourse from "./vendor-logos/discourse";
import SvgDocument360 from "./vendor-logos/document-360";
import SvgDropbox from "./vendor-logos/dropbox";
import SvgDrupal from "./vendor-logos/drupal";
import SvgEgnyte from "./vendor-logos/egnyte";
import SvgFile from "./vendor-logos/file";
import SvgFireflies from "./vendor-logos/fireflies";
import SvgFreshdesk from "./vendor-logos/freshdesk";
import SvgGitbook from "./vendor-logos/gitbook";
import SvgGithub from "./vendor-logos/github";
import SvgGitlab from "./vendor-logos/gitlab";
import SvgGmail from "./vendor-logos/gmail";
import SvgGong from "./vendor-logos/gong";
import SvgGoogleCloud from "./vendor-logos/google-cloud";
import SvgGoogleDrive from "./vendor-logos/google-drive";
import SvgGoogleSites from "./vendor-logos/google-sites";
import SvgGuru from "./vendor-logos/guru";
import SvgHighspot from "./vendor-logos/highspot";
import SvgHubspot from "./vendor-logos/hubspot";
import SvgJira from "./vendor-logos/jira";
import SvgLinear from "./vendor-logos/linear";
import SvgLoopio from "./vendor-logos/loopio";
import SvgLumapps from "./vendor-logos/lumapps";
import SvgMediawiki from "./vendor-logos/mediawiki";
import SvgNotion from "./vendor-logos/notion";
import SvgOracle from "./vendor-logos/oracle";
import SvgOutline from "./vendor-logos/outline";
import SvgOutlook from "./vendor-logos/outlook";
import SvgProductboard from "./vendor-logos/productboard";
import SvgSalesforce from "./vendor-logos/salesforce";
import SvgSharepoint from "./vendor-logos/sharepoint";
import SvgSlab from "./vendor-logos/slab";
import SvgSlack from "./vendor-logos/slack";
import SvgTeams from "./vendor-logos/teams";
import SvgTestrail from "./vendor-logos/testrail";
import SvgWeb from "./vendor-logos/web";
import SvgWikipedia from "./vendor-logos/wikipedia";
import SvgXenforo from "./vendor-logos/xenforo";
import SvgZendesk from "./vendor-logos/zendesk";
import SvgZulip from "./vendor-logos/zulip";

type Logo = ComponentType<IconProps>;

const LOGOS: Record<string, Logo> = {
  airtable: SvgAirtable,
  asana: SvgAsana,
  axero: SvgAxero,
  bitbucket: SvgBitbucket,
  bookstack: SvgBookstack,
  box: SvgBox,
  braintrust: SvgBraintrust,
  canvas: SvgCanvas,
  clickup: SvgClickup,
  coda: SvgCoda,
  confluence: SvgConfluence,
  discord: SvgDiscord,
  discourse: SvgDiscourse,
  document360: SvgDocument360,
  dropbox: SvgDropbox,
  drupal_wiki: SvgDrupal,
  egnyte: SvgEgnyte,
  file: SvgFile,
  fireflies: SvgFireflies,
  freshdesk: SvgFreshdesk,
  gitbook: SvgGitbook,
  github: SvgGithub,
  gitlab: SvgGitlab,
  gmail: SvgGmail,
  gong: SvgGong,
  google_cloud_storage: SvgGoogleCloud,
  google_drive: SvgGoogleDrive,
  google_sites: SvgGoogleSites,
  guru: SvgGuru,
  highspot: SvgHighspot,
  hubspot: SvgHubspot,
  imap: SvgOutlook,
  jira: SvgJira,
  linear: SvgLinear,
  loopio: SvgLoopio,
  lumapps: SvgLumapps,
  mediawiki: SvgMediawiki,
  notion: SvgNotion,
  oci_storage: SvgOracle,
  outline: SvgOutline,
  productboard: SvgProductboard,
  r2: SvgCloudflare,
  s3: SvgAws,
  salesforce: SvgSalesforce,
  sharepoint: SvgSharepoint,
  slab: SvgSlab,
  slack: SvgSlack,
  teams: SvgTeams,
  testrail: SvgTestrail,
  web: SvgWeb,
  wikipedia: SvgWikipedia,
  xenforo: SvgXenforo,
  zendesk: SvgZendesk,
  zulip: SvgZulip,
};

/**
 * Official vendor mark for an Admin Connectors tile or wizard header.
 */
export function SourceLogo({
  sourceId,
  size = "md",
}: {
  sourceId: string;
  size?: "sm" | "md" | "lg";
}) {
  const Logo = LOGOS[sourceId] ?? SvgFile;
  const px = size === "lg" ? 40 : size === "sm" ? 24 : 36;
  const box = size === "lg" ? "h-14 w-14" : size === "sm" ? "h-9 w-9" : "h-12 w-12";

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-2xl border border-gray-100 bg-white",
        box
      )}
      aria-hidden
    >
      <Logo size={px} />
    </div>
  );
}

/**
 * True when this catalog source has a dedicated vendor mark.
 */
export function hasSourceLogo(sourceId: string): boolean {
  return Object.prototype.hasOwnProperty.call(LOGOS, sourceId);
}
