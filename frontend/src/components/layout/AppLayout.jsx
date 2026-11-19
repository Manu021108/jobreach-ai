import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useWorkspace } from "../../context/WorkspaceContext";
import { Toast } from "../ui";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export function AppLayout() {
  const { toast, setToast } = useWorkspace();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [location.pathname]);

  return (
    <div className="app-shell">
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="app-main">
        <Topbar onOpenMobile={() => setMobileOpen(true)} />
        <main className="page-content">
          <Outlet />
        </main>
      </div>
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
