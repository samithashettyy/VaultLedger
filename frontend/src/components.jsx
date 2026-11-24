import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  Fragment,
  useRef
} from "react";
import {
  CheckCircle2,
  Info,
  Loader2,
  X,
  XCircle,
  Check,
  Clock,
  Copy,
  MoveRight,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  KeyRound,
  Lock,
  ShieldAlert,
  ShieldCheck,
  Unlock,
  Activity,
  ClipboardList,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Network,
  Users
} from "lucide-react";
import {
  api,
  useAuth,
  usePolling
} from "./services.jsx";
import {
  NavLink,
  Outlet,
  useLocation,
  useNavigate
} from "react-router-dom";

// Consolidated VaultLedger frontend. Sections retain their original responsibilities.

// ==================== components/ui.jsx ====================
const cn = (...parts) => parts.filter(Boolean).join(' ');
function Card({
  className,
  children,
  ...props
}) {
  return <section className={cn('rounded-2xl border border-slate-200 bg-white shadow-sm', className)} {...props}>
      {children}
    </section>;
}
function CardHeader({
  title,
  subtitle,
  icon: Icon,
  action,
  className
}) {
  return <header className={cn('flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4', className)}>
      <div className="flex items-start gap-3">
        {Icon && <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-navy-50 text-navy-700">
            <Icon size={17} />
          </span>}
        <div>
          <h2 className="text-[13px] font-semibold uppercase tracking-wider text-navy-800">
            {title}
          </h2>
          {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {action}
    </header>;
}
function PageHeader({
  eyebrow,
  title,
  subtitle,
  action
}) {
  return <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-600">
            {eyebrow}
          </p>}
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-navy-950">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>;
}
/* ---------- Badges ---------- */

const tones = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  yellow: 'bg-amber-50 text-amber-800 ring-amber-600/25',
  red: 'bg-red-50 text-red-700 ring-red-600/20',
  blue: 'bg-brand-50 text-brand-700 ring-brand-600/20',
  slate: 'bg-slate-100 text-slate-600 ring-slate-500/15',
  navy: 'bg-navy-900 text-white ring-navy-900'
};
function Badge({
  tone = 'slate',
  icon: Icon,
  children,
  className
}) {
  return <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset', tones[tone], className)}>
      {Icon && <Icon size={12} />}
      {children}
    </span>;
}
function StatusBadge({
  status
}) {
  const tone = status === 'FLAGGED' ? 'red' : status === 'MEDIUM RISK' ? 'yellow' : 'green';
  return <Badge tone={tone}>{status}</Badge>;
}
function LevelBadge({
  level
}) {
  const tone = level === 'HIGH' ? 'red' : level === 'MEDIUM' ? 'yellow' : 'green';
  return <Badge tone={tone}>{level}</Badge>;
}
const INVESTIGATION_STATUS = {
  PENDING_CONSENT: {
    label: 'Awaiting consent',
    tone: 'yellow'
  },
  APPROVED: {
    label: 'Participation approved',
    tone: 'blue'
  },
  RUNNING: {
    label: 'Analysis in progress',
    tone: 'blue'
  },
  AWAITING_DECRYPTION: {
    label: 'Awaiting threshold decryption',
    tone: 'yellow'
  },
  COMPLETED: {
    label: 'Completed',
    tone: 'green'
  },
  CANCELLED: {
    label: 'Investigation cancelled',
    tone: 'red'
  },
  FAILED: {
    label: 'Failed',
    tone: 'red'
  }
};
function InvestigationStatusBadge({
  status
}) {
  const s = INVESTIGATION_STATUS[status] || {
    label: status,
    tone: 'slate'
  };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
/* ---------- Buttons ---------- */

const variants = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm disabled:bg-brand-300',
  dark: 'bg-navy-900 text-white hover:bg-navy-800 shadow-sm disabled:bg-navy-300',
  secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm disabled:bg-red-300',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm disabled:bg-emerald-300',
  ghost: 'text-slate-600 hover:bg-slate-100 disabled:text-slate-300'
};
const sizes = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-5 py-2.5 text-sm'
};
function Button({
  variant = 'primary',
  size = 'md',
  icon: Icon,
  loading,
  className,
  children,
  ...props
}) {
  return <button className={cn('inline-flex items-center justify-center gap-2 rounded-lg font-semibold tracking-wide transition-colors disabled:cursor-not-allowed', variants[variant], sizes[size], className)} disabled={loading || props.disabled} {...props}>
      {loading ? <Loader2 size={15} className="animate-spin" /> : Icon && <Icon size={15} />}
      {children}
    </button>;
}
function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md'
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = e => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);
  if (!open) return null;
  const width = {
    sm: 'max-w-md',
    md: 'max-w-xl',
    lg: 'max-w-3xl',
    xl: 'max-w-5xl'
  }[size];
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy-950/60 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={e => e.target === e.currentTarget && onClose?.()} role="dialog" aria-modal="true" aria-label={title}>
      <div className={cn('vl-fade-in flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl', width)}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="text-base font-semibold text-navy-950">{title}</h3>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3 sm:rounded-b-2xl">
            {footer}
          </div>}
      </div>
    </div>;
}
function StatCard({
  label,
  value,
  icon: Icon,
  tone = 'navy',
  hint
}) {
  const iconTone = {
    navy: 'bg-navy-50 text-navy-700',
    green: 'bg-emerald-50 text-emerald-600',
    yellow: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
    blue: 'bg-brand-50 text-brand-600'
  }[tone];
  return <Card className="p-4">
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        {Icon && <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', iconTone)}>
            <Icon size={16} />
          </span>}
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight text-navy-950">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </Card>;
}
function RiskBar({
  score,
  threshold = 50
}) {
  const color = score >= threshold ? 'bg-red-500' : score >= 30 ? 'bg-amber-400' : 'bg-emerald-500';
  return <div className="flex items-center gap-2">
      <span className="w-7 text-right text-sm font-semibold tabular-nums text-slate-800">{score}</span>
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
        <div className={cn('h-full rounded-full', color)} style={{
        width: `${Math.min(score, 100)}%`
      }} />
      </div>
    </div>;
}
function Spinner({
  label = 'Loading…'
}) {
  return <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
      <Loader2 size={18} className="animate-spin" /> {label}
    </div>;
}
function EmptyState({
  icon: Icon,
  title,
  children
}) {
  return <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {Icon && <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">
          <Icon size={20} />
        </span>}
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      {children && <p className="mt-1 max-w-sm text-sm text-slate-500">{children}</p>}
    </div>;
}
function ErrorNote({
  error
}) {
  if (!error) return null;
  return <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      {error.message || String(error)}
    </div>;
}
function Callout({
  tone = 'blue',
  icon: Icon = Info,
  children,
  className
}) {
  const styles = {
    blue: 'border-brand-200 bg-brand-50/60 text-brand-700',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    yellow: 'border-amber-200 bg-amber-50 text-amber-900',
    red: 'border-red-200 bg-red-50 text-red-800',
    navy: 'border-navy-200 bg-navy-50 text-navy-800'
  }[tone];
  return <div className={cn('flex gap-2.5 rounded-xl border px-3.5 py-3 text-sm', styles, className)}>
      <Icon size={16} className="mt-0.5 shrink-0" />
      <div>{children}</div>
    </div>;
}
function Table({
  children,
  className
}) {
  return <div className={cn('overflow-x-auto', className)}>
      <table className="w-full text-left text-sm">{children}</table>
    </div>;
}
const Th = ({
  children,
  className,
  ...p
}) => <th className={cn('whitespace-nowrap bg-slate-50 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500', className)} {...p}>
    {children}
  </th>;
const Td = ({
  children,
  className,
  ...p
}) => <td className={cn('px-4 py-3 align-middle', className)} {...p}>
    {children}
  </td>;
/* ---------- Toasts ---------- */

const ToastContext = createContext(() => {});
function ToastProvider({
  children
}) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, tone = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts(t => [...t, {
      id,
      message,
      tone
    }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 5200);
  }, []);
  return <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map(t => <div key={t.id} className="vl-fade-in pointer-events-auto flex items-start gap-2.5 rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm shadow-lg">
            {t.tone === 'success' ? <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-600" /> : t.tone === 'error' ? <XCircle size={17} className="mt-0.5 shrink-0 text-red-600" /> : <Info size={17} className="mt-0.5 shrink-0 text-brand-600" />}
            <span className="text-slate-700">{t.message}</span>
          </div>)}
      </div>
    </ToastContext.Provider>;
}
const useToast = () => useContext(ToastContext);
const fmtDateTime = iso => iso ? new Date(iso).toLocaleString('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit'
}) : '—';
const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric'
}) : '—';
const fmtNum = n => n == null ? '—' : Number(n).toLocaleString('en-US');

// ==================== components/bank.jsx ====================
const bankName = b => b === 'COORDINATOR' ? 'Coordinator' : `Bank ${b}`;
const BANK_ACCENT = {
  A: 'bg-brand-500',
  B: 'bg-emerald-500',
  C: 'bg-violet-500'
};
function BankChip({
  bank,
  state = 'none',
  you
}) {
  const styles = {
    approved: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    pending: 'border-amber-200 bg-amber-50 text-amber-800',
    declined: 'border-red-200 bg-red-50 text-red-700',
    none: 'border-slate-200 bg-slate-50 text-slate-500'
  }[state];
  const Icon = {
    approved: Check,
    pending: Clock,
    declined: X
  }[state];
  return <span className={cn('inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm font-semibold', styles)}>
      <span className={cn('h-2 w-2 rounded-full', BANK_ACCENT[bank])} />
      {bankName(bank)}
      {you && <span className="text-[10px] font-medium uppercase opacity-60">you</span>}
      {Icon && <Icon size={14} strokeWidth={3} />}
    </span>;
}
const consentState = c => ({
  APPROVED: 'approved',
  PENDING: 'pending',
  DECLINED: 'declined'
})[c] || 'none';
function Cipher({
  value,
  chars = 34,
  className
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="text-slate-400">—</span>;
  const copy = async e => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };
  return <div className={cn('group relative cursor-pointer rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs leading-relaxed text-slate-600', className)} onClick={() => setOpen(o => !o)} title={open ? 'Click to collapse' : 'Click to expand full ciphertext'}>
      <span className={open ? 'break-all' : 'block truncate pr-6'}>
        {open ? value : `${value.slice(0, chars)}…`}
      </span>
      <button onClick={copy} className="absolute right-1.5 top-1.5 rounded p-1 text-slate-400 opacity-0 hover:bg-white hover:text-slate-700 group-hover:opacity-100" aria-label="Copy ciphertext">
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
      {!open && <span className="mt-0.5 block text-[10px] text-slate-400">{value.length} digits</span>}
    </div>;
}
function ProtectedBadge() {
  return <Badge tone="navy">🔒 Protected</Badge>;
}
const AUDIT_LABELS = {
  LOGIN: 'Login',
  LOGOUT: 'Logout',
  LOGIN_FAILED: 'Failed login',
  INVESTIGATION_INITIATED: 'Investigation initiated',
  PARTICIPATION_APPROVED: 'Participation approved',
  PARTICIPATION_DECLINED: 'Participation declined',
  ALL_PARTICIPANTS_APPROVED: 'All participants approved',
  INVESTIGATION_CANCELLED: 'Investigation cancelled',
  ANALYSIS_STARTED: 'Analysis started',
  LOCAL_ACCOUNT_FLAGGED: 'Local account flagged',
  LOCAL_ACCOUNT_UNFLAGGED: 'Local account unflagged',
  LOCAL_RISK_ANALYSIS_RUN: 'Local risk analysis run',
  LOCAL_RISK_ANALYSIS_COMPLETED: 'Local risk analysis completed',
  PSI_COMPLETED: 'PSI completed',
  NO_CROSS_BANK_MATCHES: 'No cross-bank matches',
  ENCRYPTION_COMPLETED: 'Encryption completed',
  AGGREGATION_COMPLETED: 'Homomorphic aggregation completed',
  DECRYPTION_SHARE_APPROVED: 'Key share approved',
  DECRYPTION_DENIED: 'Decryption denied',
  DECRYPTION_APPROVED: 'Decryption approved',
  JOINT_RISK_DECRYPTED: 'Joint risk decrypted',
  IDENTITY_REVEAL_REQUESTED: 'Identity reveal requested',
  IDENTITY_REVEAL_APPROVED: 'Identity reveal approved',
  IDENTITY_REVEAL_REJECTED: 'Identity reveal rejected',
  IDENTITY_REVEALED: 'Identity revealed (threshold reached)',
  IDENTITY_REVEAL_DENIED: 'Identity reveal denied'
};
const auditTone = a => {
  if (/DECLINED|REJECTED|DENIED|CANCELLED|FAILED/.test(a)) return 'red';
  if (/APPROVED|COMPLETED|REVEALED|DECRYPTED/.test(a)) return 'green';
  if (/FLAGGED/.test(a)) return 'yellow';
  if (/REQUESTED|INITIATED|STARTED/.test(a)) return 'blue';
  return 'slate';
};
const PRIVACY_INDICATORS = [{
  icon: '🔒',
  text: 'Raw data stays local'
}, {
  icon: '🔐',
  text: 'Risk scores encrypted'
}, {
  icon: '🛡️',
  text: 'PSI protects private account sets'
}, {
  icon: '🔑',
  text: '2-of-3 threshold consent'
}, {
  icon: '👤',
  text: 'Identity protected by default'
}];
function PrivacyChips({
  className,
  dark
}) {
  return <ul className={cn('flex flex-wrap gap-2', className)}>
      {PRIVACY_INDICATORS.map(p => <li key={p.text} className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium', dark ? 'border-white/15 bg-white/5 text-navy-100' : 'border-slate-200 bg-white text-slate-600')}>
          <span aria-hidden>{p.icon}</span>
          {p.text}
        </li>)}
    </ul>;
}

// ==================== components/PipelineStepper.jsx ====================
function stepState(i, inv) {
  const {
    status,
    current_step: cur
  } = inv;
  switch (status) {
    case 'CANCELLED':
      return i === 1 ? 'failed' : 'pending';
    case 'FAILED':
      return i < cur ? 'done' : i === cur ? 'failed' : 'pending';
    case 'COMPLETED':
      return 'done';
    case 'PENDING_CONSENT':
      return i === 1 ? 'waiting' : 'pending';
    case 'APPROVED':
      return i === 1 ? 'done' : i === 2 ? 'ready' : 'pending';
    case 'RUNNING':
      return i < cur ? 'done' : i === cur ? 'active' : 'pending';
    case 'AWAITING_DECRYPTION':
      return i < 7 ? 'done' : i === 7 ? 'waiting' : 'pending';
    default:
      return 'pending';
  }
}
function StepIcon({
  state
}) {
  const base = 'flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs';
  switch (state) {
    case 'done':
      return <span className={cn(base, 'border-emerald-500 bg-emerald-500 text-white')}>
          <Check size={14} strokeWidth={3} />
        </span>;
    case 'active':
      return <span className={cn(base, 'vl-pulse border-brand-500 bg-white text-brand-600')}>
          <Loader2 size={14} className="animate-spin" />
        </span>;
    case 'waiting':
      return <span className={cn(base, 'vl-pulse border-amber-400 bg-white text-amber-600')}>
          <Clock size={13} />
        </span>;
    case 'ready':
      return <span className={cn(base, 'border-brand-400 bg-brand-50 text-brand-600')}>
          <MoveRight size={14} />
        </span>;
    case 'failed':
      return <span className={cn(base, 'border-red-500 bg-red-500 text-white')}>
          <X size={14} strokeWidth={3} />
        </span>;
    default:
      return <span className={cn(base, 'border-slate-200 bg-white text-slate-300')} />;
  }
}
const SUBTEXT = {
  1: 'All required banks explicitly agree',
  2: 'Each bank prepares its private flagged set',
  3: 'Blinded exchange – only matches revealed',
  4: 'Accounts flagged by ≥ 2 banks',
  5: 'Local scores encrypted at source',
  6: 'Coordinator adds ciphertexts',
  7: '2-of-3 key shares must consent',
  8: 'Joint risk with identity protected'
};
function PipelineStepper({
  inv
}) {
  return <ol className="relative space-y-1">
      {inv.steps.map((label, idx) => {
      const i = idx + 1;
      const state = stepState(i, inv);
      return <li key={label} className="relative flex gap-3 pb-3">
            {i < inv.steps.length && <span className={cn('absolute left-[13px] top-7 h-[calc(100%-1.25rem)] w-0.5', state === 'done' ? 'bg-emerald-300' : 'bg-slate-200', state === 'active' && 'vl-flow-line bg-transparent')} />}
            <StepIcon state={state} />
            <div className="pt-0.5">
              <p className={cn('text-sm font-semibold', state === 'pending' ? 'text-slate-400' : 'text-navy-900', state === 'active' && 'text-brand-700')}>
                {i}. {label}
              </p>
              <p className="text-xs text-slate-500">
                {state === 'active' ? 'In progress…' : state === 'waiting' && i === 7 ? 'Waiting for key-share approvals' : state === 'waiting' ? 'Waiting for bank approvals' : state === 'ready' ? 'Ready to start' : SUBTEXT[i]}
              </p>
            </div>
          </li>;
    })}
    </ol>;
}

// ==================== components/Identity.jsx ====================
function IdentityPanel({
  account,
  investigationId,
  onChanged
}) {
  const toast = useToast();
  const [dialog, setDialog] = useState(null); // 'request' | 'approve' | 'reject'
  const [reason, setReason] = useState('Cross-bank fraud investigation');
  const [busy, setBusy] = useState(false);
  const req = account.identity_request;
  const submit = async () => {
    setBusy(true);
    try {
      if (dialog === 'request') {
        await api(`/investigations/${investigationId}/identity-request`, {
          method: 'POST',
          body: {
            result_id: account.id,
            reason
          }
        });
        toast('Identity reveal requested. Other flagging banks have been notified.', 'success');
      } else {
        await api(`/investigations/${investigationId}/identity-${dialog === 'approve' ? 'approve' : 'reject'}`, {
          method: 'POST',
          body: {
            request_id: req.id
          }
        });
        toast(dialog === 'approve' ? 'You approved the identity reveal.' : 'Identity kept private.', dialog === 'approve' ? 'success' : 'info');
      }
      setDialog(null);
      await onChanged?.();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  /* ----- Revealed: final fraud alert ----- */
  if (account.identity.state === 'REVEALED') {
    return <FraudAlert account={account} />;
  }
  return <div className="space-y-3">
      {/* Protected identity */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Identity
          </p>
          <p className="mt-0.5 flex items-center gap-2 text-sm font-semibold text-navy-900">
            <Lock size={15} /> PROTECTED
            <span className="text-xs font-normal text-slate-500">
              – actual account ID stays hidden until banks consent
            </span>
          </p>
        </div>
        {account.can_request_identity && <Button icon={KeyRound} onClick={() => setDialog('request')}>
            Request identity reveal
          </Button>}
      </div>

      {!account.decrypted && <p className="text-xs text-slate-500">
          Identity reveal can be requested once threshold decryption has completed.
        </p>}
      {account.decrypted && !account.i_flagged && <p className="text-xs text-slate-500">
          Your bank did not flag this account, so it cannot request or vote on its identity.
        </p>}

      {/* Pending / denied request */}
      {req && req.status !== 'REVEALED' && <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-700">
              Identity reveal request
            </p>
            {req.status === 'DENIED' && <Badge tone="red">Denied</Badge>}
            {req.status === 'PENDING' && <Badge tone="yellow">Pending consent</Badge>}
          </div>

          <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-slate-500">Requested by</dt>
              <dd className="font-semibold text-navy-900">{bankName(req.requested_by)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Account</dt>
              <dd className="font-mono font-semibold text-navy-900">{account.token_short}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-slate-500">Reason</dt>
              <dd className="text-slate-700">{req.reason || 'Cross-bank fraud investigation'}</dd>
            </div>
          </dl>

          <p className="mt-3 text-xs font-medium text-slate-500">Current approvals</p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {req.eligible_banks.map(b => <BankChip key={b} bank={b} state={req.approvals.includes(b) ? 'approved' : req.rejections.includes(b) ? 'declined' : 'pending'} />)}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
            <span className="text-slate-600">
              Required approvals: <b className="text-navy-900">{req.threshold}</b>
            </span>
            <span className="text-slate-600">
              Approvals:{' '}
              <b className="text-navy-900">
                {req.approvals.length} / {req.eligible_banks.length}
              </b>
            </span>
          </div>

          {req.status === 'PENDING' && <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-amber-700">
              <AlertTriangle size={15} /> THRESHOLD NOT REACHED – identity remains protected
            </p>}
          {req.status === 'DENIED' && <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-red-700">
              <ShieldCheck size={15} /> Request denied – identity remains protected
            </p>}

          {req.can_vote && <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-sm text-slate-700">
                {bankName(req.requested_by)} has requested disclosure of this account's identity.{' '}
                <b>Do you approve?</b>
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="success" icon={Check} onClick={() => setDialog('approve')}>
                  Agree to reveal
                </Button>
                <Button variant="secondary" icon={Lock} onClick={() => setDialog('reject')}>
                  Keep identity private
                </Button>
              </div>
            </div>}
          {req.my_vote && req.status === 'PENDING' && <p className="mt-3 text-xs text-slate-500">
              You voted: <b>{req.my_vote === 'APPROVE' ? 'Agree to reveal' : 'Keep private'}</b>.
              Waiting for the remaining banks.
            </p>}
        </div>}

      <Modal open={dialog === 'request'} onClose={() => setDialog(null)} title="Request identity reveal" footer={<>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button icon={KeyRound} loading={busy} onClick={submit}>
              Send request
            </Button>
          </>}>
        <p className="text-sm text-slate-600">
          This is a <b>separate consent stage</b>. The other banks that flagged account{' '}
          <span className="font-mono font-semibold">{account.token_short}</span> will be asked to
          approve. The identity is only revealed when at least <b>2</b> banks approve.
        </p>
        <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-slate-500">
          Reason
        </label>
        <input value={reason} onChange={e => setReason(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" maxLength={200} />
      </Modal>

      <Modal open={dialog === 'approve' || dialog === 'reject'} onClose={() => setDialog(null)} title={dialog === 'approve' ? 'Agree to reveal identity?' : 'Keep identity private?'} size="sm" footer={<>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button variant={dialog === 'approve' ? 'success' : 'dark'} loading={busy} onClick={submit}>
              {dialog === 'approve' ? 'Confirm – agree to reveal' : 'Confirm – keep private'}
            </Button>
          </>}>
        <p className="text-sm text-slate-600">
          {dialog === 'approve' ? 'Your approval counts toward the 2-of-3 threshold. If the threshold is reached, the real account ID is disclosed to the banks that flagged it.' : 'Your bank will withhold consent. If the threshold can no longer be reached the identity stays protected.'}
        </p>
      </Modal>
    </div>;
}
/* ------------------------------------------------------------------ */

function FraudAlert({
  account
}) {
  const req = account.identity_request;
  return <div className="overflow-hidden rounded-xl border border-red-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-red-600 px-4 py-2.5 text-white">
        <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
          <ShieldAlert size={17} /> Cross-bank fraud alert
        </p>
        <span className="flex items-center gap-1.5 text-xs font-semibold">
          <Unlock size={13} /> Identity revealed
        </span>
      </div>
      <div className="grid gap-4 p-4 sm:grid-cols-2">
        <Field label="Account">
          <span className="font-mono text-lg font-bold text-navy-950">
            {account.identity.entity_id}
          </span>
        </Field>
        <Field label="Previously protected identifier">
          <span className="font-mono text-sm text-slate-700">{account.token_short}</span>
        </Field>
        <Field label="Flagged by">
          <span className="flex flex-wrap gap-1.5">
            {account.banks.map(b => <BankChip key={b} bank={b} state="approved" />)}
          </span>
        </Field>
        <Field label="Joint risk">
          <span className="text-lg font-bold text-red-600">{account.joint_risk}</span>
        </Field>
        <Field label="Identity reveal">
          Approved by {req?.approvals.length} participating bank
          {req?.approvals.length === 1 ? '' : 's'} ({req?.approvals.map(bankName).join(', ')})
        </Field>
        <Field label="Your local account">
          <span className="font-mono text-sm font-semibold">
            {account.identity.local_account_id || '—'}
          </span>
        </Field>
        <Field label="Status">
          {account.fraud_ring_candidate ? <Badge tone="red">🚨 Fraud ring candidate</Badge> : <Badge tone="yellow">Below joint-risk threshold</Badge>}
        </Field>
        <Field label="Raw transaction data">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
            <Check size={15} strokeWidth={3} /> Never shared
          </span>
        </Field>
      </div>
    </div>;
}
const Field = ({
  label,
  children
}) => <div>
    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
    <div className="mt-1 text-sm text-slate-800">{children}</div>
  </div>;

/* ------------------------------------------------------------------ */
/* Table of suspicious cross-bank accounts with expandable detail      */
/* ------------------------------------------------------------------ */

function RiskCell({
  a
}) {
  if (!a.decrypted) return <span className="inline-flex items-center gap-1 text-xs text-slate-400">
        <Clock size={12} /> encrypted
      </span>;
  return <span className={cn('text-base font-bold tabular-nums', a.risk_status === 'HIGH RISK' ? 'text-red-600' : 'text-slate-800')}>
      {a.joint_risk}
    </span>;
}
function SuspiciousTable({
  rows,
  onChanged,
  showInvestigation,
  defaultOpen
}) {
  const {
    session
  } = useAuth();
  const [open, setOpen] = useState(defaultOpen ?? null);
  return <Table>
      <thead>
        <tr>
          <Th className="w-8" />
          <Th>Account hash</Th>
          <Th>Banks flagging</Th>
          <Th>Bank count</Th>
          <Th>Joint risk</Th>
          <Th>Status</Th>
          <Th>Identity</Th>
          {showInvestigation && <Th>Investigation</Th>}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map(a => {
        const key = `${a.investigation_id}-${a.id}`;
        const isOpen = open === key;
        return <Fragment key={key}>
              <tr className={cn('hover:bg-slate-50/70', isOpen && 'bg-slate-50')} onClick={() => setOpen(isOpen ? null : key)} style={{
            cursor: 'pointer'
          }}>
                <Td className="text-slate-400">
                  {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </Td>
                <Td className="font-mono text-sm font-semibold text-navy-900">{a.token_short}</Td>
                <Td>{a.banks.map(b => b).join(', ')}</Td>
                <Td className="tabular-nums">{a.bank_count}</Td>
                <Td>
                  <RiskCell a={a} />
                </Td>
                <Td>
                  {a.risk_status === 'HIGH RISK' ? <Badge tone="red">High risk</Badge> : a.risk_status === 'LOW RISK' ? <Badge tone="green">Low risk</Badge> : <Badge tone="slate">Pending</Badge>}
                </Td>
                <Td>
                  {a.identity.state === 'REVEALED' ? <Badge tone="red" icon={Unlock}>
                      Revealed
                    </Badge> : <ProtectedBadge />}
                </Td>
                {showInvestigation && <Td className="font-mono text-xs text-slate-500">{a.investigation_id}</Td>}
              </tr>
              {isOpen && <tr className="bg-slate-50">
                  <td colSpan={showInvestigation ? 8 : 7} className="px-4 pb-5 pt-1">
                    <AccountCard account={a} me={session.bank} onChanged={onChanged} />
                  </td>
                </tr>}
            </Fragment>;
      })}
      </tbody>
    </Table>;
}
function AccountCard({
  account: a,
  onChanged
}) {
  return <div className="vl-fade-in grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-navy-700">
          Joint risk result
        </p>
        <dl className="mt-3 space-y-3 text-sm">
          <Field label="Account">
            <span className="font-mono font-semibold">{a.token_short}</span>
          </Field>
          <Field label="Participating banks">{a.banks.map(b => bankName(b)).join(', ')}</Field>
          <Field label="Joint risk">
            {a.decrypted ? <span className="text-2xl font-bold text-navy-950">{a.joint_risk}</span> : <span className="text-slate-500">Encrypted – awaiting 2-of-3 threshold decryption</span>}
          </Field>
          {a.decrypted && <Field label="Status">
              {a.fraud_ring_candidate ? <span className="font-semibold text-red-600">
                  🚨 CROSS-BANK FRAUD RING CANDIDATE
                </span> : <span className="font-semibold text-slate-600">Below fraud-ring threshold</span>}
            </Field>}
          <Field label="Identity">
            {a.identity.state === 'REVEALED' ? <span className="flex items-center gap-1.5 font-semibold text-red-700">
                <Unlock size={14} /> Revealed (see alert)
              </span> : <span className="flex items-center gap-1.5 font-semibold text-navy-900">
                <Lock size={14} /> PROTECTED
              </span>}
          </Field>
        </dl>
      </div>
      <IdentityPanel account={a} investigationId={a.investigation_id} onChanged={onChanged} />
    </div>;
}

// ==================== components/KineticGrid.tsx ====================
// ─── Types ────────────────────────────────────────────────────────────────────

// ─── Constants ────────────────────────────────────────────────────────────────

const CELL_SIZE = 55; // Desktop-ish size. Will dictate cols/rows
const INFLUENCE_RADIUS = 260;
const MAX_WARP = 24;
const DOT_SPACING = 28;
const LERP_SPEED = 0.08;
const LINE_BASE = {
  r: 255,
  g: 255,
  b: 255,
  a: 0.13
};
const NODE_BASE_RADIUS = 1.8;
const NODE_ACTIVE_RADIUS = 3.2;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function lerpN(a, b, t) {
  return a + (b - a) * t;
}
function lerpColor(base, active, t) {
  const r = Math.round(lerpN(base.r, active.r, t));
  const g = Math.round(lerpN(base.g, active.g, t));
  const b = Math.round(lerpN(base.b, active.b, t));
  const a = lerpN(base.a, active.a, t);
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
}

// ─── Component ────────────────────────────────────────────────────────────────

function KineticGrid({
  children,
  className,
  globalColor = "default"
}) {
  const canvasRef = useRef(null);
  const mouseRef = useRef({
    x: -9999,
    y: -9999
  });
  const targetMouseRef = useRef({
    x: -9999,
    y: -9999
  });
  const ripplesRef = useRef([]);
  const rafRef = useRef(0);
  const sizeRef = useRef({
    w: 0,
    h: 0
  });

  // ── Warp ────────────────────────────────────────────────────────────────────

  const getWarpedPoint = useCallback((gx, gy, col, row, mouse, ripples, cols, rows) => {
    // Edge pin — smoothly locks boundary rows/cols in place
    const edgeMargin = 1.5;
    const colPin = Math.min(col / edgeMargin, (cols - 1 - col) / edgeMargin, 1);
    const rowPin = Math.min(row / edgeMargin, (rows - 1 - row) / edgeMargin, 1);
    const pinFactor = colPin * colPin * rowPin * rowPin;
    const dx = gx - mouse.x;
    const dy = gy - mouse.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const proximity = Math.max(0, 1 - dist / INFLUENCE_RADIUS) * pinFactor;

    // Ripple displacement
    let rx = 0,
      ry = 0;
    for (const r of ripples) {
      const rdx = gx - r.x;
      const rdy = gy - r.y;
      const rdist = Math.sqrt(rdx * rdx + rdy * rdy);
      const waveWidth = 55;
      const diff = rdist - r.radius;
      if (Math.abs(diff) < waveWidth) {
        const strength = (1 - Math.abs(diff) / waveWidth) * r.opacity * 18 * pinFactor;
        const angle = Math.atan2(rdy, rdx);
        const sign = diff < 0 ? -1 : 1;
        rx += Math.cos(angle) * strength * sign * -1;
        ry += Math.sin(angle) * strength * sign * -1;
      }
    }

    // Cursor warp with bell falloff
    if (dist < INFLUENCE_RADIUS && dist > 0 && pinFactor > 0) {
      const t = dist / INFLUENCE_RADIUS;
      const eased = t < 0.01 ? 0 : (1 - t) * (1 - t) * Math.min(1, dist / 60);
      const warpAmt = eased * MAX_WARP * pinFactor;
      const angle = Math.atan2(dy, dx);
      return {
        pt: {
          x: gx - Math.cos(angle) * warpAmt + rx,
          y: gy - Math.sin(angle) * warpAmt + ry
        },
        proximity
      };
    }
    return {
      pt: {
        x: gx + rx,
        y: gy + ry
      },
      proximity
    };
  }, []);

  // ── Draw ────────────────────────────────────────────────────────────────────

  const draw = useCallback(now => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const {
      w: W,
      h: H
    } = sizeRef.current;
    const mouse = mouseRef.current;
    const ripples = ripplesRef.current;
    const theme = {
      default: {
        bg: "#161618",
        lineActive: {
          r: 74,
          g: 158,
          b: 255,
          a: 0.9
        },
        nodeActive: {
          r: 74,
          g: 158,
          b: 255,
          a: 1.0
        },
        glow: "74,158,255",
        ripple: "100,180,255"
      },
      monochrome: {
        bg: "#000000",
        lineActive: {
          r: 255,
          g: 255,
          b: 255,
          a: 0.9
        },
        nodeActive: {
          r: 255,
          g: 255,
          b: 255,
          a: 1.0
        },
        glow: "255,255,255",
        ripple: "255,255,255"
      }
    }[globalColor ?? "default"];
    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, W, H);

    // Static background dot texture
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    for (let x = DOT_SPACING / 2; x < W; x += DOT_SPACING) {
      for (let y = DOT_SPACING / 2; y < H; y += DOT_SPACING) {
        ctx.beginPath();
        ctx.arc(x, y, 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Update ripples
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      const age = (now - r.born) / 1000;
      // FIX: Ensure radius is never negative
      r.radius = Math.max(0, age * 400);
      r.opacity = Math.max(0, 1 - age * 1.2);
      if (r.opacity <= 0) ripples.splice(i, 1);
    }

    // ── Build warped grid ─────────────────────────────────────────────────
    const cols = Math.max(2, Math.ceil(W / CELL_SIZE)) + 1;
    const rows = Math.max(2, Math.ceil(H / CELL_SIZE)) + 1;
    const cellW = W / (cols - 1);
    const cellH = H / (rows - 1);
    const pts = [];
    const prox = [];
    for (let row = 0; row < rows; row++) {
      pts[row] = [];
      prox[row] = [];
      for (let col = 0; col < cols; col++) {
        const {
          pt,
          proximity
        } = getWarpedPoint(col * cellW, row * cellH, col, row, mouse, ripples, cols, rows);
        pts[row][col] = pt;
        prox[row][col] = proximity;
      }
    }

    // ── Grid lines ────────────────────────────────────────────────────────
    const drawSeg = (p1, p2, pr1, pr2) => {
      const avg = (pr1 + pr2) / 2;
      const t = avg * avg * (3 - 2 * avg); // smoothstep
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.strokeStyle = lerpColor(LINE_BASE, theme.lineActive, t);
      ctx.lineWidth = lerpN(0.8, 1.5, t);
      ctx.stroke();
    };
    ctx.lineCap = "butt";
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols - 1; col++) drawSeg(pts[row][col], pts[row][col + 1], prox[row][col], prox[row][col + 1]);
    for (let col = 0; col < cols; col++) for (let row = 0; row < rows - 1; row++) drawSeg(pts[row][col], pts[row + 1][col], prox[row][col], prox[row + 1][col]);

    // ── Intersection nodes ────────────────────────────────────────────────
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const p = pts[row][col];
        const pr = prox[row][col];
        const t = pr * pr * (3 - 2 * pr); // smoothstep
        const r = lerpN(NODE_BASE_RADIUS, NODE_ACTIVE_RADIUS, t);

        // Outer glow ring for active nodes
        if (t > 0.3) {
          const glowR = r + lerpN(0, 6, (t - 0.3) / 0.7);
          const grd = ctx.createRadialGradient(p.x, p.y, r * 0.5, p.x, p.y, glowR);
          grd.addColorStop(0, `rgba(${theme.glow},${(t * 0.3).toFixed(3)})`);
          grd.addColorStop(1, `rgba(${theme.glow},0)`);
          ctx.beginPath();
          ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
          ctx.fillStyle = grd;
          ctx.fill();
        }

        // Node fill
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = lerpColor({
          r: 255,
          g: 255,
          b: 255,
          a: 0.2
        }, theme.nodeActive, t);
        ctx.fill();
      }
    }

    // ── Ripple rings ──────────────────────────────────────────────────────
    for (const r of ripples) {
      // FIX: Ensure radius is positive before drawing arc
      const safeRadius = Math.max(0, r.radius);
      ctx.beginPath();
      ctx.arc(r.x, r.y, safeRadius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${theme.ripple},${(r.opacity * 0.28).toFixed(3)})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }, [getWarpedPoint, globalColor]);

  // ── Animation loop ──────────────────────────────────────────────────────────

  const animate = useCallback(now => {
    const m = mouseRef.current;
    const t = targetMouseRef.current;
    m.x = lerpN(m.x, t.x, LERP_SPEED);
    m.y = lerpN(m.y, t.y, LERP_SPEED);
    draw(now);
    rafRef.current = requestAnimationFrame(animate);
  }, [draw]);

  // ── Setup ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const setSize = () => {
      const parent = canvas.parentElement;
      const w = parent ? parent.clientWidth : window.innerWidth;
      const h = parent ? parent.clientHeight : window.innerHeight;
      canvas.width = w;
      canvas.height = h;
      sizeRef.current = {
        w,
        h
      };
      if (mouseRef.current.x === -9999) {
        mouseRef.current = {
          x: -9999,
          y: -9999
        };
        targetMouseRef.current = {
          x: -9999,
          y: -9999
        };
      }
    };
    setSize();
    window.addEventListener("resize", setSize);
    const onMouseMove = e => {
      const rect = canvas.getBoundingClientRect();
      targetMouseRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
    };
    const onClick = e => {
      const rect = canvas.getBoundingClientRect();
      ripplesRef.current.push({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        radius: 0,
        opacity: 1,
        born: performance.now()
      });
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("click", onClick);
    rafRef.current = requestAnimationFrame(animate);
    return () => {
      window.removeEventListener("resize", setSize);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("click", onClick);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [animate]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return <div className={cn("relative w-full h-full overflow-hidden", globalColor === "monochrome" ? "bg-[#000000]" : "bg-[#161618]", className)}>
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full z-0 pointer-events-none" />

      <div className="relative z-10 w-full h-full">{children}</div>
    </div>;
}

// ==================== components/Layout.jsx ====================
const SummaryContext = createContext(null);
const useSummary = () => useContext(SummaryContext);
function Layout() {
  const {
    session,
    logout
  } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const fetchSummary = useCallback(() => api(`/banks/${session.bank}/summary`), [session.bank]);
  const {
    data: summary,
    refresh
  } = usePolling(fetchSummary, 4000);

  // Notify when new requests arrive for this bank.
  const prev = useRef(null);
  useEffect(() => {
    if (!summary) return;
    const now = {
      req: summary.investigations.pending_requests,
      share: summary.investigations.pending_decryption_approvals,
      identity: summary.alerts.pending_identity_requests
    };
    if (prev.current) {
      if (now.req > prev.current.req) toast('New cross-bank investigation request awaiting your consent.', 'info');
      if (now.identity > prev.current.identity) toast('A bank has requested an identity reveal – your decision is needed.', 'info');
      if (now.share > prev.current.share) toast('An investigation is awaiting your threshold key-share approval.', 'info');
    }
    prev.current = now;
  }, [summary, toast]);
  useEffect(() => setMobileOpen(false), [location.pathname]);
  const badges = {
    '/investigations': summary ? summary.investigations.pending_requests + summary.investigations.pending_decryption_approvals : 0,
    '/identity-requests': summary ? summary.alerts.pending_identity_requests : 0
  };
  const nav = [{
    to: '/',
    label: 'Dashboard',
    icon: LayoutDashboard,
    end: true
  }, {
    to: '/customers',
    label: 'Customers',
    icon: Users
  }, {
    to: '/risk-analysis',
    label: 'Risk Analysis',
    icon: Activity
  }, {
    to: '/investigations',
    label: 'Investigations',
    icon: Network
  }, {
    to: '/suspicious-accounts',
    label: 'Suspicious Accounts',
    icon: ShieldAlert
  }, {
    to: '/identity-requests',
    label: 'Identity Requests',
    icon: KeyRound
  }, {
    to: '/audit-logs',
    label: 'Audit Logs',
    icon: ClipboardList
  }, {
    to: '/privacy',
    label: 'Privacy & Security',
    icon: ShieldCheck
  }];
  const doLogout = async () => {
    await logout();
    navigate('/login');
  };
  const sidebar = <div className="flex h-full flex-col bg-navy-950 text-navy-100">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500/15 text-brand-300 ring-1 ring-brand-400/30">
          <ShieldCheck size={19} />
        </span>
        <div>
          <p className="text-[15px] font-bold tracking-[0.14em] text-white">VAULTLEDGER</p>
          <p className="text-[10px] uppercase tracking-widest text-navy-300">Consortium node</p>
        </div>
      </div>

      <div className="mx-4 mb-3 rounded-xl border border-white/10 bg-white/5 px-3.5 py-3">
        <p className="text-sm font-bold tracking-wide text-white">BANK {session.bank}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-emerald-300">
          <span className="h-2 w-2 rounded-full bg-emerald-400" /> Online
        </p>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3" aria-label="Main">
        {nav.map(({
        to,
        label,
        icon: Icon,
        end
      }) => <NavLink key={to} to={to} end={end} className={({
        isActive
      }) => cn('flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors', isActive ? 'bg-brand-500/15 text-white ring-1 ring-brand-400/25' : 'text-navy-200 hover:bg-white/5 hover:text-white')}>
            <Icon size={17} />
            <span className="flex-1">{label}</span>
            {badges[to] > 0 && <span className="rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-navy-950">
                {badges[to]}
              </span>}
          </NavLink>)}
      </nav>

      <div className="border-t border-white/10 p-3">
        <button onClick={doLogout} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-navy-200 hover:bg-white/5 hover:text-white">
          <LogOut size={17} /> Logout
        </button>
      </div>
    </div>;
  return <SummaryContext.Provider value={{
    summary,
    refresh
  }}>
      <div className="flex h-full">
        <aside className="hidden w-64 shrink-0 lg:block">{sidebar}</aside>

        {mobileOpen && <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-navy-950/60" onClick={() => setMobileOpen(false)} />
            <div className="absolute inset-y-0 left-0 w-64 shadow-2xl">{sidebar}</div>
          </div>}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5 lg:hidden">
            <button onClick={() => setMobileOpen(o => !o)} className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100" aria-label="Toggle navigation">
              {mobileOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <span className="text-sm font-bold tracking-[0.14em] text-navy-950">VAULTLEDGER</span>
            <span className="ml-auto text-xs font-semibold text-navy-700">BANK {session.bank}</span>
          </header>

          <div role="note" className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-navy-900 px-4 py-2 text-xs text-navy-100 sm:px-6">
            <Lock size={13} className="shrink-0 text-brand-300" />
            <span className="font-medium">
              VaultLedger never transfers raw customer transaction data between participating banks.
            </span>
            <span className="ml-auto rounded-full border border-amber-300/40 bg-amber-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-200">
              Academic prototype · not production crypto
            </span>
          </div>

          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </SummaryContext.Provider>;
}

export { cn, Card, CardHeader, PageHeader, Badge, StatusBadge, LevelBadge, INVESTIGATION_STATUS, InvestigationStatusBadge, Button, Modal, StatCard, RiskBar, Spinner, EmptyState, ErrorNote, Callout, Table, Th, Td, ToastProvider, useToast, fmtDateTime, fmtDate, fmtNum, bankName, BANK_ACCENT, BankChip, consentState, Cipher, ProtectedBadge, AUDIT_LABELS, auditTone, PRIVACY_INDICATORS, PrivacyChips, stepState, PipelineStepper, IdentityPanel, SuspiciousTable, AccountCard, KineticGrid, useSummary, Layout,  };
