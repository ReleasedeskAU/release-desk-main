"use client";

import { useMemo, useState } from "react";
import { Loader2, RefreshCw, X } from "lucide-react";
import {
  CONNECTOR_TYPES,
  POLL_INTERVAL_OPTIONS,
  getConnectorTypeDef,
  type ConnectorTypeId,
} from "@/lib/connectors/types";
import {
  CONNECTOR_DATA_TYPES,
  dataTypesFromConfig,
  defaultDataTypesForType,
} from "@/lib/connectorDataTypes";
import { indexingStartForRange, type JiraIndexingRangeId } from "@/lib/jira/project-keys";
import { groupGithubReposByOwner } from "@/lib/github/repos";
import { groupBitbucketReposByWorkspace } from "@/lib/bitbucket/repos";
import { parseAllowedSenders } from "@/lib/imap/allowed-senders";
import type { ImapFolderOption } from "@/lib/imap/mailboxes";
import type { GithubRepoOption } from "@/lib/github/projects";
import type { JiraProjectOption } from "@/lib/jira/projects";
import type { ConnectorTableRow } from "@/lib/staffless/map-indexing-status";
import { ConnectorTypeIcon } from "./ConnectorTypeIcon";
import { GithubRepoPicker } from "./GithubRepoPicker";
import { ImapFolderPicker } from "./ImapFolderPicker";
import { JiraProjectPicker } from "./JiraProjectPicker";

function typeLabel(type: string): string {
  return getConnectorTypeDef(type)?.label ?? type;
}

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  return body.error ?? body.message ?? `Request failed (${res.status})`;
}

function initialGithubRepos(config: Record<string, unknown>): string[] {
  if (Array.isArray(config.repos)) {
    return config.repos.filter((v): v is string => typeof v === "string");
  }
  if (typeof config.repo === "string" && config.repo.includes("/")) return [config.repo.trim()];
  return [];
}

function initialGitlabProjects(config: Record<string, unknown>): string[] {
  if (Array.isArray(config.projects)) {
    return config.projects.filter((v): v is string => typeof v === "string" && v.includes("/"));
  }
  if (typeof config.projects === "string" && config.projects.trim()) {
    return config.projects.split(",").map((part) => part.trim()).filter((part) => part.includes("/"));
  }
  const owner = typeof config.projectOwner === "string" ? config.projectOwner.trim() : "";
  const name = typeof config.projectName === "string" ? config.projectName.trim() : "";
  if (owner && name) return [`${owner}/${name}`];
  return [];
}

function initialBitbucketRepos(config: Record<string, unknown>): string[] {
  if (Array.isArray(config.repos)) {
    return config.repos.filter((v): v is string => typeof v === "string");
  }
  const workspace = typeof config.workspace === "string" ? config.workspace.trim() : "";
  const slugs = typeof config.repositories === "string" ? config.repositories : "";
  if (workspace && slugs.trim()) {
    return slugs
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((slug) => (slug.includes("/") ? slug : `${workspace}/${slug}`));
  }
  return [];
}

function initialImapFolders(config: Record<string, unknown>): string[] {
  if (Array.isArray(config.mailboxes)) {
    return config.mailboxes.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  }
  if (typeof config.mailboxes === "string" && config.mailboxes.trim()) {
    return config.mailboxes.split(",").map((part) => part.trim()).filter(Boolean);
  }
  return [];
}

function initialImapAllowedSenders(config: Record<string, unknown>): string {
  if (typeof config.allowedSenders === "string") return config.allowedSenders;
  if (typeof config.allowed_senders === "string") return config.allowed_senders;
  if (Array.isArray(config.allowedSenders)) {
    return config.allowedSenders.filter((v): v is string => typeof v === "string").join("\n");
  }
  return "";
}

function initialJiraKeys(config: Record<string, unknown>): string[] {
  if (Array.isArray(config.projectKeys)) {
    return config.projectKeys.filter((v): v is string => typeof v === "string");
  }
  if (typeof config.projectKey === "string" && config.projectKey.trim()) return [config.projectKey.trim().toUpperCase()];
  return [];
}

/**
 * Create or edit Jira, GitHub, GitLab, Bitbucket, Teams, or IMAP. Create posts to /api/connectors
 * (engine credential + connector + pair). `initialType` skips the type picker
 * when opened from an Admin Connectors tile.
 */
export function ConnectorWizard({
  mode,
  existingConnector,
  initialType,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  existingConnector: ConnectorTableRow | null;
  initialType?: ConnectorTypeId;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = mode === "edit" && existingConnector != null;
  const lockedCreateType = !isEdit && initialType != null;
  const hideTypeStep = isEdit || lockedCreateType;
  const existingConfig = (existingConnector?.config ?? {}) as Record<string, unknown>;

  const [step, setStep] = useState(hideTypeStep ? 2 : 1);
  const [selectedType, setSelectedType] = useState<ConnectorTypeId | null>(
    (existingConnector?.type as ConnectorTypeId) ?? initialType ?? null
  );
  const [name, setName] = useState(existingConnector?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(
    existingConnector?.baseUrl ?? (initialType === "gitlab" ? "https://gitlab.com" : "")
  );
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [replaceCredentials, setReplaceCredentials] = useState(!isEdit);
  const [config, setConfig] = useState<Record<string, string>>(() => {
    const fields: Record<string, string> = {};
    if (existingConnector) {
      getConnectorTypeDef(existingConnector.type)?.configFields.forEach((f) => {
        const v = existingConfig[f.key];
        if (v != null) fields[f.key] = String(v);
      });
    }
    return fields;
  });
  const [dataTypes, setDataTypes] = useState<string[]>(() =>
    existingConnector
      ? dataTypesFromConfig(existingConnector.type, existingConfig)
      : initialType
        ? defaultDataTypesForType(initialType)
        : []
  );
  const [dataTypesError, setDataTypesError] = useState<string | null>(null);
  const [pollInterval, setPollInterval] = useState(
    existingConnector?.pollInterval ??
      (initialType ? getConnectorTypeDef(initialType)?.defaultPollInterval : undefined) ??
      15
  );
  const [fieldCheck, setFieldCheck] = useState<{ ok: boolean; message?: string } | null>(
    isEdit ? { ok: true } : null
  );
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [jiraProjects, setJiraProjects] = useState<JiraProjectOption[]>([]);
  const [jiraLoading, setJiraLoading] = useState(false);
  const [jiraError, setJiraError] = useState<string | null>(null);
  const [jiraFilter, setJiraFilter] = useState("");
  const [allJiraProjects, setAllJiraProjects] = useState(existingConfig.allProjects === true);
  const [selectedJiraKeys, setSelectedJiraKeys] = useState<string[]>(() => initialJiraKeys(existingConfig));
  const [jiraRange, setJiraRange] = useState<JiraIndexingRangeId>("all");
  const [githubRepos, setGithubRepos] = useState<GithubRepoOption[]>([]);
  const [githubLoading, setGithubLoading] = useState(false);
  const [githubError, setGithubError] = useState<string | null>(null);
  const [githubFilter, setGithubFilter] = useState("");
  const [allGithubRepos, setAllGithubRepos] = useState(existingConfig.allRepos === true);
  const [selectedGithubRepos, setSelectedGithubRepos] = useState<string[]>(() => initialGithubRepos(existingConfig));
  const [githubRange, setGithubRange] = useState<JiraIndexingRangeId>("6m");
  const [gitlabProjects, setGitlabProjects] = useState<GithubRepoOption[]>([]);
  const [gitlabLoading, setGitlabLoading] = useState(false);
  const [gitlabError, setGitlabError] = useState<string | null>(null);
  const [gitlabFilter, setGitlabFilter] = useState("");
  const [selectedGitlabProjects, setSelectedGitlabProjects] = useState<string[]>(() =>
    initialGitlabProjects(existingConfig)
  );
  const [bitbucketRepos, setBitbucketRepos] = useState<GithubRepoOption[]>([]);
  const [bitbucketLoading, setBitbucketLoading] = useState(false);
  const [bitbucketError, setBitbucketError] = useState<string | null>(null);
  const [bitbucketFilter, setBitbucketFilter] = useState("");
  const [allBitbucketRepos, setAllBitbucketRepos] = useState(existingConfig.allRepos === true && existingConnector?.type === "bitbucket");
  const [selectedBitbucketRepos, setSelectedBitbucketRepos] = useState<string[]>(() =>
    initialBitbucketRepos(existingConfig)
  );
  const [imapFolders, setImapFolders] = useState<ImapFolderOption[]>([]);
  const [imapLoading, setImapLoading] = useState(false);
  const [imapError, setImapError] = useState<string | null>(null);
  const [imapFilter, setImapFilter] = useState("");
  const [selectedImapFolders, setSelectedImapFolders] = useState<string[]>(() => initialImapFolders(existingConfig));
  const [imapRange, setImapRange] = useState<JiraIndexingRangeId>("6m");
  const [mailboxKind, setMailboxKind] = useState<"shared" | "personal">("shared");
  const [privacyAck, setPrivacyAck] = useState(isEdit);
  const [imapAllowedSenders, setImapAllowedSenders] = useState(() => initialImapAllowedSenders(existingConfig));
  const [imapSenderError, setImapSenderError] = useState<string | null>(null);

  const typeDef = useMemo(() => (selectedType ? getConnectorTypeDef(selectedType) : undefined), [selectedType]);
  const isJira = typeDef?.id === "jira";
  const isGitHub = typeDef?.id === "github";
  const isGitlab = typeDef?.id === "gitlab";
  const isBitbucket = typeDef?.id === "bitbucket";
  const isImap = typeDef?.id === "imap";
  const hasSourcePicker = isJira || isGitHub || isGitlab || isBitbucket || isImap;
  const dataTypeOptions = selectedType ? CONNECTOR_DATA_TYPES[selectedType] ?? [] : [];
  const totalSteps = hasSourcePicker ? 4 : 3;

  const canProceedStep2 = useMemo(() => {
    if (!name.trim()) return false;
    const configFilled = typeDef?.configFields.every((f) => f.optional || config[f.key]?.trim()) ?? true;
    if (isJira && !baseUrl.trim()) return false;
    if (isGitlab && (!isEdit || replaceCredentials) && !baseUrl.trim()) return false;
    if (isImap && (!mailboxKind || !privacyAck)) return false;
    if (!isEdit || replaceCredentials) {
      const credsFilled = typeDef?.credentialFields.every((f) => credentials[f.key]?.trim());
      return Boolean(fieldCheck?.ok && credsFilled && configFilled);
    }
    return configFilled;
  }, [name, baseUrl, isEdit, isJira, isGitlab, isImap, mailboxKind, privacyAck, replaceCredentials, typeDef, credentials, config, fieldCheck]);

  const canProceedJiraProjects = allJiraProjects || selectedJiraKeys.length > 0;
  const githubOwners = new Set(selectedGithubRepos.map((full) => full.split("/")[0]).filter(Boolean));
  const githubSingleOwner = githubOwners.size === 1 ? [...githubOwners][0] : null;
  const canProceedGithubRepos = allGithubRepos
    ? Boolean(githubSingleOwner || (typeof existingConfig.repoOwner === "string" && existingConfig.repoOwner))
    : selectedGithubRepos.length > 0;
  const canProceedGitlabProjects = selectedGitlabProjects.length > 0;
  const bitbucketWorkspaces = new Set(selectedBitbucketRepos.map((full) => full.split("/")[0]).filter(Boolean));
  const bitbucketSingleWorkspace =
    bitbucketWorkspaces.size === 1
      ? [...bitbucketWorkspaces][0]
      : typeof existingConfig.workspace === "string"
        ? existingConfig.workspace
        : null;
  const canProceedBitbucketRepos = allBitbucketRepos
    ? Boolean(bitbucketSingleWorkspace)
    : selectedBitbucketRepos.length > 0;
  const imapSenderCount = (() => {
    try {
      return parseAllowedSenders(imapAllowedSenders).length;
    } catch {
      return -1;
    }
  })();
  const canProceedImapFolders =
    selectedImapFolders.length > 0 &&
    imapSenderCount >= 0 &&
    (mailboxKind !== "personal" || imapSenderCount > 0);

  const checkFields = async () => {
    if (!typeDef) return;
    setChecking(true);
    setFieldCheck(null);
    try {
      if (isEdit && !replaceCredentials) {
        setFieldCheck({ ok: true, message: "Saved credentials will be kept. StaffLess verifies them on Sync Now." });
        return;
      }
      const res = await fetch("/api/connectors/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: typeDef.id,
          authType: typeDef.authType,
          baseUrl: baseUrl || undefined,
          credentials,
          config: isJira
            ? { allProjects: true }
            : isGitHub
              ? { allRepos: true, repoOwner: "n" }
              : isGitlab
                ? { projects: ["check/fields"] }
                : isBitbucket
                  ? { repos: ["n/n"] }
                  : isImap
                    ? { ...config, mailboxes: ["INBOX"] }
                    : { ...config, dataTypes },
        }),
      });
      const body = (await res.json()) as { ok?: boolean; message?: string };
      setFieldCheck({
        ok: body.ok === true,
        message: body.message ?? (body.ok ? "Fields look valid." : "Check the required fields."),
      });
    } catch {
      setFieldCheck({ ok: false, message: "Could not check fields. Try again." });
    } finally {
      setChecking(false);
    }
  };

  const loadJiraProjects = async () => {
    setJiraLoading(true);
    setJiraError(null);
    try {
      const res = await fetch("/api/connectors/jira/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl,
          email: credentials.email,
          apiToken: credentials.apiToken,
        }),
      });
      const body = (await res.json()) as { projects?: JiraProjectOption[]; error?: string };
      if (!res.ok) {
        setJiraError(body.error ?? "Could not load Jira projects");
        setJiraProjects([]);
        return;
      }
      setJiraProjects(body.projects ?? []);
    } catch {
      setJiraError("Could not load Jira projects");
      setJiraProjects([]);
    } finally {
      setJiraLoading(false);
    }
  };

  const loadGithubRepos = async () => {
    setGithubLoading(true);
    setGithubError(null);
    try {
      const res = await fetch("/api/connectors/github/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: credentials.token }),
      });
      const body = (await res.json()) as { repos?: GithubRepoOption[]; error?: string };
      if (!res.ok) {
        setGithubError(body.error ?? "Could not load GitHub repositories");
        setGithubRepos([]);
        return;
      }
      setGithubRepos(body.repos ?? []);
    } catch {
      setGithubError("Could not load GitHub repositories");
      setGithubRepos([]);
    } finally {
      setGithubLoading(false);
    }
  };

  const loadGitlabProjects = async () => {
    setGitlabLoading(true);
    setGitlabError(null);
    try {
      const res = await fetch("/api/connectors/gitlab/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl, token: credentials.token }),
      });
      const body = (await res.json()) as { projects?: GithubRepoOption[]; error?: string };
      if (!res.ok) {
        setGitlabError(body.error ?? "Could not load GitLab projects");
        setGitlabProjects([]);
        return;
      }
      setGitlabProjects(body.projects ?? []);
    } catch {
      setGitlabError("Could not load GitLab projects");
      setGitlabProjects([]);
    } finally {
      setGitlabLoading(false);
    }
  };

  const loadBitbucketRepos = async () => {
    setBitbucketLoading(true);
    setBitbucketError(null);
    try {
      const res = await fetch("/api/connectors/bitbucket/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: credentials.email, token: credentials.token }),
      });
      const body = (await res.json()) as { repos?: GithubRepoOption[]; error?: string };
      if (!res.ok) {
        setBitbucketError(body.error ?? "Could not load Bitbucket repositories");
        setBitbucketRepos([]);
        return;
      }
      setBitbucketRepos(body.repos ?? []);
    } catch {
      setBitbucketError("Could not load Bitbucket repositories");
      setBitbucketRepos([]);
    } finally {
      setBitbucketLoading(false);
    }
  };

  const loadImapFolders = async () => {
    setImapLoading(true);
    setImapError(null);
    try {
      const portRaw = config.port?.trim();
      const res = await fetch("/api/connectors/imap/mailboxes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host: config.host,
          port: portRaw ? Number(portRaw) : 993,
          username: credentials.imap_username,
          password: credentials.imap_password,
        }),
      });
      const body = (await res.json()) as { folders?: ImapFolderOption[]; error?: string };
      if (!res.ok) {
        setImapError(body.error ?? "Could not load IMAP folders");
        setImapFolders([]);
        return;
      }
      setImapFolders(body.folders ?? []);
    } catch {
      setImapError("Could not load IMAP folders");
      setImapFolders([]);
    } finally {
      setImapLoading(false);
    }
  };

  const save = async () => {
    if (!typeDef || !name.trim()) return;
    if (isJira && !allJiraProjects && selectedJiraKeys.length === 0) {
      setJiraError("Select at least one project, or choose every project this account can see");
      return;
    }
    if (isGitHub && !allGithubRepos && selectedGithubRepos.length === 0) {
      setGithubError("Select at least one repository, or choose every repository for one owner");
      return;
    }
    if (isGitlab && selectedGitlabProjects.length === 0) {
      setGitlabError("Select at least one project");
      return;
    }
    if (isBitbucket && !allBitbucketRepos && selectedBitbucketRepos.length === 0) {
      setBitbucketError("Select at least one repository, or choose every repository in one workspace");
      return;
    }
    if (isImap && selectedImapFolders.length === 0) {
      setImapError("Select at least one folder. We never copy the whole mailbox.");
      return;
    }
    if (isImap) {
      try {
        const senders = parseAllowedSenders(imapAllowedSenders);
        if (mailboxKind === "personal" && senders.length === 0) {
          setImapSenderError("A personal mailbox needs at least one approved sender or domain");
          return;
        }
      } catch (err) {
        setImapSenderError(err instanceof Error ? err.message : "Approved senders are not valid");
        return;
      }
    }
    setImapSenderError(null);
    if (dataTypeOptions.length > 0 && dataTypes.length === 0) {
      setDataTypesError("Select at least one item to index");
      return;
    }
    setDataTypesError(null);
    setSaving(true);
    try {
      const jiraConfig = isJira
        ? allJiraProjects
          ? { allProjects: true }
          : { projectKeys: selectedJiraKeys }
        : {};
      const githubOwner =
        githubSingleOwner || (typeof existingConfig.repoOwner === "string" ? existingConfig.repoOwner : "");
      const githubConfig = isGitHub
        ? allGithubRepos && githubOwner
          ? { allRepos: true, repoOwner: githubOwner }
          : { repos: selectedGithubRepos }
        : {};
      const gitlabConfig = isGitlab ? { projects: selectedGitlabProjects } : {};
      const bitbucketOwner =
        bitbucketSingleWorkspace || (typeof existingConfig.workspace === "string" ? existingConfig.workspace : "");
      const bitbucketConfig = isBitbucket
        ? allBitbucketRepos && bitbucketOwner
          ? { allRepos: true, workspace: bitbucketOwner }
          : { repos: selectedBitbucketRepos }
        : {};
      const imapConfig = isImap
        ? {
            host: config.host,
            port: config.port,
            mailboxes: selectedImapFolders,
            allowedSenders: imapAllowedSenders,
          }
        : {};
      const payload: Record<string, unknown> = {
        name: name.trim(),
        baseUrl: baseUrl || undefined,
        config: {
          ...config,
          ...jiraConfig,
          ...githubConfig,
          ...gitlabConfig,
          ...bitbucketConfig,
          ...imapConfig,
          ...(dataTypeOptions.length > 0 ? { dataTypes } : {}),
        },
        pollInterval,
      };
      if ((isJira || isGitHub || isGitlab || isBitbucket || isImap) && !isEdit) {
        payload.indexingStart = indexingStartForRange(
          isGitHub || isGitlab || isBitbucket ? githubRange : isImap ? imapRange : jiraRange
        );
      }
      if (isEdit && existingConnector) {
        const body: Record<string, unknown> = { ...payload };
        if (replaceCredentials && Object.keys(credentials).length > 0) {
          body.credentials = credentials;
        }
        const res = await fetch(`/api/connectors/${existingConnector.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          alert(await readError(res));
          return;
        }
      } else if (isGitHub) {
        const groups =
          allGithubRepos && githubOwner
            ? [{ owner: githubOwner, names: [] as string[], allRepos: true }]
            : groupGithubReposByOwner(selectedGithubRepos);
        for (const group of groups) {
          const groupConfig = group.allRepos
            ? { allRepos: true, repoOwner: group.owner, dataTypes }
            : { repos: group.names.map((repoName) => `${group.owner}/${repoName}`), dataTypes };
          const res = await fetch("/api/connectors", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: groups.length > 1 ? `${name.trim()} (${group.owner})` : name.trim(),
              type: typeDef.id,
              authType: typeDef.authType,
              credentials,
              config: groupConfig,
              pollInterval,
              indexingStart: indexingStartForRange(githubRange),
            }),
          });
          if (!res.ok) {
            alert(await readError(res));
            return;
          }
        }
      } else if (isBitbucket) {
        const groups =
          allBitbucketRepos && bitbucketOwner
            ? [{ workspace: bitbucketOwner, names: [] as string[], allRepos: true }]
            : groupBitbucketReposByWorkspace(selectedBitbucketRepos);
        for (const group of groups) {
          const groupConfig = group.allRepos
            ? { allRepos: true, workspace: group.workspace, dataTypes }
            : { repos: group.names.map((repoName) => `${group.workspace}/${repoName}`), dataTypes };
          const res = await fetch("/api/connectors", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: groups.length > 1 ? `${name.trim()} (${group.workspace})` : name.trim(),
              type: typeDef.id,
              authType: typeDef.authType,
              credentials,
              config: groupConfig,
              pollInterval,
              indexingStart: indexingStartForRange(githubRange),
            }),
          });
          if (!res.ok) {
            alert(await readError(res));
            return;
          }
        }
      } else {
        const res = await fetch("/api/connectors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, type: typeDef.id, authType: typeDef.authType, credentials }),
        });
        if (!res.ok) {
          alert(await readError(res));
          return;
        }
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const stepLabel = `Step ${hideTypeStep ? step - 1 : step} of ${hideTypeStep ? totalSteps - 1 : totalSteps}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">
              {isEdit
                ? `Edit Connector — ${existingConnector?.name}`
                : lockedCreateType && typeDef
                  ? `Add ${typeDef.label}`
                  : "Add Connector"}
            </h2>
            <p className="text-sm text-gray-500">{stepLabel}</p>
          </div>
          <button type="button" onClick={onClose}>
            <X className="h-5 w-5 text-gray-400" />
          </button>
        </div>

        <div className="p-6">
          {(isEdit || lockedCreateType) && selectedType && (
            <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 flex items-center gap-3">
              <ConnectorTypeIcon type={selectedType} />
              <div>
                <p className="text-xs font-semibold uppercase text-gray-500">Source type (locked)</p>
                <p className="font-semibold text-gray-900">{typeLabel(selectedType)}</p>
              </div>
            </div>
          )}

          {step === 1 && !hideTypeStep && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {CONNECTOR_TYPES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setSelectedType(t.id);
                    setPollInterval(t.defaultPollInterval);
                    setDataTypes(defaultDataTypesForType(t.id));
                    if (t.id === "gitlab") setBaseUrl((prev) => prev.trim() || "https://gitlab.com");
                    setStep(2);
                  }}
                  className="rounded-xl border border-gray-200 p-4 text-left hover:border-[#2548C9] hover:bg-blue-50/30"
                >
                  <ConnectorTypeIcon type={t.id} />
                  <p className="mt-3 font-bold text-gray-900">{t.label}</p>
                </button>
              ))}
            </div>
          )}

          {step === 2 && typeDef && (
            <div className="space-y-4">
              {typeDef.setupHint ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 leading-relaxed">
                  {typeDef.setupHint}
                </div>
              ) : null}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Display name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={`e.g. Prod ${typeDef.label}`}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              {isJira && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Jira site URL</label>
                  <input
                    value={baseUrl}
                    onChange={(e) => {
                      setBaseUrl(e.target.value);
                      setFieldCheck(null);
                    }}
                    placeholder="https://your-org.atlassian.net"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Site origin only, like https://your-org.atlassian.net. Use https. Do not put a username in the URL.
                  </p>
                </div>
              )}
              {isGitlab && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">GitLab URL</label>
                  <input
                    value={baseUrl}
                    onChange={(e) => {
                      setBaseUrl(e.target.value);
                      setFieldCheck(null);
                    }}
                    placeholder="https://gitlab.com"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Site origin only, like https://gitlab.com. Use https. Do not put a username in the URL.
                  </p>
                </div>
              )}
              {isEdit && !replaceCredentials && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
                  Credentials stay in StaffLess.{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setReplaceCredentials(true);
                      setCredentials({});
                      setFieldCheck(null);
                    }}
                    className="font-semibold text-[#2548C9] hover:underline"
                  >
                    Replace credentials
                  </button>
                </div>
              )}
              {(!isEdit || replaceCredentials) &&
                typeDef.credentialFields.map((field) => (
                  <div key={field.key}>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">{field.label}</label>
                    <input
                      type={field.type === "password" ? "password" : "text"}
                      value={credentials[field.key] ?? ""}
                      onChange={(e) => {
                        setCredentials((prev) => ({ ...prev, [field.key]: e.target.value }));
                        setFieldCheck(null);
                      }}
                      placeholder={field.placeholder}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                    {field.help ? <p className="text-xs text-gray-500 mt-1">{field.help}</p> : null}
                  </div>
                ))}
              {typeDef.configFields.map((field) => (
                <div key={field.key}>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">{field.label}</label>
                  <input
                    value={config[field.key] ?? ""}
                    onChange={(e) => {
                      setConfig((prev) => ({ ...prev, [field.key]: e.target.value }));
                      setFieldCheck(null);
                    }}
                    placeholder={field.placeholder}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                  {field.help ? <p className="text-xs text-gray-500 mt-1">{field.help}</p> : null}
                </div>
              ))}
              {isImap && (
                <div className="space-y-3 rounded-lg border border-gray-200 p-3">
                  <p className="text-sm font-semibold text-gray-800">What kind of mailbox is this?</p>
                  <label className="flex items-start gap-2 text-sm text-gray-800">
                    <input
                      type="radio"
                      name="mailbox-kind"
                      checked={mailboxKind === "shared"}
                      onChange={() => setMailboxKind("shared")}
                    />
                    <span>
                      Shared or team mailbox (recommended)
                      <span className="block text-xs text-gray-600">
                        Company-owned addresses such as releases@ or cab-notifications@ — work mail only, by design.
                      </span>
                    </span>
                  </label>
                  <label className="flex items-start gap-2 text-sm text-gray-800">
                    <input
                      type="radio"
                      name="mailbox-kind"
                      checked={mailboxKind === "personal"}
                      onChange={() => setMailboxKind("personal")}
                    />
                    <span>
                      Personal mailbox
                      <span className="block text-xs text-amber-900">
                        Personal inboxes mix work and private mail. You must pick folders and an approved sender list.
                        We still cannot promise private mail in those folders stays out.
                      </span>
                    </span>
                  </label>
                  <label className="flex items-start gap-2 text-sm text-gray-800">
                    <input type="checkbox" checked={privacyAck} onChange={(e) => setPrivacyAck(e.target.checked)} />
                    <span>
                      I understand StaffLess will read and store the full body of messages in the folders I pick, and
                      people who can use Ask may see that content.
                    </span>
                  </label>
                </div>
              )}
              {(!isEdit || replaceCredentials) && (
                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={checkFields}
                    disabled={checking}
                    className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold hover:bg-gray-50"
                  >
                    {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    Check fields
                  </button>
                  {fieldCheck && (
                    <span className={`text-sm font-semibold ${fieldCheck.ok ? "text-green-700" : "text-red-700"}`}>
                      {fieldCheck.ok ? fieldCheck.message ?? "Fields look valid." : fieldCheck.message}
                    </span>
                  )}
                </div>
              )}
              <p className="text-xs text-gray-500">
                {isJira
                  ? "We check the site URL, Atlassian account email, and API token with Jira when you click Check fields. Wrong URL, email, or token cannot continue. Next we ask Jira for the real project list."
                  : isGitHub
                    ? "We check this token with GitHub when you click Check fields. Invalid, revoked, or tokens missing repo / Contents: Read cannot continue."
                    : isGitlab
                      ? "We check the GitLab URL and token when you click Check fields. Invalid or revoked tokens cannot continue. Next we load the live project list."
                      : isBitbucket
                        ? "We check the Atlassian account email and API token with Bitbucket when you click Check fields. Next we load the live repository list."
                        : isImap
                          ? "Next we ask the mailbox for its folder list. You must pick folders — there is no whole-inbox option."
                          : "StaffLess has no separate connection-test API. Credentials are verified on the next Sync Now."}
              </p>
              <div className="flex justify-between pt-4">
                {!hideTypeStep ? (
                  <button type="button" onClick={() => setStep(1)} className="text-sm text-gray-600 hover:underline">
                    Back
                  </button>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  disabled={!canProceedStep2}
                  onClick={() => {
                    setStep(3);
                    if (
                      isJira &&
                      jiraProjects.length === 0 &&
                      baseUrl.trim() &&
                      credentials.email?.trim() &&
                      credentials.apiToken?.trim()
                    ) {
                      void loadJiraProjects();
                    }
                    if (isGitHub && githubRepos.length === 0 && credentials.token?.trim()) {
                      void loadGithubRepos();
                    }
                    if (isGitlab && gitlabProjects.length === 0 && credentials.token?.trim() && baseUrl.trim()) {
                      void loadGitlabProjects();
                    }
                    if (
                      isBitbucket &&
                      bitbucketRepos.length === 0 &&
                      credentials.email?.trim() &&
                      credentials.token?.trim()
                    ) {
                      void loadBitbucketRepos();
                    }
                    if (
                      isImap &&
                      imapFolders.length === 0 &&
                      credentials.imap_username?.trim() &&
                      credentials.imap_password &&
                      config.host?.trim()
                    ) {
                      void loadImapFolders();
                    }
                  }}
                  className="rounded-lg bg-[#2548C9] px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {step === 3 && isGitHub && (
            <div className="space-y-4">
              <GithubRepoPicker
                repos={githubRepos}
                loading={githubLoading}
                error={githubError}
                filter={githubFilter}
                onFilter={setGithubFilter}
                allRepos={allGithubRepos}
                allReposOwner={githubSingleOwner || (typeof existingConfig.repoOwner === "string" ? existingConfig.repoOwner : null)}
                selectedFullNames={selectedGithubRepos}
                onToggleAllRepos={(value) => {
                  setAllGithubRepos(value);
                  if (value) {
                    const owner =
                      githubSingleOwner || (typeof existingConfig.repoOwner === "string" ? existingConfig.repoOwner : "");
                    if (owner) {
                      setSelectedGithubRepos((prev) => prev.filter((full) => full.startsWith(`${owner}/`)));
                    }
                  }
                }}
                onToggleRepo={(fullName, checked) => {
                  setAllGithubRepos(false);
                  setSelectedGithubRepos((prev) =>
                    checked ? (prev.includes(fullName) ? prev : [...prev, fullName]) : prev.filter((n) => n !== fullName)
                  );
                }}
                onReload={loadGithubRepos}
                canReload={Boolean(credentials.token?.trim())}
              />
              {isEdit && !replaceCredentials && (
                <p className="text-xs text-gray-500">
                  Enter credentials again (Replace credentials) to load the live list. Until then you can keep the
                  repositories already saved on this connector.
                </p>
              )}
              <div className="flex justify-between pt-4">
                <button type="button" onClick={() => setStep(2)} className="text-sm text-gray-600 hover:underline">
                  Back
                </button>
                <button
                  type="button"
                  disabled={!canProceedGithubRepos}
                  onClick={() => setStep(4)}
                  className="rounded-lg bg-[#2548C9] px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {step === 3 && isGitlab && (
            <div className="space-y-4">
              <GithubRepoPicker
                repos={gitlabProjects}
                loading={gitlabLoading}
                error={gitlabError}
                filter={gitlabFilter}
                onFilter={setGitlabFilter}
                allRepos={false}
                allReposOwner={null}
                selectedFullNames={selectedGitlabProjects}
                hideAllOption
                heading="Which GitLab projects should we copy?"
                loadLabel="Load projects"
                loadingLabel="Asking GitLab for the project list…"
                emptyLabel="No projects loaded yet. Click Load projects."
                selectedHint={(count) =>
                  `${count} selected — one connector covers them.`
                }
                onToggleAllRepos={() => undefined}
                onToggleRepo={(fullName, checked) => {
                  setSelectedGitlabProjects((prev) =>
                    checked ? (prev.includes(fullName) ? prev : [...prev, fullName]) : prev.filter((n) => n !== fullName)
                  );
                }}
                onReload={loadGitlabProjects}
                canReload={Boolean(baseUrl.trim() && credentials.token?.trim())}
              />
              {isEdit && !replaceCredentials && (
                <p className="text-xs text-gray-500">
                  Enter credentials again (Replace credentials) to load the live list. Until then you can keep the
                  projects already saved on this connector.
                </p>
              )}
              <div className="flex justify-between pt-4">
                <button type="button" onClick={() => setStep(2)} className="text-sm text-gray-600 hover:underline">
                  Back
                </button>
                <button
                  type="button"
                  disabled={!canProceedGitlabProjects}
                  onClick={() => setStep(4)}
                  className="rounded-lg bg-[#2548C9] px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {step === 3 && isBitbucket && (
            <div className="space-y-4">
              <GithubRepoPicker
                repos={bitbucketRepos}
                loading={bitbucketLoading}
                error={bitbucketError}
                filter={bitbucketFilter}
                onFilter={setBitbucketFilter}
                allRepos={allBitbucketRepos}
                allReposOwner={bitbucketSingleWorkspace}
                selectedFullNames={selectedBitbucketRepos}
                heading="Which Bitbucket repositories should we copy?"
                loadLabel="Load repositories"
                loadingLabel="Asking Bitbucket for the repository list…"
                emptyLabel="No repositories loaded yet. Click Load repositories."
                allCheckedLabel={(workspace) => `Every repository in ${workspace}`}
                allDisabledHint="Select repositories from one workspace to copy every repo in that workspace"
                selectedHint={(count, ownerCount) =>
                  `${count} selected${
                    ownerCount > 1
                      ? ` across ${ownerCount} workspaces — one connector is created per workspace.`
                      : " — one connector covers them."
                  }`
                }
                onToggleAllRepos={(value) => {
                  setAllBitbucketRepos(value);
                  if (value && bitbucketSingleWorkspace) {
                    setSelectedBitbucketRepos((prev) =>
                      prev.filter((full) => full.startsWith(`${bitbucketSingleWorkspace}/`))
                    );
                  }
                }}
                onToggleRepo={(fullName, checked) => {
                  setAllBitbucketRepos(false);
                  setSelectedBitbucketRepos((prev) =>
                    checked ? (prev.includes(fullName) ? prev : [...prev, fullName]) : prev.filter((n) => n !== fullName)
                  );
                }}
                onReload={loadBitbucketRepos}
                canReload={Boolean(credentials.email?.trim() && credentials.token?.trim())}
              />
              {isEdit && !replaceCredentials && (
                <p className="text-xs text-gray-500">
                  Enter credentials again (Replace credentials) to load the live list. Until then you can keep the
                  repositories already saved on this connector.
                </p>
              )}
              <div className="flex justify-between pt-4">
                <button type="button" onClick={() => setStep(2)} className="text-sm text-gray-600 hover:underline">
                  Back
                </button>
                <button
                  type="button"
                  disabled={!canProceedBitbucketRepos}
                  onClick={() => setStep(4)}
                  className="rounded-lg bg-[#2548C9] px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {step === 3 && isJira && (
            <div className="space-y-4">
              <JiraProjectPicker
                projects={jiraProjects}
                loading={jiraLoading}
                error={jiraError}
                filter={jiraFilter}
                onFilter={setJiraFilter}
                allProjects={allJiraProjects}
                selectedKeys={selectedJiraKeys}
                onToggleAllProjects={(value) => {
                  setAllJiraProjects(value);
                  if (value) setSelectedJiraKeys([]);
                }}
                onToggleKey={(key, checked) => {
                  setSelectedJiraKeys((prev) =>
                    checked ? (prev.includes(key) ? prev : [...prev, key]) : prev.filter((k) => k !== key)
                  );
                }}
                onReload={loadJiraProjects}
                canReload={Boolean(baseUrl.trim() && credentials.email && credentials.apiToken)}
              />
              {isEdit && !replaceCredentials && (
                <p className="text-xs text-gray-500">
                  Enter credentials again (Replace credentials) to load the live list. Until then you can keep the
                  projects already saved on this connector.
                </p>
              )}
              <div className="flex justify-between pt-4">
                <button type="button" onClick={() => setStep(2)} className="text-sm text-gray-600 hover:underline">
                  Back
                </button>
                <button
                  type="button"
                  disabled={!canProceedJiraProjects}
                  onClick={() => setStep(4)}
                  className="rounded-lg bg-[#2548C9] px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {step === 3 && isImap && (
            <div className="space-y-4">
              <ImapFolderPicker
                folders={imapFolders}
                loading={imapLoading}
                error={imapError}
                filter={imapFilter}
                onFilter={setImapFilter}
                selectedNames={selectedImapFolders}
                onToggleFolder={(name, checked) => {
                  setSelectedImapFolders((prev) =>
                    checked ? (prev.includes(name) ? prev : [...prev, name]) : prev.filter((n) => n !== name)
                  );
                }}
                onReload={loadImapFolders}
                canReload={Boolean(config.host?.trim() && credentials.imap_username && credentials.imap_password)}
              />
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-1">
                  Approved senders or domains{mailboxKind === "personal" ? " (required)" : " (recommended)"}
                </label>
                <p className="text-xs text-gray-600 mb-2">
                  {mailboxKind === "personal"
                    ? "Only mail from these addresses or domains is fetched. Personal mailboxes cannot skip this."
                    : "Optional. Leave blank to index every sender in the folders you picked. Use this to keep sync to known systems such as Jira or CAB tools."}
                </p>
                <textarea
                  value={imapAllowedSenders}
                  onChange={(e) => {
                    setImapAllowedSenders(e.target.value);
                    setImapSenderError(null);
                  }}
                  rows={4}
                  placeholder={"jira@company.com\ncompany.com"}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                {imapSenderError ? <p className="text-sm text-red-700 mt-1">{imapSenderError}</p> : null}
                {mailboxKind === "personal" && imapSenderCount === 0 ? (
                  <p className="text-sm text-red-700 mt-1">Add at least one approved sender or domain</p>
                ) : null}
              </div>
              {isEdit && !replaceCredentials && (
                <p className="text-xs text-gray-500">
                  Enter credentials again (Replace credentials) to load the live list. Until then you can keep the
                  folders already saved on this connector.
                </p>
              )}
              <div className="flex justify-between pt-4">
                <button type="button" onClick={() => setStep(2)} className="text-sm text-gray-600 hover:underline">
                  Back
                </button>
                <button
                  type="button"
                  disabled={!canProceedImapFolders}
                  onClick={() => setStep(4)}
                  className="rounded-lg bg-[#2548C9] px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {((step === 3 && !hasSourcePicker) || (step === 4 && hasSourcePicker)) && typeDef && (
            <div className="space-y-4">
              {hasSourcePicker && !isEdit && (
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-gray-700">How far back should we copy?</label>
                  <p className="text-xs text-gray-500">
                    StaffLess skips items last updated before this date. It is not “created after this date.”
                    {isGitHub || isGitlab || isBitbucket || isImap ? " Default is last 6 months." : ""}
                  </p>
                  {(
                    [
                      ["6m", "Last 6 months"],
                      ["12m", "Last 12 months"],
                      ["all", "All time"],
                    ] as const
                  ).map(([id, label]) => (
                    <label key={id} className="flex items-start gap-2 text-sm text-gray-700">
                      <input
                        type="radio"
                        name="source-range"
                        checked={(isGitHub || isGitlab || isBitbucket ? githubRange : isImap ? imapRange : jiraRange) === id}
                        onChange={() =>
                          isGitHub || isGitlab || isBitbucket
                            ? setGithubRange(id)
                            : isImap
                              ? setImapRange(id)
                              : setJiraRange(id)
                        }
                      />
                      <span>
                        {label}
                        {id !== "6m" ? (
                          <span className="block text-xs text-amber-800">
                            Larger ranges take longer and use more API quota on the first sync.
                          </span>
                        ) : null}
                      </span>
                    </label>
                  ))}
                </div>
              )}
              {dataTypeOptions.length > 0 && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">What should StaffLess index?</label>
                  {dataTypeOptions.map((opt) => (
                    <label key={opt.value} className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={dataTypes.includes(opt.value)}
                        onChange={(e) => {
                          setDataTypesError(null);
                          setDataTypes((prev) =>
                            e.target.checked
                              ? prev.includes(opt.value)
                                ? prev
                                : [...prev, opt.value]
                              : prev.filter((v) => v !== opt.value)
                          );
                        }}
                      />
                      {opt.label}
                    </label>
                  ))}
                  {dataTypesError && <p className="text-sm text-red-600">{dataTypesError}</p>}
                </div>
              )}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">How often should we check for updates?</label>
                <select
                  value={pollInterval}
                  onChange={(e) => setPollInterval(Number(e.target.value))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  {POLL_INTERVAL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex justify-between pt-4">
                <button
                  type="button"
                  onClick={() => setStep(hasSourcePicker ? 3 : 2)}
                  className="text-sm text-gray-600 hover:underline"
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={save}
                  className="rounded-lg bg-[#2548C9] px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
                >
                  {saving ? "Saving…" : isEdit ? "Update Connector" : "Save Connector"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
