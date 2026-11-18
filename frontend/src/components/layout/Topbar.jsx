import { AnimatePresence, motion } from "framer-motion";
import {
  Bell,
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
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useWorkspace } from "../../context/WorkspaceContext";
import { initials } from "../../lib/format";
import { pageTitles } from "../../lib/navigation";
import { Button, IconButton } from "../ui";
import { CommandPalette } from "./CommandPalette";

export function Topbar({ onOpenMobile }) {
  const { user, signOut, theme, toggleTheme, refresh, busy, notify } = useWorkspace();
  const location = useLocation();
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef(null);
  const title = pageTitles[location.pathname] || "Workspace";

  useEffect(() => {
    setProfileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const handleKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((current) => !current);
      }
    };
    const handleClick = (event) => {
      if (profileRef.current && !profileRef.current.contains(event.target)) setProfileOpen(false);
    };
    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handleClick);
    };
  }, []);

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
        </div>
        <div className="topbar-right">
          <button type="button" className="command-trigger" onClick={() => setPaletteOpen(true)}>
            <Search size={16} />
            <span>Search or jump to...</span>
            <kbd><Command size={11} /> K</kbd>
          </button>
          <IconButton label="Refresh data" icon={RefreshCw} className={busy ? "spin-icon" : ""} onClick={refresh} />
          <IconButton label={theme === "dark" ? "Use light theme" : "Use dark theme"} icon={theme === "dark" ? Sun : Moon} onClick={toggleTheme} />
          <div className="notification-wrap">
            <IconButton
              label="Notifications"
              icon={Bell}
              onClick={() => notify("You're all caught up. No new alerts.", "success")}
            />
            <span className="notification-dot" />
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
