import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, post } from "../lib/api";

const WorkspaceContext = createContext(null);

const EMPTY_CONTACTS_PAGE = {
  rows: [],
  total: 0,
  unfiltered_total: 0,
  page: 1,
  page_size: 25,
  page_count: 1,
  status_counts: {},
};

const DEFAULT_CONTACT_PARAMS = {
  q: "",
  status: "All",
  sort: "recent",
  page: 1,
  page_size: 25,
  eligible: false,
};

function normalizeContactParams(params = {}) {
  return {
    q: params.q ?? DEFAULT_CONTACT_PARAMS.q,
    status: params.status ?? DEFAULT_CONTACT_PARAMS.status,
    sort: params.sort ?? DEFAULT_CONTACT_PARAMS.sort,
    page: Math.max(1, Number(params.page) || 1),
    page_size: Math.max(1, Number(params.page_size) || DEFAULT_CONTACT_PARAMS.page_size),
    eligible: Boolean(params.eligible),
  };
}

function buildContactQuery(params) {
  const query = new URLSearchParams();
  query.set("q", params.q);
  query.set("status", params.status);
  query.set("sort", params.sort);
  query.set("page", String(params.page));
  query.set("page_size", String(params.page_size));
  query.set("eligible", params.eligible ? "true" : "false");
  return query.toString();
}

function getInitialTheme() {
  const stored = localStorage.getItem("jobreach-theme");
  if (stored === "light" || stored === "dark") return stored;
  return "light";
}

export function WorkspaceProvider({ user, setUser, children }) {
  const [dashboard, setDashboard] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [contactsPage, setContactsPage] = useState(EMPTY_CONTACTS_PAGE);
  const [contactsLoading, setContactsLoading] = useState(false);
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

  const contactParamsRef = useRef(null);
  const contactRequestRef = useRef(null);
  const contactRequestSeqRef = useRef(0);

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

  const loadContacts = useCallback(async (params = {}, options = {}) => {
    const normalized = normalizeContactParams(params);
    const key = JSON.stringify(normalized);
    const silent = options.silent === true;

    if (!silent) {
      contactParamsRef.current = normalized;
      if (contactRequestRef.current?.key === key) return contactRequestRef.current.promise;
      setContactsLoading(true);
    }

    const seq = silent ? 0 : ++contactRequestSeqRef.current;
    const execute = async () => {
      try {
        const result = await api(`/contacts/paged?${buildContactQuery(normalized)}`);
        const page = result && typeof result === "object" ? result : EMPTY_CONTACTS_PAGE;
        if (!silent && seq === contactRequestSeqRef.current) {
          setContacts(Array.isArray(page.rows) ? page.rows : []);
          setContactsPage(page);
        }
        return page;
      } catch (requestError) {
        if (!silent && seq === contactRequestSeqRef.current) {
          setError(requestError.message);
          notify(requestError.message, "error");
        }
        return { ...EMPTY_CONTACTS_PAGE, page: normalized.page, page_size: normalized.page_size };
      } finally {
        if (!silent && contactRequestRef.current?.key === key) contactRequestRef.current = null;
        if (!silent && seq === contactRequestSeqRef.current) setContactsLoading(false);
      }
    };

    const promise = execute();
    if (!silent) contactRequestRef.current = { key, promise };
    return promise;
  }, [notify]);

  const reloadContacts = useCallback(async () => {
    if (!contactParamsRef.current) return null;
    return loadContacts(contactParamsRef.current);
  }, [loadContacts]);

  const getContact = useCallback((id) => api(`/contacts/${id}`), []);

  const lookupContacts = useCallback(async (ids) => {
    const unique = [...new Set((ids || []).filter((id) => id !== null && id !== undefined))];
    if (!unique.length) return { rows: [] };
    try {
      const result = await post("/contacts/lookup", { ids: unique });
      return { rows: Array.isArray(result?.rows) ? result.rows : [] };
    } catch (requestError) {
      setError(requestError.message);
      notify(requestError.message, "error");
      return { rows: [] };
    }
  }, [notify]);

  const refresh = useCallback(async (options = {}) => {
    try {
      const [
        overview,
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
      if (options.skipContacts !== true && contactParamsRef.current) await reloadContacts();
      return true;
    } catch (requestError) {
      setError(requestError.message);
      return false;
    }
  }, [reloadContacts]);

  useEffect(() => {
    if (user) refresh({ skipContacts: true });
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
    } catch {}
    contactRequestSeqRef.current += 1;
    contactParamsRef.current = null;
    contactRequestRef.current = null;
    setUser(null);
    setDashboard(null);
    setContacts([]);
    setContactsPage(EMPTY_CONTACTS_PAGE);
    setContactsLoading(false);
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
      contactsPage,
      contactsLoading,
      loadContacts,
      getContact,
      lookupContacts,
      reloadContacts,
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
      contactsPage,
      contactsLoading,
      loadContacts,
      getContact,
      lookupContacts,
      reloadContacts,
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
