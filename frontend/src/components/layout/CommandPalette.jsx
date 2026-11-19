import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Building2, Mail, Rocket, Search, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkspace } from "../../context/WorkspaceContext";
import { navigation } from "../../lib/navigation";
import { IconButton } from "../ui";

export function CommandPalette({ open, onClose }) {
  const navigate = useNavigate();
  const { drafts, campaigns, loadContacts } = useWorkspace();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [contactResults, setContactResults] = useState([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    setQuery("");
    setDebouncedQuery("");
    setContactResults([]);
    setActive(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 40);
    const handleKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, onClose]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!open || !debouncedQuery) {
      setContactResults([]);
      return undefined;
    }
    let cancelled = false;
    loadContacts({ q: debouncedQuery, page_size: 8, sort: "company" }, { silent: true })
      .then((result) => {
        if (!cancelled) setContactResults(result?.rows || []);
      })
      .catch(() => {
        if (!cancelled) setContactResults([]);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, loadContacts, open]);

  const items = useMemo(() => {
    const pages = navigation.flatMap((group) => group.items.map((item) => ({
      id: `nav-${item.id}`,
      label: item.label,
      meta: group.label,
      icon: item.icon,
      path: item.path,
    })));
    const term = query.trim().toLowerCase();
    if (!term) return pages.slice(0, 9);

    const matches = [];
    pages.forEach((item) => {
      if (`${item.label} ${item.meta}`.toLowerCase().includes(term)) matches.push(item);
    });
    contactResults.forEach((contact) => {
      const haystack = `${contact.company_name} ${contact.hr_name} ${contact.email} ${contact.role}`.toLowerCase();
      if (haystack.includes(term)) {
        matches.push({
          id: `contact-${contact.id}`,
          label: contact.company_name,
          meta: `${contact.hr_name || "Hiring Team"} · ${contact.email}`,
          icon: Building2,
          path: `/studio?contact=${contact.id}`,
        });
      }
    });
    drafts.forEach((draft) => {
      const haystack = `${draft.subject || ""} ${draft.body || ""}`.toLowerCase();
      if (haystack.includes(term)) {
        matches.push({
          id: `draft-${draft.id}`,
          label: draft.subject || "Untitled draft",
          meta: `Email draft · ${draft.status}`,
          icon: Mail,
          path: `/studio?draft=${draft.id}`,
        });
      }
    });
    campaigns.forEach((campaign) => {
      if (String(campaign.name || "").toLowerCase().includes(term)) {
        matches.push({
          id: `campaign-${campaign.id}`,
          label: campaign.name,
          meta: `Campaign · ${campaign.status}`,
          icon: Rocket,
          path: "/campaigns",
        });
      }
    });
    return matches.slice(0, 10);
  }, [campaigns, contactResults, drafts, query]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  const go = (path) => {
    navigate(path);
    onClose();
  };

  const handleKeyDown = (event) => {
    if (!items.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => (current + 1) % items.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => (current - 1 + items.length) % items.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      go(items[active].path);
    }
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div className="palette-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}>
          <motion.div
            className="palette"
            initial={{ opacity: 0, y: -14, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
          >
            <div className="palette-input">
              <Search size={19} />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search pages, companies, drafts, campaigns..."
              />
              <kbd>ESC</kbd>
              <IconButton label="Close" icon={X} onClick={onClose} />
            </div>
            <div className="palette-results">
              {items.length ? items.map((item, index) => {
                const Icon = item.icon;
                return (
                  <button
                    type="button"
                    key={item.id}
                    className={`palette-item ${index === active ? "active" : ""}`.trim()}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => go(item.path)}
                  >
                    <span className="palette-icon"><Icon size={17} /></span>
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.meta}</small>
                    </span>
                    <ArrowRight size={15} />
                  </button>
                );
              }) : (
                <div className="palette-empty">
                  <Sparkles size={20} />
                  <p>No matches for “{query}”</p>
                </div>
              )}
            </div>
            <div className="palette-footer">
              <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
              <span><kbd>↵</kbd> open</span>
              <span>Searching your workspace</span>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
