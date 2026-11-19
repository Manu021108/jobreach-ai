import {
  Activity,
  BarChart3,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  FileText,
  Inbox,
  LayoutDashboard,
  Mail,
  Search,
  Settings,
  Sparkles,
  Target,
  Unlock,
} from "lucide-react";

export const navigation = [
  {
    label: "Workspace",
    items: [
      { id: "overview", label: "Overview", path: "/", icon: LayoutDashboard },
      { id: "companies", label: "Companies", path: "/companies", icon: Building2 },
      { id: "discovery", label: "Job Discovery", path: "/discovery", icon: Search },
      { id: "match", label: "Job Match", path: "/match", icon: Target },
      { id: "studio", label: "AI Email Studio", path: "/studio", icon: Sparkles },
    ],
  },
  {
    label: "Outreach",
    items: [
      { id: "campaigns", label: "Campaigns", path: "/campaigns", icon: BriefcaseBusiness },
      { id: "followups", label: "Follow-ups", path: "/followups", icon: CalendarClock },
      { id: "inbox", label: "Inbox", path: "/inbox", icon: Inbox },
    ],
  },
  {
    label: "Insights",
    items: [
      { id: "analytics", label: "Analytics", path: "/analytics", icon: BarChart3 },
      { id: "activity", label: "Activity", path: "/activity", icon: Activity },
    ],
  },
  {
    label: "Account",
    items: [
      { id: "resume", label: "Resume Manager", path: "/resume", icon: FileText },
      { id: "settings", label: "Profile & Settings", path: "/settings", icon: Settings },
      { id: "unlock", label: "HR Database", path: "/unlock", icon: Unlock },
    ],
  },
];

export const navigationById = Object.fromEntries(
  navigation.flatMap((group) => group.items.map((item) => [item.id, item])),
);

export const pageTitles = Object.fromEntries(
  navigation.flatMap((group) => group.items.map((item) => [item.path, item.label])),
);

export const statusOptions = [
  "PENDING",
  "DRAFTED",
  "SENT",
  "REPLIED",
  "FAILED",
  "NOT_INTERESTED",
  "OPTED_OUT",
  "ARCHIVED",
];

export const generationModes = [
  { id: "application", label: "Application", icon: Target },
  { id: "general", label: "General inquiry", icon: Mail },
  { id: "recruiter", label: "Recruiter intro", icon: Sparkles },
  { id: "hr", label: "HR outreach", icon: Building2 },
  { id: "followup", label: "Follow-up", icon: CalendarClock },
  { id: "referral", label: "Referral request", icon: FileText },
];

export const auditLabels = {
  CONTACTS_IMPORTED: "Contacts imported",
  CONTACT_CREATED: "Company added",
  DRAFT_CREATED: "Draft created",
  DRAFT_APPROVED: "Draft approved",
  EMAIL_SENT: "Email sent",
  EMAIL_FAILED: "Email failed",
  EMAIL_RETRY_SCHEDULED: "Retry scheduled",
  CONTACT_STATUS_CHANGED: "Contact status changed",
  OPT_OUT_DETECTED: "Opt-out detected",
  REPLY_MATCHED: "Reply matched",
  UNSUBSCRIBE_LINK_USED: "Unsubscribe used",
  CAMPAIGN_STARTED: "Campaign started",
  CAMPAIGN_PAUSED: "Campaign paused",
  DRY_RUN_ENABLED: "Dry-run enabled",
  DRY_RUN_DISABLED: "Dry-run disabled",
};
