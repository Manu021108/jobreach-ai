import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronLeft,
  ChevronsUpDown,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sparkles,
  Unlock,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { useWorkspace } from "../../context/WorkspaceContext";
import { navigation } from "../../lib/navigation";
import { initials } from "../../lib/format";
import { IconButton } from "../ui";

export function Sidebar({ mobileOpen, onClose }) {
  const { user, signOut, sidebarCollapsed, setSidebarCollapsed, billing } = useWorkspace();
  const planName = billing?.plan_name || billing?.plan || "Starter";
  const collapsed = sidebarCollapsed && !mobileOpen;
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const workspaceRef = useRef(null);

  useEffect(() => {
    const handleClick = (event) => {
      if (workspaceRef.current && !workspaceRef.current.contains(event.target)) setWorkspaceOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <>
      {mobileOpen ? <button type="button" className="sidebar-backdrop" aria-label="Close navigation" onClick={onClose} /> : null}
      <motion.aside
        className={`sidebar ${collapsed ? "collapsed" : ""} ${mobileOpen ? "mobile-open" : ""}`.trim()}
        initial={false}
        animate={{ width: collapsed ? 86 : 274 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="sidebar-brand">
          <NavLink to="/" className="brand-mark" aria-label="JobReach AI home">
            <span className="brand-glyph"><Sparkles size={18} /></span>
            {!collapsed ? (
              <span className="brand-copy">
                <strong>JobReach</strong>
                <small>AI outreach CRM</small>
              </span>
            ) : null}
          </NavLink>
          {mobileOpen ? (
            <IconButton label="Close navigation" icon={X} className="mobile-close" onClick={onClose} />
          ) : (
            <IconButton
              label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              icon={collapsed ? PanelLeftOpen : PanelLeftClose}
              className="sidebar-toggle"
              onClick={() => setSidebarCollapsed((current) => !current)}
            />
          )}
        </div>

        <nav className="sidebar-nav" aria-label="Main navigation">
          {navigation.map((group) => (
            <div className="nav-group" key={group.label}>
              {!collapsed ? <span className="nav-group-label">{group.label}</span> : null}
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.id}
                    to={item.path}
                    end={item.path === "/"}
                    className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`.trim()}
                    onClick={onClose}
                    title={collapsed ? item.label : undefined}
                  >
                    <span className="nav-icon"><Icon size={18} /></span>
                    {!collapsed ? <span className="nav-label">{item.label}</span> : null}
                    {!collapsed && item.id === "inbox" ? <span className="nav-dot" /> : null}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        {!collapsed ? (
          <div className="sidebar-upgrade">
            <span className="upgrade-glow"><Sparkles size={16} /></span>
            <div className="upgrade-copy">
              <strong>Unlock warm intros</strong>
              <span>Explore verified HR contacts and reach the right people faster.</span>
            </div>
            <NavLink to="/unlock" className="upgrade-link" aria-label="Explore HR database">
              <ChevronLeft className="flip" size={14} />
            </NavLink>
          </div>
        ) : null}

        <div className="sidebar-profile">
          <span className="profile-avatar">{initials(user?.name || user?.email)}</span>
          {!collapsed ? (
            <div className="profile-copy">
              <strong>{user?.name || "Your workspace"}</strong>
              <small>{user?.email || planName}</small>
            </div>
          ) : null}
          {!collapsed ? (
            <div className="profile-actions">
              <IconButton label="Sign out" icon={LogOut} onClick={signOut} />
            </div>
          ) : (
            <IconButton label="Sign out" icon={LogOut} className="profile-signout" onClick={signOut} />
          )}
        </div>
        {!collapsed ? (
          <div className="workspace-menu" ref={workspaceRef}>
            <button
              type="button"
              className="plan-pill"
              onClick={() => setWorkspaceOpen((current) => !current)}
              aria-expanded={workspaceOpen}
            >
              <span>{planName} workspace</span>
              <ChevronsUpDown size={13} />
            </button>
            <AnimatePresence>
              {workspaceOpen ? (
                <motion.div
                  className="workspace-dropdown"
                  initial={{ opacity: 0, y: 8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6 }}
                >
                  <div className="workspace-dropdown-head">
                    <span className="workspace-glyph"><Sparkles size={15} /></span>
                    <div><strong>Personal workspace</strong><small>{planName} plan</small></div>
                  </div>
                  <Link to="/settings" onClick={() => setWorkspaceOpen(false)}><Settings size={15} /> Profile & settings</Link>
                  <Link to="/unlock" onClick={() => setWorkspaceOpen(false)}><Unlock size={15} /> Unlock HR database</Link>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        ) : null}
      </motion.aside>
    </>
  );
}
