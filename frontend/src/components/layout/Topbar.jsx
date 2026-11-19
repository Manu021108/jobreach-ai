import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  Bell,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Command,
  LogOut,
  Menu,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sun,
  WifiOff,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useWorkspace } from "../../context/WorkspaceContext";
import { initials } from "../../lib/format";
import { pageTitles } from "../../lib/navigation";
import { Button, IconButton } from "../ui";
import { CommandPalette } from "./CommandPalette";

export function Topbar({ onOpenMobile }) {
  const { user, signOut, theme, toggleTheme, refresh, busy, followups, drafts, campaigns, settings } = useWorkspace();
  const location = useLocation();
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationsSeen, setNotificationsSeen] = useState(false);
  const profileRef = useRef(null);
  const notificationsRef = useRef(null);
  const title = pageTitles[location.pathname] || "Workspace";

  useEffect(() => {
    setProfileOpen(false);
    setNotificationsOpen(false);
  }, [location.pathname]);

  const alerts = useMemo(() => {
    const result = [];
    const due = followups.filter((item) => item.followup_due_at && new Date(item.followup_due_at).getTime() <= Date.now());
    if (due.length) {
      result.push({
        id: "followups",
        icon: CalendarClock,
        tone: "amber",
        title: `${due.length} follow-up${due.length === 1 ? "" : "s"} due`,
        description: "Review the conversation and send a timely check-in.",
        path: "/followups",
      });
    }
    const awaiting = drafts.filter((item) => item.status === "DRAFT" || item.status === "DRAFTED");
    if (awaiting.length) {
      result.push({
        id: "drafts",
        icon: CheckCircle2,
        tone: "blue",
        title: `${awaiting.length} draft${awaiting.length === 1 ? "" : "s"} awaiting approval`,
        description: "Nothing sends until you approve the final wording.",
        path: "/studio",
      });
    }
    const failed = campaigns.filter((campaign) => campaign.last_error || (campaign.counts?.failed || 0) > 0);
    if (failed.length) {
      result.push({
        id: "campaigns",
        icon: AlertCircle,
        tone: "coral",
        title: `${failed.length} campaign${failed.length === 1 ? "" : "s"} need attention`,
        description: "Open the campaign manager to review delivery errors.",
        path: "/campaigns",
      });
    }
    if (settings?.gmail_needs_reconnect) {
      result.push({
        id: "gmail",
        icon: WifiOff,
        tone: "coral",
        title: "Gmail needs reconnecting",
        description: "Reconnect your account before sending new outreach.",
        path: "/settings",
      });
    }
    return result;
  }, [campaigns, drafts, followups, settings]);

  useEffect(() => {
    const handleKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((current) => !current);
      }
    };
    const handleClick = (event) => {
      if (profileRef.current && !profileRef.current.contains(event.target)) setProfileOpen(false);
      if (notificationsRef.current && !notificationsRef.current.contains(event.target)) setNotificationsOpen(false);
    };
    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handleClick);
    };
  }, []);

  const openNotifications = () => {
    setNotificationsOpen((current) => !current);
    setNotificationsSeen(true);
  };

  return (
    <>
      <header className="topbar">
        <div className="topbar-left">
          <IconButton label="Open navigation" icon={Menu} className="mobile-menu" onClick={onOpenMobile} />
          <div className="breadcrumbs">
            <span>Workspace</span>
            <i>/</i>
            <strong>{title}</strong>
          </div>
          {settings?.gmail_connected ? (
            <span className="gmail-chip connected"><span className="gmail-dot" />Gmail connected</span>
          ) : (
            <Link to="/settings" className="gmail-chip">Connect Gmail</Link>
          )}
        </div>
        <div className="topbar-right">
          <button type="button" className="command-trigger" onClick={() => setPaletteOpen(true)}>
            <Search size={16} />
            <span>Search or jump to...</span>
            <kbd><Command size={11} /> K</kbd>
          </button>
          <IconButton label="Refresh data" icon={RefreshCw} className={busy ? "spin-icon" : ""} onClick={refresh} />
          <IconButton label={theme === "dark" ? "Use light theme" : "Use dark theme"} icon={theme === "dark" ? Sun : Moon} onClick={toggleTheme} />
          <div className="notification-wrap" ref={notificationsRef}>
            <IconButton label="Notifications" icon={Bell} onClick={openNotifications} aria-expanded={notificationsOpen} />
            {alerts.length && !notificationsSeen ? <span className="notification-dot" /> : null}
            <AnimatePresence>
              {notificationsOpen ? (
                <motion.div
                  className="notification-panel"
                  initial={{ opacity: 0, y: 8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6 }}
                >
                  <div className="notification-head">
                    <strong>Workspace alerts</strong>
                    <span>{alerts.length ? `${alerts.length} item${alerts.length === 1 ? "" : "s"}` : "All clear"}</span>
                  </div>
                  {alerts.length ? alerts.map((alert) => {
                    const Icon = alert.icon;
                    return (
                      <button
                        type="button"
                        className="notification-item"
                        key={alert.id}
                        onClick={() => {
                          setNotificationsOpen(false);
                          navigate(alert.path);
                        }}
                      >
                        <span className={`notification-icon tone-${alert.tone}`}><Icon size={16} /></span>
                        <span><strong>{alert.title}</strong><small>{alert.description}</small></span>
                      </button>
                    );
                  }) : (
                    <div className="notification-empty"><CheckCircle2 size={20} /><span>You're all caught up.</span></div>
                  )}
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
          <Link to="/companies?new=1" className="topbar-new">
            <Button icon={Plus} size="sm">New outreach</Button>
          </Link>
          <div className="profile-menu" ref={profileRef}>
            <button type="button" className="profile-trigger" onClick={() => setProfileOpen((current) => !current)}>
              <span className="profile-avatar small">{initials(user?.name || user?.email)}</span>
              <span className="profile-trigger-copy">
                <strong>{user?.name || "Account"}</strong>
                <small>{user?.email}</small>
              </span>
              <ChevronDown size={14} />
            </button>
            <AnimatePresence>
              {profileOpen ? (
                <motion.div
                  className="profile-dropdown"
                  initial={{ opacity: 0, y: 8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6 }}
                >
                  <div className="profile-dropdown-head">
                    <span className="profile-avatar">{initials(user?.name || user?.email)}</span>
                    <div><strong>{user?.name}</strong><small>{user?.email}</small></div>
                  </div>
                  <button type="button" onClick={() => navigate("/settings")}><Settings size={16} /> Profile & settings</button>
                  <button type="button" onClick={signOut}><LogOut size={16} /> Sign out</button>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </div>
      </header>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </>
  );
}
