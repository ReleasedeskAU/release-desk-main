export function ConnectorTypeIcon({ type }: { type: string }) {
  const colors: Record<string, string> = {
    jira: "bg-[#F4F5F7] text-[#0052CC]",
    gitlab: "bg-[#FC6D26] text-white",
    bitbucket: "bg-[#0052CC] text-white",
    teams: "bg-[#5558AF] text-white",
    imap: "bg-[#0F6CBD] text-white",
    slack: "bg-[#4A154B] text-white",
  };
  const label = type.charAt(0).toUpperCase() || "?";
  return (
    <div
      className={`flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold ${colors[type] ?? "bg-gray-100 text-gray-700"}`}
    >
      {label}
    </div>
  );
}
