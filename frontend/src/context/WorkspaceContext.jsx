import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

const WorkspaceContext = createContext(null);

function getInitialTheme() {
  const stored = localStorage.getItem("jobreach-theme");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function WorkspaceProvider({ user, setUser, children }) {
  const [dashboard, setDashboard] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [followups, setFollowups] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [settings, setSettings] = useState(null);
  const [billing, setBilling] = useState(null);
  const [hrDatabase, setHrDatabase] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [inbox, setInbox] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState("");
  const [theme, setThemeState] = useState(getInitialTheme);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    localStorage.getItem("jobreach-sidebar") === "collapsed",
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("jobreach-theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("jobreach-sidebar", sidebarCollapsed ? "collapsed" : "expanded");
  }, [sidebarCollapsed]);

  const notify = useCallback((message, tone = "success") => {
    if (!message) return;
    setToast({ id: Date.now(), message, tone });
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 4800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const refresh = useCallback(async () => {
    try {
      const [
        overview,
        contactRows,
        draftRows,
        followupRows,
        config,
        billingStatus,
        database,
        auditRows,
        analyticsData,
        inboxRows,
        campaignRows,
      ] = await Promise.all([
        api("/dashboard"),
        api("/contacts"),
        api("/drafts"),
        api("/followups"),
        api("/settings"),
        api("/billing/entitlement"),
        api("/hr-database"),
        api("/audit?limit=200"),
        api("/analytics?days=30"),
        api("/inbox?limit=60"),
        api("/campaigns"),
      ]);
      setDashboard(overview);
      setContacts(contactRows);
      setDrafts(draftRows);
      setFollowups(followupRows);
      setSettings(config);
      setBilling(billingStatus);
      setHrDatabase(database);
      setAuditLog(auditRows);
      setAnalytics(analyticsData);
      setInbox(inboxRows);
      setCampaigns(campaignRows);
      setError("");
      return true;
    } catch (requestError) {
      setError(requestError.message);
      return false;
    }
  }, []);

  useEffect(() => {
    if (user) refresh();
  }, [user, refresh]);

  const run = useCallback(
    async (operation, successMessage, options = {}) => {
      const { refreshAfter = true, tone = "success" } = options;
      setBusy(true);
      setError("");
      try {
        const result = await operation();
        if (refreshAfter) await refresh();
        const message = typeof successMessage === "function" ? successMessage(result) : successMessage;
        if (message) notify(message, tone);
        return result;
      } catch (requestError) {
        setError(requestError.message);
        notify(requestError.message, "error");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [notify, refresh],
  );

  const signOut = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      /* keep local sign-out resilient */
    }
    setUser(null);
    setDashboard(null);
    setContacts([]);
    setDrafts([]);
    setFollowups([]);
    setAuditLog([]);
    setSettings(null);
    setBilling(null);
    setHrDatabase(null);
    setAnalytics(null);
    setInbox([]);
    setCampaigns([]);
  }, [setUser]);

  const toggleTheme = useCallback(() => {
    setThemeState((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  const value = useMemo(
    () => ({
      user,
      setUser,
      dashboard,
      contacts,
      drafts,
      followups,
      auditLog,
      settings,
      billing,
      hrDatabase,
      analytics,
      inbox,
      campaigns,
      busy,
      toast,
      setToast,
      error,
      setError,
      refresh,
      run,
      notify,
      signOut,
      theme,
      toggleTheme,
      sidebarCollapsed,
      setSidebarCollapsed,
    }),
    [
      user,
      setUser,
      dashboard,
      contacts,
      drafts,
      followups,
      auditLog,
      settings,
      billing,
      hrDatabase,
      analytics,
      inbox,
      campaigns,
      busy,
      toast,
      error,
      refresh,
      run,
      notify,
      signOut,
      theme,
      toggleTheme,
      sidebarCollapsed,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return context;
}
