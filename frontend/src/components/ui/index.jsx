import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  Inbox,
  LoaderCircle,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useId, useMemo } from "react";
import { clamp, initials, titleCase } from "../../lib/format";

export function GlassCard({ as: Element = "section", className = "", children, ...props }) {
  return (
    <Element className={`glass-card ${className}`.trim()} {...props}>
      {children}
    </Element>
  );
}

export function Button({
  children,
  icon: Icon,
  variant = "primary",
  size = "md",
  loading = false,
  className = "",
  type = "button",
  ...props
}) {
  return (
    <button
      type={type}
      className={`button button-${variant} button-${size} ${className}`.trim()}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? <LoaderCircle className="spin" size={16} /> : Icon ? <Icon size={16} /> : null}
      {children ? <span>{children}</span> : null}
    </button>
  );
}

export function IconButton({ label, icon: Icon, className = "", ...props }) {
  return (
    <button type="button" className={`icon-button ${className}`.trim()} aria-label={label} title={label} {...props}>
      <Icon size={18} />
    </button>
  );
}

const STATUS_TONES = {
  PENDING: "amber",
  QUEUED: "amber",
  DUE: "amber",
  UPCOMING: "blue",
  AWAITING_APPROVAL: "amber",
  DONE: "teal",
  COMPLETED: "teal",
  REVIEWED: "teal",
  DRAFT: "violet",
  DRAFTED: "violet",
  GENERATED: "violet",
  APPROVED: "blue",
  READY: "blue",
  VERIFIED: "teal",
  ACTIVE: "teal",
  RUNNING: "teal",
  SENT: "blue",
  REPLIED: "teal",
  SUCCESS: "teal",
  CONNECTED: "teal",
  FAILED: "coral",
  ERROR: "coral",
  OPTED_OUT: "coral",
  NOT_INTERESTED: "coral",
  ARCHIVED: "neutral",
  INACTIVE: "neutral",
  UNVERIFIED: "neutral",
  PAUSED: "amber",
  CLOSED: "neutral",
  LOCKED: "neutral",
  DRY_RUN: "violet",
};

export function StatusBadge({ status, dot = true, className = "" }) {
  const value = String(status || "UNKNOWN").toUpperCase();
  const tone = STATUS_TONES[value] || "neutral";
  return (
    <span className={`status-badge status-${tone} ${className}`.trim()}>
      {dot ? <span className="status-dot" /> : null}
      {titleCase(value)}
    </span>
  );
}

function Sparkline({ data = [], tone = "teal" }) {
  const points = useMemo(() => {
    if (!data.length) return "";
    const max = Math.max(...data, 1);
    return data
      .map((value, index) => {
        const x = data.length === 1 ? 0 : (index / (data.length - 1)) * 100;
        const y = 30 - (value / max) * 24;
        return `${x},${y}`;
      })
      .join(" ");
  }, [data]);
  if (!points) return null;
  return (
    <svg className={`sparkline sparkline-${tone}`} viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function MetricCard({ label, value, detail, icon: Icon, tone = "teal", spark, trend }) {
  return (
    <GlassCard className="metric-card kpi-card">
      <div className="metric-top">
        <span className={`metric-icon tone-${tone}`}>{Icon ? <Icon size={18} /> : <Sparkles size={18} />}</span>
        {trend != null ? <span className={`metric-trend ${trend >= 0 ? "positive" : "negative"}`}>{trend > 0 ? "+" : ""}{trend}%</span> : null}
      </div>
      <div className="metric-value">{value}</div>
      <div className="metric-label">{label}</div>
      {detail ? <div className="metric-detail">{detail}</div> : null}
      {spark ? <Sparkline data={spark} tone={tone} /> : null}
    </GlassCard>
  );
}

export function PageHeader({ eyebrow, title, description, actions, children }) {
  return (
    <header className="page-header">
      <div className="page-heading">
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
      {children}
    </header>
  );
}

export function SectionHeading({ title, description, action }) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function ActivityFeed({ items = [], iconFor, titleFor, detailFor, timeFor, emptyTitle = "No activity yet" }) {
  if (!items.length) {
    return <EmptyState compact icon={Sparkles} title={emptyTitle} description="Workspace events will appear here as you go." />;
  }
  return (
    <div className="activity-feed">
      {items.map((item, index) => {
        const Icon = iconFor?.(item) || Sparkles;
        return (
          <div className="activity-feed-row" key={item.id || index}>
            <span className="activity-feed-icon"><Icon size={14} /></span>
            <div>
              <strong>{titleFor?.(item) || "Activity"}</strong>
              {detailFor?.(item) ? <p>{detailFor(item)}</p> : null}
            </div>
            <time>{timeFor?.(item) || ""}</time>
          </div>
        );
      })}
    </div>
  );
}

export function SearchBar({ value, onChange, placeholder = "Search", className = "", shortcut }) {
  const id = useId();
  return (
    <label className={`search-bar ${className}`.trim()} htmlFor={id}>
      <Search size={17} />
      <input
        id={id}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
      />
      {shortcut ? <kbd>{shortcut}</kbd> : null}
    </label>
  );
}

export function FilterSelect({ label, value, onChange, options = [], className = "" }) {
  return (
    <label className={`filter-select ${className}`.trim()}>
      {label ? <span>{label}</span> : null}
      <div className="select-wrap">
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          {options.map((option) => {
            const normalized = typeof option === "string" ? { value: option, label: option } : option;
            return <option key={normalized.value} value={normalized.value}>{normalized.label}</option>;
          })}
        </select>
        <ChevronDown size={15} />
      </div>
    </label>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, description, action, compact = false }) {
  return (
    <div className={`empty-state ${compact ? "compact" : ""}`.trim()}>
      <span className="empty-icon"><Icon size={compact ? 22 : 30} /></span>
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  );
}

export function LoadingSkeleton({ rows = 4, className = "" }) {
  return (
    <div className={`skeleton-stack ${className}`.trim()} aria-label="Loading">
      {Array.from({ length: rows }).map((_, index) => (
        <div className="skeleton-row" key={index}>
          <span className="skeleton-circle" />
          <span className="skeleton-lines">
            <i style={{ width: `${64 + ((index * 13) % 28)}%` }} />
            <i style={{ width: `${32 + ((index * 17) % 34)}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}

export function Avatar({ name = "", size = "md" }) {
  return <span className={`avatar avatar-${size}`}>{initials(name)}</span>;
}

export function ProgressBar({ value, tone = "teal", label }) {
  const percentage = clamp(value);
  return (
    <div className="progress-block">
      {label ? <div className="progress-label"><span>{label}</span><span>{Math.round(percentage)}%</span></div> : null}
      <div className="progress-track"><span className={`progress-fill tone-${tone}`} style={{ width: `${percentage}%` }} /></div>
    </div>
  );
}

export function ProgressRing({ value, size = 92, label }) {
  const percentage = clamp(value);
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="progress-ring" style={{ width: size, height: size }}>
      <svg viewBox="0 0 92 92">
        <circle cx="46" cy="46" r={radius} className="ring-track" />
        <circle
          cx="46"
          cy="46"
          r={radius}
          className="ring-fill"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - (percentage / 100) * circumference}
        />
      </svg>
      <span><strong>{Math.round(percentage)}</strong>{label ? <small>{label}</small> : null}</span>
    </div>
  );
}

export function Tabs({ items, value, onChange, className = "" }) {
  return (
    <div className={`tabs ${className}`.trim()} role="tablist">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          aria-selected={value === item.value}
          className={value === item.value ? "active" : ""}
          onClick={() => onChange(item.value)}
        >
          {item.label}
          {item.count != null ? <span>{item.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, description, children, footer, width = "560px" }) {
  useEffect(() => {
    if (!open) return undefined;
    const handleKey = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", handleKey);
    document.body.classList.add("modal-open");
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.classList.remove("modal-open");
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="modal-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose?.();
          }}
        >
          <motion.div
            className="modal-card"
            style={{ maxWidth: width }}
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.99 }}
            transition={{ duration: 0.18 }}
            role="dialog"
            aria-modal="true"
            aria-label={title}
          >
            <div className="modal-header">
              <div>
                <h2>{title}</h2>
                {description ? <p>{description}</p> : null}
              </div>
              <IconButton label="Close" icon={X} onClick={onClose} />
            </div>
            <div className="modal-body">{children}</div>
            {footer ? <div className="modal-footer">{footer}</div> : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel = "Confirm", tone = "danger", loading }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      width="460px"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant={tone} loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      )}
    >
      <div className={`confirm-visual tone-${tone}`}><AlertCircle size={22} /></div>
    </Modal>
  );
}

export function Toast({ toast, onClose }) {
  if (!toast) return null;
  const Icon = toast.tone === "error" ? AlertCircle : CheckCircle2;
  return (
    <AnimatePresence>
      <motion.div
        className={`toast toast-${toast.tone || "success"}`}
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12 }}
        role="status"
      >
        <span className="toast-icon"><Icon size={18} /></span>
        <p>{toast.message}</p>
        <IconButton label="Dismiss" icon={X} onClick={onClose} />
      </motion.div>
    </AnimatePresence>
  );
}

export function DataTable({
  columns,
  rows,
  rowKey = (row) => row.id,
  selectable = false,
  selected = [],
  onSelectionChange,
  onRowClick,
  empty,
  className = "",
}) {
  const allSelected = rows.length > 0 && rows.every((row) => selected.includes(rowKey(row)));
  const toggleAll = () => {
    if (!onSelectionChange) return;
    onSelectionChange(allSelected ? [] : rows.map(rowKey));
  };
  const toggleRow = (key) => {
    if (!onSelectionChange) return;
    onSelectionChange(selected.includes(key) ? selected.filter((item) => item !== key) : [...selected, key]);
  };

  return (
    <div className={`data-table-wrap ${className}`.trim()}>
      <table className="data-table">
        <thead>
          <tr>
            {selectable ? (
              <th className="select-cell">
                <label className="checkbox">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all rows" />
                  <span><Check size={12} /></span>
                </label>
              </th>
            ) : null}
            {columns.map((column) => (
              <th key={column.key} className={column.className || ""}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((row) => {
            const key = rowKey(row);
            return (
              <tr
                key={key}
                className={onRowClick ? "clickable" : ""}
                onClick={(event) => {
                  if (event.target.closest("button, input, a, select, label")) return;
                  onRowClick?.(row);
                }}
              >
                {selectable ? (
                  <td className="select-cell" onClick={(event) => event.stopPropagation()}>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={selected.includes(key)}
                        onChange={() => toggleRow(key)}
                        aria-label={`Select row ${key}`}
                      />
                      <span><Check size={12} /></span>
                    </label>
                  </td>
                ) : null}
                {columns.map((column) => (
                  <td key={column.key} className={column.className || ""}>
                    {column.render ? column.render(row) : row[column.key]}
                  </td>
                ))}
              </tr>
            );
          }) : (
            <tr>
              <td colSpan={columns.length + (selectable ? 1 : 0)}>{empty}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
