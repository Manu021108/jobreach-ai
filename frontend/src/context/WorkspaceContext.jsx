import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

const WorkspaceContext = createContext(null);

function getInitialTheme() {
  const stored = localStorage.getItem("jobreach-theme");
  if (stored === "light" || stored === "dark") return stored;
  return "light";
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
  const [jobAlerts, setJobAlerts] = useState([]);
  const [jobNotifications, setJobNotifications] = useState([]);
  const [jobUnreadCount, setJobUnreadCount] = useState(0);
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
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.setAttribute("content", theme === "dark" ? "#101621" : "#F7F8FA");
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
        jobAlertRows,
        jobNotificationRows,
        jobUnread,
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
        api("/job-alerts"),
        api("/job-notifications?limit=8"),
        api("/job-notifications/unread-count"),
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
      setJobAlerts(jobAlertRows);
      setJobNotifications(jobNotificationRows);
      setJobUnreadCount(jobUnread?.count || 0);
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

  const refreshJobNotifications = useCallback(async () => {
    const [rows, count] = await Promise.all([
      api("/job-notifications?limit=8"),
      api("/job-notifications/unread-count"),
    ]);
    setJobNotifications(rows);
    setJobUnreadCount(count?.count || 0);
  }, []);

  const markJobNotificationRead = useCallback(async (id) => {
    await api(`/job-notifications/${id}/read`, { method: "POST" });
    setJobNotifications((current) => current.map((item) => item.id === id ? { ...item, read: true, read_at: new Date().toISOString() } : item));
    setJobUnreadCount((current) => Math.max(0, current - 1));
  }, []);

  const markAllJobNotificationsRead = useCallback(async () => {
    const result = await api("/job-notifications/read-all", { method: "POST" });
    setJobNotifications((current) => current.map((item) => ({ ...item, read: true })));
    setJobUnreadCount(0);
    return result;
  }, []);

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
    setJobAlerts([]);
    setJobNotifications([]);
    setJobUnreadCount(0);
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
      jobAlerts,
      jobNotifications,
      jobUnreadCount,
      refreshJobNotifications,
      markJobNotificationRead,
      markAllJobNotificationsRead,
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
      jobAlerts,
      jobNotifications,
      jobUnreadCount,
      refreshJobNotifications,
      markJobNotificationRead,
      markAllJobNotificationsRead,
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
