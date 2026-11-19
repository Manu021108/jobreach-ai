import { LogOut, PanelLeftClose, PanelLeftOpen, Settings, Sparkles, X } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useWorkspace } from "../../context/WorkspaceContext";
import { initials } from "../../lib/format";
import { navigation } from "../../lib/navigation";
import { IconButton } from "../ui";

export function Sidebar({ mobileOpen, onClose }) {
  const { user, signOut, sidebarCollapsed, setSidebarCollapsed } = useWorkspace();
  const collapsed = sidebarCollapsed && !mobileOpen;

  return (
    <>
      {mobileOpen ? <button type="button" className="sidebar-backdrop" aria-label="Close navigation" onClick={onClose} /> : null}
      <aside className={`sidebar ${collapsed ? "collapsed" : ""} ${mobileOpen ? "mobile-open" : ""}`.trim()}>
        <div className="sidebar-brand">
          <NavLink to="/" className="brand-mark" aria-label="JobReach AI home" onClick={onClose}>
            <span className="brand-glyph"><Sparkles size={16} /></span>
            <span className="brand-copy">
              <strong>JobReach</strong>
              <small>AI outreach CRM</small>
            </span>
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
              <span className="nav-group-label">{group.label}</span>
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
                    <span className="nav-icon"><Icon size={17} /></span>
                    <span className="nav-label">{item.label}</span>
                    {item.id === "inbox" ? <span className="nav-dot" /> : null}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <NavLink to="/settings" className="sidebar-settings" onClick={onClose} title="Profile & settings">
            <Settings size={17} />
            <span>Profile & settings</span>
          </NavLink>
          <div className="sidebar-profile">
            <span className="profile-avatar">{initials(user?.name || user?.email)}</span>
            <span className="profile-copy">
              <strong>{user?.name || "Your workspace"}</strong>
              <small>{user?.email || "Starter plan"}</small>
            </span>
            <IconButton label="Sign out" icon={LogOut} onClick={signOut} />
          </div>
        </div>
      </aside>
    </>
  );
}
