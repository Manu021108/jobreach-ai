import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Search, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { navigation } from "../../lib/navigation";
import { IconButton } from "../ui";

export function CommandPalette({ open, onClose }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    setQuery("");
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

  const items = useMemo(() => {
    const flat = navigation.flatMap((group) => group.items.map((item) => ({ ...item, group: group.label })));
    if (!query.trim()) return flat.slice(0, 9);
    const term = query.toLowerCase();
    return flat.filter((item) => `${item.label} ${item.group}`.toLowerCase().includes(term)).slice(0, 10);
  }, [query]);

  const go = (path) => {
    navigate(path);
    onClose();
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
                placeholder="Jump to a page or action..."
              />
              <kbd>ESC</kbd>
              <IconButton label="Close" icon={X} onClick={onClose} />
            </div>
            <div className="palette-results">
              {items.length ? items.map((item) => {
                const Icon = item.icon;
                return (
                  <button type="button" key={item.id} className="palette-item" onClick={() => go(item.path)}>
                    <span className="palette-icon"><Icon size={17} /></span>
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.group}</small>
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
              <span>JobReach AI command center</span>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
