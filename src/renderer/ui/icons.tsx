type IconProps = { size?: number };

function Icon({ size = 16, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const PlusIcon = ({ size }: IconProps) => <Icon size={size}><path d="M12 5v14M5 12h14" /></Icon>;
export const CloseIcon = ({ size }: IconProps) => <Icon size={size}><path d="m7 7 10 10M17 7 7 17" /></Icon>;
export const AgentIcon = ({ size }: IconProps) => <Icon size={size}><rect x="5" y="7" width="14" height="11" rx="3" /><path d="M9 12h.01M15 12h.01M9 15h6M12 7V4M9 4h6" /></Icon>;
export const TerminalIcon = ({ size }: IconProps) => <Icon size={size}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3M13 15h4" /></Icon>;
export const FolderIcon = ({ size }: IconProps) => <Icon size={size}><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5z" /></Icon>;
export const SettingsIcon = ({ size }: IconProps) => <Icon size={size}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.15.36.37.68.66.94.3.25.68.4 1.06.4H21v4h-.09a1.7 1.7 0 0 0-1.5.66Z" /></Icon>;
export const SparkIcon = ({ size }: IconProps) => <Icon size={size}><path d="m12 3 1.2 4.1a5 5 0 0 0 3.7 3.7L21 12l-4.1 1.2a5 5 0 0 0-3.7 3.7L12 21l-1.2-4.1a5 5 0 0 0-3.7-3.7L3 12l4.1-1.2a5 5 0 0 0 3.7-3.7z" /></Icon>;
export const SlidersIcon = ({ size }: IconProps) => <Icon size={size}><path d="M4 6h16M4 12h16M4 18h16M8 4v4M16 10v4M10 16v4" /></Icon>;
export const SendIcon = ({ size }: IconProps) => <Icon size={size}><path d="m21 3-7 18-4-7-7-4zM10 14 21 3" /></Icon>;
export const ChevronDownIcon = ({ size }: IconProps) => <Icon size={size}><path d="m7 10 5 5 5-5" /></Icon>;
export const MoreIcon = ({ size }: IconProps) => <Icon size={size}><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></Icon>;
export const TrashIcon = ({ size }: IconProps) => <Icon size={size}><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></Icon>;
export const EditIcon = ({ size }: IconProps) => <Icon size={size}><path d="m4 16-1 5 5-1L19 9l-4-4zM13.5 6.5l4 4" /></Icon>;
export const ChevronRightIcon = ({ size }: IconProps) => <Icon size={size}><path d="m10 7 5 5-5 5" /></Icon>;
export const ChevronUpIcon = ({ size }: IconProps) => <Icon size={size}><path d="m7 14 5-5 5 5" /></Icon>;
export const CheckIcon = ({ size }: IconProps) => <Icon size={size}><path d="m5 12.5 4.5 4.5L19 7.5" /></Icon>;
export const SidebarLeftIcon = ({ size }: IconProps) => <Icon size={size}><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><path d="M9.5 4.5v15" /></Icon>;
export const SidebarRightIcon = ({ size }: IconProps) => <Icon size={size}><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><path d="M14.5 4.5v15" /></Icon>;
export const LayersIcon = ({ size }: IconProps) => <Icon size={size}><path d="m12 4 8.5 4.5L12 13 3.5 8.5z" /><path d="m3.5 12.5 8.5 4.5 8.5-4.5" /><path d="m3.5 16.5 8.5 4.5 8.5-4.5" /></Icon>;
export const FilesIcon = ({ size }: IconProps) => <Icon size={size}><path d="M8 3.5h6.5L19 8v9.5a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-12a2 2 0 0 1 2-2z" /><path d="M14 3.5V8h5" /></Icon>;
export const FileIcon = ({ size }: IconProps) => <Icon size={size}><path d="M7.5 3.5H14l4.5 4.5v11a1.5 1.5 0 0 1-1.5 1.5H7.5A1.5 1.5 0 0 1 6 19V5a1.5 1.5 0 0 1 1.5-1.5z" /><path d="M13.5 3.5V8.5h5" /></Icon>;
export const BranchIcon = ({ size }: IconProps) => <Icon size={size}><circle cx="7" cy="6" r="2" /><circle cx="7" cy="18" r="2" /><circle cx="17" cy="8" r="2" /><path d="M7 8v8M17 10c0 4-6 3-9.5 6.5" /></Icon>;
export const SearchIcon = ({ size }: IconProps) => <Icon size={size}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></Icon>;
export const UserIcon = ({ size }: IconProps) => <Icon size={size}><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" /></Icon>;
export const ListChecksIcon = ({ size }: IconProps) => <Icon size={size}><path d="m3.5 6.5 1.5 1.5 3-3M3.5 13.5l1.5 1.5 3-3M11 7h9.5M11 14h9.5M11 19.5h9.5" /></Icon>;
export const HistoryIcon = ({ size }: IconProps) => <Icon size={size}><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5" /><path d="M3.5 4v4.5H8M12 8v4.5l3 2" /></Icon>;
export const QuoteIcon = ({ size }: IconProps) => <Icon size={size}><path d="M5 18v-5.5C5 9 6.5 7 9.5 6M14 18v-5.5C14 9 15.5 7 18.5 6" /><path d="M5 12.5h4.5V18H5zM14 12.5h4.5V18H14z" /></Icon>;
export const ExpandIcon = ({ size }: IconProps) => <Icon size={size}><path d="M14.5 4H20v5.5M9.5 20H4v-5.5M20 4l-6.5 6.5M4 20l6.5-6.5" /></Icon>;
export const EyeIcon = ({ size }: IconProps) => <Icon size={size}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></Icon>;
export const RefreshIcon = ({ size }: IconProps) => <Icon size={size}><path d="M20 11a8 8 0 0 0-14.3-4.3L4 9M4 4v5h5M4 13a8 8 0 0 0 14.3 4.3L20 15M20 20v-5h-5" /></Icon>;
export const StopIcon = ({ size }: IconProps) => <Icon size={size}><rect x="6.5" y="6.5" width="11" height="11" rx="2.5" /></Icon>;
export const ArrowUpIcon = ({ size }: IconProps) => <Icon size={size}><path d="M12 19V5M6 11l6-6 6 6" /></Icon>;
export const NewChatIcon = ({ size }: IconProps) => <Icon size={size}><path d="M20.5 12.5v4a3 3 0 0 1-3 3h-7l-5 3v-3a3 3 0 0 1-2-3v-9a3 3 0 0 1 3-3h6.5" /><path d="M18 3v6M15 6h6" /></Icon>;
export const MemoryIcon = ({ size }: IconProps) => <Icon size={size}><rect x="3.5" y="7" width="17" height="10" rx="2" /><path d="M7 17v2.5M12 17v2.5M17 17v2.5M7 10.5v3M10.5 10.5v3M14 10.5v3M17.5 10.5v3" /></Icon>;
export const CommitIcon = ({ size }: IconProps) => <Icon size={size}><circle cx="12" cy="12" r="3.5" /><path d="M3 12h5.5M15.5 12H21" /></Icon>;
export const GlobeIcon = ({ size }: IconProps) => <Icon size={size}><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.2 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.2-3.5-8.5s1.1-6.1 3.5-8.5z" /></Icon>;
export const UsersIcon = ({ size }: IconProps) => <Icon size={size}><circle cx="9" cy="8.5" r="3.2" /><path d="M3 19.5c.7-3.3 3-5 6-5s5.3 1.7 6 5" /><path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.5 14.8c1.8.6 3 2.2 3.5 4.7" /></Icon>;
export const LockIcon = ({ size }: IconProps) => <Icon size={size}><rect x="5" y="10.5" width="14" height="10" rx="2.2" /><path d="M8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7" /></Icon>;
