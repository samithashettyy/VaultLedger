import {
  useCallback,
  useState,
  useMemo
} from "react";
import {
  ClipboardList,
  Filter,
  Search,
  AlertTriangle,
  ArrowUpDown,
  Eye,
  Flag,
  Info,
  Lock,
  ShieldAlert,
  ShieldCheck,
  UserX,
  Activity,
  ArrowRight,
  CheckCircle2,
  Clock,
  Database,
  KeyRound,
  Network,
  Users,
  Wallet,
  Check,
  X,
  ArrowLeft,
  Play,
  Unlock,
  Landmark,
  Plus,
  UserCheck,
  EyeOff,
  Loader2,
  ArrowDown,
  FileCheck,
  Sliders
} from "lucide-react";
import {
  api,
  useAuth,
  usePolling
} from "./services.jsx";
import {
  AUDIT_LABELS,
  auditTone,
  bankName,
  Badge,
  Card,
  fmtDateTime,
  PageHeader,
  Spinner,
  Table,
  Td,
  Th,
  useSummary,
  Button,
  Callout,
  fmtDate,
  fmtNum,
  LevelBadge,
  Modal,
  RiskBar,
  StatusBadge,
  useToast,
  cn,
  PrivacyChips,
  CardHeader,
  InvestigationStatusBadge,
  StatCard,
  BankChip,
  Cipher,
  consentState,
  PipelineStepper,
  AccountCard,
  SuspiciousTable,
  KineticGrid,
  Layout
} from "./components.jsx";
import {
  Link,
  useParams,
  useNavigate,
  Navigate,
  Route,
  Routes
} from "react-router-dom";

// Consolidated VaultLedger frontend. Sections retain their original responsibilities.

// ==================== pages/AuditLogs.jsx ====================
function AuditLogs() {
  const {
    session
  } = useAuth();
  const fetchLogs = useCallback(() => api('/audit-logs?limit=500'), []);
  const {
    data,
    loading
  } = usePolling(fetchLogs, 5000);
  const [search, setSearch] = useState('');
  const [bankFilter, setBankFilter] = useState('ALL');
  const logs = data?.logs || [];
  const filtered = logs.filter(l => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q || l.action.toLowerCase().includes(q) || l.investigation_id && l.investigation_id.toLowerCase().includes(q) || l.account_ref && l.account_ref.toLowerCase().includes(q) || l.details && l.details.toLowerCase().includes(q);
    if (!matchesSearch) return false;
    if (bankFilter !== 'ALL' && l.bank !== bankFilter) return false;
    return true;
  });
  if (loading && !data) return <Spinner label="Loading audit logs…" />;
  return <div className="space-y-6">
      <PageHeader eyebrow="Compliance & Accountability" title="Consortium Audit Log" subtitle="Immutable audit record of all local actions, participation consent, cryptographic stages, and identity reveal votes." />

      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="relative flex-1 min-w-[240px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="Search audit actions, investigation code, account ref…" value={search} onChange={e => setSearch(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-4 py-2 text-sm focus:border-brand-500 focus:outline-none" />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1">
              <Filter size={14} /> Bank:
            </span>
            <select value={bankFilter} onChange={e => setBankFilter(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 focus:border-brand-500 focus:outline-none">
              <option value="ALL">All Event Sources</option>
              <option value={session.bank}>My Bank ({bankName(session.bank)})</option>
              <option value="COORDINATOR">Coordinator Node</option>
              <option value="A">Bank A</option>
              <option value="B">Bank B</option>
              <option value="C">Bank C</option>
            </select>
          </div>
        </div>
      </Card>

      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Timestamp</Th>
              <Th>Bank / Actor</Th>
              <Th>Action Event</Th>
              <Th>Investigation</Th>
              <Th>Account Ref</Th>
              <Th>Details</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map(l => <tr key={l.id} className="hover:bg-slate-50">
                <Td className="text-xs text-slate-500 whitespace-nowrap">{fmtDateTime(l.ts)}</Td>
                <Td className="font-semibold text-slate-800 text-xs">{bankName(l.bank)}</Td>
                <Td>
                  <Badge tone={auditTone(l.action)}>{AUDIT_LABELS[l.action] || l.action}</Badge>
                </Td>
                <Td className="font-mono text-xs text-navy-950 font-semibold">{l.investigation_id || '—'}</Td>
                <Td className="font-mono text-xs text-slate-600">{l.account_ref || '—'}</Td>
                <Td className="text-xs text-slate-700 max-w-md truncate">{l.details || '—'}</Td>
              </tr>)}
            {filtered.length === 0 && <tr>
                <td colSpan={6} className="py-12 text-center text-sm text-slate-500">
                  No audit log entries found matching your search.
                </td>
              </tr>}
          </tbody>
        </Table>
      </Card>
    </div>;
}

// ==================== pages/Customers.jsx ====================
function Customers() {
  const {
    session
  } = useAuth();
  const {
    refresh: refreshSummary
  } = useSummary();
  const toast = useToast();
  const fetchCustomers = useCallback(() => api(`/banks/${session.bank}/customers`), [session.bank]);
  const {
    data,
    loading,
    refresh
  } = usePolling(fetchCustomers, 10000);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState('RISK_DESC');
  const [selectedAccountId, setSelectedAccountId] = useState(null);
  const [detailData, setDetailData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [flagModalAccount, setFlagModalAccount] = useState(null);
  const [flagReason, setFlagReason] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const openDetail = async accountId => {
    setSelectedAccountId(accountId);
    setDetailLoading(true);
    try {
      const res = await api(`/banks/${session.bank}/customers/${accountId}`);
      setDetailData(res);
    } catch (e) {
      toast(e.message, 'error');
      setSelectedAccountId(null);
    } finally {
      setDetailLoading(false);
    }
  };
  const handleFlagToggle = async (account, willFlag) => {
    setActionBusy(true);
    try {
      const endpoint = `/banks/${session.bank}/customers/${account.account_id}/${willFlag ? 'flag' : 'unflag'}`;
      await api(endpoint, {
        method: 'POST',
        body: {
          reason: flagReason || (willFlag ? 'Manual security flag' : 'Manual flag removed')
        }
      });
      toast(willFlag ? `Account ${account.account_id} flagged locally.` : `Local flag removed from ${account.account_id}.`, 'success');
      setFlagModalAccount(null);
      setFlagReason('');
      refresh();
      refreshSummary();
      if (selectedAccountId === account.account_id) {
        openDetail(account.account_id);
      }
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setActionBusy(false);
    }
  };
  const customers = data?.customers || [];
  const filtered = useMemo(() => {
    return customers.filter(c => {
      const q = search.trim().toLowerCase();
      const matchesSearch = !q || c.account_id.toLowerCase().includes(q) || c.customer_name && c.customer_name.toLowerCase().includes(q) || c.city && c.city.toLowerCase().includes(q);
      if (!matchesSearch) return false;
      if (statusFilter === 'NORMAL') return c.status === 'NORMAL';
      if (statusFilter === 'MEDIUM') return c.status === 'MEDIUM RISK';
      if (statusFilter === 'FLAGGED') return c.flagged;
      return true;
    }).sort((a, b) => {
      if (sortBy === 'RISK_DESC') return b.risk_score - a.risk_score;
      if (sortBy === 'RISK_ASC') return a.risk_score - b.risk_score;
      if (sortBy === 'ID_ASC') return a.account_id.localeCompare(b.account_id);
      if (sortBy === 'NAME_ASC') return (a.customer_name || '').localeCompare(b.customer_name || '');
      return 0;
    });
  }, [customers, search, statusFilter, sortBy]);
  if (loading && !data) return <Spinner label="Loading customer directory…" />;
  return <div className="space-y-6">
      <PageHeader eyebrow={`Bank ${session.bank} Directory`} title="Customer Account Management" subtitle={`Displaying all local accounts owned by ${bankName(session.bank)}. Data is strictly isolated to your bank node.`} />

      <Callout tone="navy" icon={Lock}>
        <b>Privacy Guarantee:</b> This table is only visible to {bankName(session.bank)}. Neither Bank B nor Bank C can browse these customer records or raw transaction profiles.
      </Callout>

      {/* Filters and search */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="relative flex-1 min-w-[240px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="Search by Account ID, Name, or City…" value={search} onChange={e => setSearch(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-4 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20" />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
              <Filter size={14} /> Filter:
            </div>
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1">
              {[{
              id: 'ALL',
              label: 'All'
            }, {
              id: 'NORMAL',
              label: 'Normal'
            }, {
              id: 'MEDIUM',
              label: 'Medium Risk'
            }, {
              id: 'FLAGGED',
              label: 'Flagged'
            }].map(f => <button key={f.id} onClick={() => setStatusFilter(f.id)} className={cn('rounded-md px-3 py-1 text-xs font-semibold transition-colors', statusFilter === f.id ? 'bg-white text-navy-900 shadow-sm' : 'text-slate-600 hover:text-navy-900')}>
                  {f.label}
                </button>)}
            </div>

            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
              <ArrowUpDown size={14} /> Sort:
            </div>
            <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm focus:border-brand-500 focus:outline-none">
              <option value="RISK_DESC">Highest Risk First</option>
              <option value="RISK_ASC">Lowest Risk First</option>
              <option value="ID_ASC">Account ID (A-Z)</option>
              <option value="NAME_ASC">Name (A-Z)</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Customer Table */}
      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Account ID</Th>
              <Th>Customer Name</Th>
              <Th>Account Type</Th>
              <Th>KYC Tier</Th>
              <Th>Risk Score</Th>
              <Th>Status</Th>
              <Th>Flagged</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map(c => <tr key={c.account_id} className="hover:bg-slate-50/80">
                <Td className="font-mono font-semibold text-navy-900">{c.account_id}</Td>
                <Td className="font-medium text-slate-800">{c.customer_name || '—'}</Td>
                <Td className="text-slate-600">{c.account_type || 'CURRENT'}</Td>
                <Td>
                  <LevelBadge level={c.kyc_risk_tier || 'LOW'} />
                </Td>
                <Td>
                  <RiskBar score={c.risk_score} threshold={data?.threshold || 50} />
                </Td>
                <Td>
                  <StatusBadge status={c.status} />
                </Td>
                <Td>
                  {c.flagged ? <Badge tone="red" icon={Flag}>
                      {c.manual_override === 'FLAGGED' ? 'MANUAL' : 'AUTO'}
                    </Badge> : <Badge tone="slate">NO</Badge>}
                </Td>
                <Td className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Button variant="secondary" size="sm" icon={Eye} onClick={() => openDetail(c.account_id)}>
                      Details
                    </Button>

                    {c.flagged ? <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50 hover:text-red-700" icon={UserX} onClick={() => setFlagModalAccount({
                  ...c,
                  willFlag: false
                })}>
                        Unflag
                      </Button> : <Button variant="secondary" size="sm" className="border-red-200 text-red-700 hover:bg-red-50" icon={Flag} onClick={() => setFlagModalAccount({
                  ...c,
                  willFlag: true
                })}>
                        Flag
                      </Button>}
                  </div>
                </Td>
              </tr>)}
            {filtered.length === 0 && <tr>
                <td colSpan={8} className="py-12 text-center text-sm text-slate-500">
                  No accounts matched your search/filter criteria.
                </td>
              </tr>}
          </tbody>
        </Table>
      </Card>

      {/* Account Details Modal */}
      <Modal open={Boolean(selectedAccountId)} onClose={() => {
      setSelectedAccountId(null);
      setDetailData(null);
    }} title={`Account Details · ${selectedAccountId}`} size="lg">
        {detailLoading || !detailData ? <Spinner label="Fetching local risk factors & activity…" /> : <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Customer</p>
                <p className="text-lg font-bold text-navy-950">{detailData.customer_name || detailData.account_id}</p>
                <p className="text-xs text-slate-500">{detailData.city}, NL · {detailData.account_type} Account</p>
              </div>
              <div className="text-right">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Local Risk Score</p>
                <p className={cn("text-3xl font-extrabold tabular-nums", detailData.risk_score >= 50 ? "text-red-600" : "text-navy-950")}>
                  {detailData.risk_score} <span className="text-sm font-normal text-slate-400">/ 100</span>
                </p>
                <div className="mt-1">
                  <StatusBadge status={detailData.status} />
                </div>
              </div>
            </div>

            {/* Risk Factors Breakdown */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                Risk Factors Breakdown
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {detailData.factors.map(f => <div key={f.key} className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
                    <div className="flex justify-between items-start">
                      <span className="text-xs font-semibold text-slate-700">{f.label}</span>
                      <span className="font-mono text-sm font-bold text-navy-950">{f.score}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                      <span>Weight: {(f.weight * 100).toFixed(0)}%</span>
                      <span>Contribution: +{f.contribution}</span>
                    </div>
                  </div>)}
              </div>
              <p className="mt-2 text-xs text-slate-500 text-right">
                Weighted Sum: <b className="text-slate-700">{detailData.weighted_sum}</b> ≈ Final Risk Score <b className="text-navy-950">{detailData.risk_score}</b>
              </p>
            </div>

            {/* Transaction Activity */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                Recent Local Transaction Activity
              </h3>
              <div className="grid grid-cols-3 gap-3 mb-3 rounded-xl bg-slate-50 p-3 text-center">
                <div>
                  <p className="text-[10px] font-semibold uppercase text-slate-500">Total Txns</p>
                  <p className="text-base font-bold text-navy-950">{detailData.activity.transaction_count}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase text-slate-500">Total Credits</p>
                  <p className="text-base font-bold text-emerald-700">€{fmtNum(detailData.activity.total_credits_eur)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase text-slate-500">Total Debits</p>
                  <p className="text-base font-bold text-red-600">€{fmtNum(detailData.activity.total_debits_eur)}</p>
                </div>
              </div>

              <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200">
                <Table>
                  <thead>
                    <tr>
                      <Th>Txn ID</Th>
                      <Th>Timestamp</Th>
                      <Th>Type</Th>
                      <Th>Direction</Th>
                      <Th>Amount</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {detailData.activity.recent.map(tx => <tr key={tx.txn_id}>
                        <Td className="font-mono">{tx.txn_id}</Td>
                        <Td className="text-slate-500">{fmtDateTime(tx.timestamp)}</Td>
                        <Td>{tx.txn_type}</Td>
                        <Td>
                          <span className={tx.direction === 'CREDIT' ? 'font-bold text-emerald-700' : 'font-bold text-red-600'}>
                            {tx.direction}
                          </span>
                        </Td>
                        <Td className="font-bold tabular-nums">€{fmtNum(tx.amount_eur)}</Td>
                      </tr>)}
                  </tbody>
                </Table>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500 flex items-center justify-between">
              <span>{detailData.visibility}</span>
              <Badge tone="navy">🔒 Local Data Only</Badge>
            </div>
          </div>}
      </Modal>

      {/* Flag / Unflag Confirmation Modal */}
      <Modal open={Boolean(flagModalAccount)} onClose={() => {
      setFlagModalAccount(null);
      setFlagReason('');
    }} title={flagModalAccount?.willFlag ? 'Flag Account Locally' : 'Remove Local Flag'} size="sm" footer={<>
            <Button variant="secondary" onClick={() => setFlagModalAccount(null)}>
              Cancel
            </Button>
            <Button variant={flagModalAccount?.willFlag ? 'danger' : 'primary'} loading={actionBusy} onClick={() => handleFlagToggle(flagModalAccount, flagModalAccount.willFlag)}>
              {flagModalAccount?.willFlag ? 'CONFIRM FLAG' : 'CONFIRM UNFLAG'}
            </Button>
          </>}>
        {flagModalAccount && <div className="space-y-4">
            <p className="text-sm text-slate-700">
              {flagModalAccount.willFlag ? <>
                  Are you sure you want to <b>flag</b> account{' '}
                  <span className="font-mono font-bold text-navy-950">{flagModalAccount.account_id}</span>?
                </> : <>
                  Are you sure you want to <b>remove the local flag</b> from account{' '}
                  <span className="font-mono font-bold text-navy-950">{flagModalAccount.account_id}</span>?
                </>}
            </p>

            <div>
              <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">
                Reason / Audit Note (Optional)
              </label>
              <input type="text" placeholder={flagModalAccount.willFlag ? 'Suspicious structuring activity' : 'Cleared by compliance'} value={flagReason} onChange={e => setFlagReason(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none" />
            </div>

            <Callout tone="yellow" icon={AlertTriangle}>
              <b>IMPORTANT:</b> Manual flagging/unflagging is <b>LOCAL</b> to {bankName(session.bank)}.
              It must NOT automatically change another bank's status for that account.
            </Callout>
          </div>}
      </Modal>
    </div>;
}

// ==================== pages/Dashboard.jsx ====================
function Dashboard() {
  const {
    session
  } = useAuth();
  const {
    summary: s
  } = useSummary();
  const fetchRecent = useCallback(() => api('/audit-logs?limit=6'), []);
  const {
    data: logs
  } = usePolling(fetchRecent, 6000);
  const fetchInv = useCallback(() => api('/investigations'), []);
  const {
    data: invs
  } = usePolling(fetchInv, 6000);
  if (!s) return <Spinner />;
  return <div className="space-y-6">
      <PageHeader eyebrow={`Bank ${session.bank}`} title={`Welcome back, ${s.bank_name}`} subtitle="Your raw customer and transaction data remains inside your bank." action={<Link to="/investigations" className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700">
            <Network size={15} /> Cross-bank investigations
          </Link>} />

      {/* LOCAL BANK SUMMARY */}
      <section aria-labelledby="local-summary">
        <h2 id="local-summary" className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
          Local bank summary
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <StatCard label="Total customers" value={fmtNum(s.total_customers)} icon={Users} />
          <StatCard label="Total transactions" value={fmtNum(s.total_transactions)} icon={Wallet} tone="blue" />
          <StatCard label="Normal accounts" value={fmtNum(s.normal)} icon={CheckCircle2} tone="green" hint={`${s.medium} medium risk`} />
          <StatCard label="Flagged accounts" value={fmtNum(s.flagged)} icon={Flag} tone="red" hint={`Threshold ≥ ${s.threshold}`} />
          <StatCard label="Average risk score" value={s.average_risk} icon={Activity} tone="yellow" />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* CURRENT INVESTIGATIONS */}
        <Card>
          <CardHeader title="Current investigations" icon={Network} />
          <div className="grid grid-cols-3 divide-x divide-slate-100">
            <Metric label="Pending requests" value={s.investigations.pending_requests} highlight={s.investigations.pending_requests > 0} />
            <Metric label="Active" value={s.investigations.active} />
            <Metric label="Completed" value={s.investigations.completed} />
          </div>
          {s.investigations.pending_decryption_approvals > 0 && <Link to="/investigations" className="mx-5 mb-4 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 ring-1 ring-amber-200">
              <Clock size={15} /> {s.investigations.pending_decryption_approvals} investigation(s)
              awaiting your key-share approval <ArrowRight size={14} className="ml-auto" />
            </Link>}
        </Card>

        {/* CROSS-BANK ALERTS */}
        <Card>
          <CardHeader title="Cross-bank alerts" icon={ShieldAlert} />
          <div className="grid grid-cols-3 divide-x divide-slate-100">
            <Metric label="Suspicious accounts" value={s.alerts.suspicious_accounts} />
            <Metric label="High-risk matches" value={s.alerts.high_risk_matches} tone="red" />
            <Metric label="Pending identity requests" value={s.alerts.pending_identity_requests} highlight={s.alerts.pending_identity_requests > 0} />
          </div>
          {s.alerts.pending_identity_requests > 0 && <Link to="/identity-requests" className="mx-5 mb-4 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 ring-1 ring-amber-200">
              <KeyRound size={15} /> Identity reveal decision needed
              <ArrowRight size={14} className="ml-auto" />
            </Link>}
        </Card>
      </div>

      {/* PRIVACY STATUS */}
      <Card>
        <CardHeader title="Privacy status" icon={ShieldCheck} />
        <div className="grid gap-4 p-5 sm:grid-cols-3">
          <PrivacyStat icon={Database} label="Raw data" value="LOCAL ONLY" />
          <PrivacyStat icon={ShieldCheck} label="Encrypted risk sharing" value="ENABLED" />
          <PrivacyStat icon={KeyRound} label="Threshold consent" value={s.privacy.threshold_consent} />
        </div>
        <div className="border-t border-slate-100 px-5 py-4">
          <PrivacyChips />
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Recent investigations" action={<Link to="/investigations" className="text-sm font-semibold text-brand-600 hover:underline">
                View all
              </Link>} />
          <ul className="divide-y divide-slate-100">
            {(invs?.investigations || []).slice(0, 5).map(i => <li key={i.id}>
                <Link to={`/investigations/${i.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                  <div>
                    <p className="font-mono text-sm font-semibold text-navy-900">{i.id}</p>
                    <p className="text-xs text-slate-500">
                      {bankName(i.initiator)} · {i.participants.map(p => p.bank).join(', ')}
                    </p>
                  </div>
                  <InvestigationStatusBadge status={i.status} />
                </Link>
              </li>)}
            {invs && invs.investigations.length === 0 && <li className="px-5 py-8 text-center text-sm text-slate-500">
                No investigations yet. Start one from the Investigations page.
              </li>}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Recent audit activity" action={<Link to="/audit-logs" className="text-sm font-semibold text-brand-600 hover:underline">
                Full log
              </Link>} />
          <ul className="divide-y divide-slate-100">
            {(logs?.logs || []).map(l => <li key={l.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                <div className="min-w-0">
                  <Badge tone={auditTone(l.action)}>{AUDIT_LABELS[l.action] || l.action}</Badge>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {bankName(l.bank)} {l.investigation_id && `· ${l.investigation_id}`}
                  </p>
                </div>
                <time className="shrink-0 text-xs text-slate-400">{fmtDateTime(l.ts)}</time>
              </li>)}
          </ul>
        </Card>
      </div>

      {s.manual_overrides > 0 && <p className="flex items-center gap-2 text-xs text-slate-500">
          <AlertTriangle size={13} /> {s.manual_overrides} account(s) have a manual local flag
          decision. These are local to {s.bank_name} only.
        </p>}
    </div>;
}
function Metric({
  label,
  value,
  tone,
  highlight
}) {
  return <div className="px-5 py-5">
      <p className={`text-3xl font-bold tracking-tight ${tone === 'red' && value > 0 ? 'text-red-600' : highlight ? 'text-amber-600' : 'text-navy-950'}`}>
        {value}
      </p>
      <p className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
    </div>;
}
function PrivacyStat({
  icon: Icon,
  label,
  value
}) {
  return <div className="flex items-center gap-3 rounded-xl bg-emerald-50/60 px-4 py-3 ring-1 ring-emerald-200">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
        <Icon size={17} />
      </span>
      <div>
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <p className="flex items-center gap-1.5 text-sm font-bold text-emerald-800">
          {value} <CheckCircle2 size={14} />
        </p>
      </div>
    </div>;
}

// ==================== pages/IdentityRequests.jsx ====================
function IdentityRequests() {
  const {
    session
  } = useAuth();
  const {
    refresh: refreshSummary
  } = useSummary();
  const toast = useToast();
  const fetchRequests = useCallback(() => api('/identity-requests'), []);
  const {
    data,
    loading,
    refresh
  } = usePolling(fetchRequests, 4000);
  const [voteTarget, setVoteTarget] = useState(null); // { reqId, code, approve: boolean }
  const [busy, setBusy] = useState(false);
  const handleVote = async () => {
    if (!voteTarget) return;
    setBusy(true);
    try {
      const endpoint = `/investigations/${voteTarget.code}/identity-${voteTarget.approve ? 'approve' : 'reject'}`;
      await api(endpoint, {
        method: 'POST',
        body: {
          request_id: voteTarget.reqId
        }
      });
      toast(voteTarget.approve ? 'Approved identity reveal.' : 'Voted to keep identity private.', voteTarget.approve ? 'success' : 'info');
      setVoteTarget(null);
      refresh();
      refreshSummary();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const list = data?.requests || [];
  const pendingForMe = list.filter(r => r.request.can_vote);
  if (loading && !data) return <Spinner label="Loading identity reveal requests…" />;
  return <div className="space-y-6">
      <PageHeader eyebrow="Second Consent Stage" title="Identity Reveal Requests" subtitle="Manage and vote on requests to disclose the actual account identity of suspicious cross-bank accounts." />

      {/* Pending Votes Section */}
      {pendingForMe.length > 0 && <Card className="border-amber-200 bg-amber-50/50">
          <CardHeader title={`Pending Your Action (${pendingForMe.length})`} subtitle="Another participating bank has requested account identity disclosure. Your vote is required." icon={KeyRound} />
          <div className="divide-y divide-amber-200/60 p-4">
            {pendingForMe.map(item => {
          const req = item.request;
          return <div key={req.id} className="flex flex-wrap items-center justify-between gap-4 py-4 first:pt-0 last:pb-0">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-base font-bold text-navy-950">{item.account.token_short}</span>
                      <Badge tone="yellow">Requires Approval</Badge>
                      <span className="text-xs text-slate-500 font-mono">Inv #{item.investigation_id}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">
                      Requested by <b>{bankName(req.requested_by)}</b> · Reason: <i>"{req.reason}"</i>
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-500">Current Votes:</span>
                      {req.eligible_banks.map(b => <BankChip key={b} bank={b} state={req.approvals.includes(b) ? 'approved' : req.rejections.includes(b) ? 'declined' : 'pending'} you={b === session.bank} />)}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button variant="success" size="sm" icon={Check} onClick={() => setVoteTarget({
                reqId: req.id,
                code: item.investigation_id,
                approve: true
              })}>
                      AGREE TO REVEAL
                    </Button>
                    <Button variant="secondary" size="sm" icon={Lock} onClick={() => setVoteTarget({
                reqId: req.id,
                code: item.investigation_id,
                approve: false
              })}>
                      KEEP PRIVATE
                    </Button>
                  </div>
                </div>;
        })}
          </div>
        </Card>}

      {/* History of Identity Requests */}
      <Card>
        <CardHeader title="All Identity Reveal Requests" icon={ShieldAlert} />
        <Table>
          <thead>
            <tr>
              <Th>Account Hash</Th>
              <Th>Investigation</Th>
              <Th>Requested By</Th>
              <Th>Reason</Th>
              <Th>Status</Th>
              <Th>Approvals</Th>
              <Th>Date</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.map(item => {
            const req = item.request;
            return <tr key={req.id} className="hover:bg-slate-50">
                  <Td className="font-mono font-bold text-navy-950">{item.account.token_short}</Td>
                  <Td className="font-mono text-xs text-slate-600">{item.investigation_id}</Td>
                  <Td className="font-semibold text-slate-800">{bankName(req.requested_by)}</Td>
                  <Td className="text-slate-600 text-xs max-w-xs truncate">{req.reason}</Td>
                  <Td>
                    {req.status === 'REVEALED' ? <Badge tone="red">🔓 REVEALED</Badge> : req.status === 'DENIED' ? <Badge tone="slate">🔒 DENIED</Badge> : <Badge tone="yellow">⏳ PENDING ({req.approvals.length}/{req.threshold})</Badge>}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {req.eligible_banks.map(b => <BankChip key={b} bank={b} state={req.approvals.includes(b) ? 'approved' : req.rejections.includes(b) ? 'declined' : 'pending'} />)}
                    </div>
                  </Td>
                  <Td className="text-xs text-slate-500">{fmtDateTime(req.created_at)}</Td>
                </tr>;
          })}
            {list.length === 0 && <tr>
                <td colSpan={7} className="py-12 text-center text-sm text-slate-500">
                  No identity reveal requests logged yet.
                </td>
              </tr>}
          </tbody>
        </Table>
      </Card>

      {/* Confirmation Modal */}
      <Modal open={Boolean(voteTarget)} onClose={() => setVoteTarget(null)} title={voteTarget?.approve ? 'Agree to Reveal Identity' : 'Keep Identity Private'} size="sm" footer={<>
            <Button variant="secondary" onClick={() => setVoteTarget(null)}>
              Cancel
            </Button>
            <Button variant={voteTarget?.approve ? 'success' : 'dark'} loading={busy} onClick={handleVote}>
              {voteTarget?.approve ? 'CONFIRM REVEAL' : 'CONFIRM KEEP PRIVATE'}
            </Button>
          </>}>
        <p className="text-sm text-slate-700">
          {voteTarget?.approve ? 'Are you sure you want to approve this identity reveal request? If the 2-of-3 threshold is reached, the real account ID will be disclosed to participating banks.' : 'Are you sure you want to vote to keep this account identity private?'}
        </p>
      </Modal>
    </div>;
}

// ==================== pages/InvestigationDetail.jsx ====================
function InvestigationDetail() {
  const {
    id: code
  } = useParams();
  const {
    session
  } = useAuth();
  const {
    refresh: refreshSummary
  } = useSummary();
  const toast = useToast();
  const fetchInv = useCallback(() => api(`/investigations/${code}`), [code]);
  const {
    data: inv,
    loading,
    refresh
  } = usePolling(fetchInv, 2500);
  const fetchPsi = useCallback(() => api(`/investigations/${code}/psi`), [code]);
  const {
    data: psiData
  } = usePolling(fetchPsi, 2500);
  const fetchEnc = useCallback(() => api(`/investigations/${code}/encryption`), [code]);
  const {
    data: encData
  } = usePolling(fetchEnc, 2500);
  const fetchAgg = useCallback(() => api(`/investigations/${code}/aggregation`), [code]);
  const {
    data: aggData
  } = usePolling(fetchAgg, 2500);
  const fetchResults = useCallback(() => api(`/investigations/${code}/results`), [code]);
  const {
    data: resultsData,
    refresh: refreshResults
  } = usePolling(fetchResults, 2500);
  const [busy, setBusy] = useState(false);
  const [decryptError, setDecryptError] = useState(null);

  // Actions
  const handleParticipate = async agree => {
    setBusy(true);
    try {
      await api(`/investigations/${code}/${agree ? 'participate' : 'decline'}`, {
        method: 'POST'
      });
      toast(agree ? 'Participation approved.' : 'Participation declined.', agree ? 'success' : 'info');
      refresh();
      refreshSummary();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const handleStartAnalysis = async () => {
    setBusy(true);
    try {
      await api(`/investigations/${code}/run`, {
        method: 'POST'
      });
      toast('Cryptographic analysis pipeline started.', 'success');
      refresh();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const handleApproveKeyShare = async () => {
    setBusy(true);
    try {
      await api(`/investigations/${code}/decryption-approve`, {
        method: 'POST'
      });
      toast('Your threshold key share has been approved for decryption.', 'success');
      refresh();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const handleDecrypt = async (mode = 'normal') => {
    setBusy(true);
    setDecryptError(null);
    try {
      const res = await api(`/investigations/${code}/decrypt`, {
        method: 'POST',
        body: mode === 'single_share' ? {
          mode: 'single_share'
        } : {}
      });
      toast('Joint risk decrypted successfully via 2-of-3 threshold combination.', 'success');
      refresh();
      refreshResults();
      refreshSummary();
    } catch (e) {
      if (e.data && e.data.denied) {
        setDecryptError(e.data);
      } else {
        toast(e.message, 'error');
      }
    } finally {
      setBusy(false);
    }
  };
  if (loading && !inv) return <Spinner label="Loading investigation detail…" />;
  if (!inv) return <div className="py-12 text-center text-slate-500">Investigation not found.</div>;
  const isInitiator = inv.initiator === session.bank;
  const myParticipant = inv.participants.find(p => p.bank === session.bank);
  const isConsentPending = inv.status === 'PENDING_CONSENT' && myParticipant?.consent === 'PENDING';
  return <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link to="/investigations" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800">
          <ArrowLeft size={14} /> Back to Investigations
        </Link>
      </div>

      <PageHeader eyebrow={`Cross-Bank Investigation #${inv.id}`} title={`Investigation ${inv.id}`} subtitle={`Purpose: ${inv.purpose} · Initiated by ${bankName(inv.initiator)} on ${fmtDateTime(inv.created_at)}`} action={<InvestigationStatusBadge status={inv.status} />} />

      {/* Participation Consent Alert Banner */}
      {isConsentPending && <Card className="border-amber-200 bg-amber-50 p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-amber-900 flex items-center gap-2">
                <Clock size={16} /> Participation Consent Requested
              </h3>
              <p className="mt-1 text-sm text-amber-800">
                <b>{bankName(inv.initiator)}</b> has invited <b>{bankName(session.bank)}</b> to participate in this cross-bank fraud investigation.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="success" icon={Check} loading={busy} onClick={() => handleParticipate(true)}>
                AGREE TO PARTICIPATE
              </Button>
              <Button variant="secondary" icon={X} loading={busy} onClick={() => handleParticipate(false)}>
                DECLINE
              </Button>
            </div>
          </div>
        </Card>}

      {/* Start Analysis Callout if Approved */}
      {inv.status === 'APPROVED' && isInitiator && <Card className="border-brand-200 bg-brand-50 p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-brand-900 flex items-center gap-2">
                <CheckCircle2 size={16} className="text-brand-600" /> All Participating Banks Have Approved
              </h3>
              <p className="mt-1 text-sm text-brand-800">
                Participation consent is 100% complete. You can now launch the cryptographic analysis pipeline.
              </p>
            </div>
            <Button icon={Play} loading={busy} onClick={handleStartAnalysis} size="lg">
              START CRYPTOGRAPHIC ANALYSIS
            </Button>
          </div>
        </Card>}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column: Pipeline Stepper */}
        <Card className="lg:col-span-1 p-5">
          <CardHeader title="Cryptographic Pipeline" icon={ShieldCheck} className="px-0 pt-0 mb-4" />
          <PipelineStepper inv={inv} />
        </Card>

        {/* Right Column: Participants & Overview */}
        <Card className="lg:col-span-2 p-5">
          <CardHeader title="Consortium Participants" icon={ShieldAlert} className="px-0 pt-0 mb-4" />
          <div className="grid gap-3 sm:grid-cols-3">
            {inv.participants.map(p => <div key={p.bank} className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase text-slate-500">{bankName(p.bank)}</span>
                  {p.role === 'INITIATOR' && <Badge tone="blue">Initiator</Badge>}
                </div>
                <div className="mt-2">
                  <BankChip bank={p.bank} state={consentState(p.consent)} you={p.bank === session.bank} />
                </div>
                <p className="mt-2 text-[11px] text-slate-500">
                  {p.consent === 'APPROVED' ? `Consent granted at ${fmtDateTime(p.consent_at)}` : p.consent === 'DECLINED' ? 'Declined participation' : 'Awaiting consent'}
                </p>
              </div>)}
          </div>

          <div className="mt-6 border-t border-slate-100 pt-4">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Privacy Architecture Guarantee</h4>
            <div className="flex flex-wrap gap-2">
              <Badge tone="green">🔒 Raw data stays local</Badge>
              <Badge tone="blue">🔐 Risk scores encrypted</Badge>
              <Badge tone="navy">🛡️ PSI protects account sets</Badge>
              <Badge tone="yellow">🔑 2-of-3 threshold consent</Badge>
            </div>
          </div>
        </Card>
      </div>

      {/* SECTION 13: DH-PSI VISUALIZATION */}
      {psiData?.available && <Card>
          <CardHeader title="1. DH Private Set Intersection (DH-PSI)" subtitle="Identifies accounts independently flagged by at least 2 participating banks without revealing non-matching accounts." icon={ShieldCheck} />
          <div className="p-6 space-y-6">
            {/* Visual Bank Private Sets */}
            <div className="grid gap-4 sm:grid-cols-3">
              {inv.participants.map(p => <div key={p.bank} className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
                  <span className="font-bold text-navy-950 text-base">{bankName(p.bank)}</span>
                  <p className="mt-1 text-xs text-slate-500">Private Flagged Set</p>
                  <div className="mt-3 flex items-center justify-center gap-1 text-sm font-semibold text-navy-900">
                    <Lock size={15} /> {psiData.set_sizes?.[p.bank] ?? '—'} Flagged Accounts
                  </div>
                  <p className="mt-1 text-[10px] text-slate-400">Blinded with 256-bit Diffie-Hellman keys</p>
                </div>)}
            </div>

            {/* Downward Flow to Matches */}
            <div className="flex flex-col items-center justify-center">
              <div className="h-6 w-0.5 bg-brand-400" />
              <div className="rounded-full bg-brand-50 border border-brand-200 px-4 py-1 text-xs font-bold text-brand-700">
                DH-PSI Matching Engine (Min Banks = {psiData.min_banks})
              </div>
              <div className="h-6 w-0.5 bg-brand-400" />
            </div>

            {/* Match Results Summary */}
            <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-4">
              <p className="text-sm font-bold text-brand-950">
                DH-PSI found <span className="text-brand-600">{psiData.matches.length}</span> cross-bank account match(es).
              </p>
              <p className="mt-1 text-xs text-slate-600">
                "Only cross-bank matches are revealed. Raw flagged-account lists remain private."
              </p>
            </div>
          </div>
        </Card>}

      {/* SECTION 15: ACCOUNT-LEVEL ENCRYPTION VISUALIZATION */}
      {encData?.available && <Card>
          <CardHeader title="2. Threshold Paillier Account-Level Encryption" subtitle="Local risk scores for matched accounts are encrypted at source using Paillier homomorphic encryption." icon={Lock} />
          <div className="p-6 space-y-4">
            <Callout tone="blue" icon={Info}>
              <b>Plaintext Protection:</b> Plaintext risk scores are NOT sent to the coordinator. The coordinator only sees the ciphertext values displayed below.
            </Callout>

            <div className="space-y-4">
              {encData.accounts.map(acct => <div key={acct.token} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                    Account Token: <span className="font-mono text-navy-950">{acct.token_short}</span>
                  </p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {acct.banks.map(b => <div key={b.bank} className="rounded-lg border border-slate-200 bg-white p-3">
                        <p className="text-xs font-semibold text-slate-700">{bankName(b.bank)}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          Local Risk:{' '}
                          {b.local_risk !== null ? <b className="text-navy-950">{b.local_risk}</b> : <span className="text-slate-400">🔒 Encrypted (Hidden from you)</span>}
                        </p>
                        <div className="mt-2">
                          <p className="text-[10px] font-semibold text-slate-400">Encrypted Value (Ciphertext):</p>
                          <Cipher value={b.ciphertext} chars={24} />
                        </div>
                      </div>)}
                  </div>
                </div>)}
            </div>
          </div>
        </Card>}

      {/* SECTION 16: HOMOMORPHIC AGGREGATION VISUALIZATION */}
      {aggData?.available && <Card>
          <CardHeader title="3. Homomorphic Aggregation (Coordinator Node)" subtitle="The coordinator multiplies ciphertexts to compute the encrypted sum without decrypting individual risk scores." icon={ShieldCheck} />
          <div className="p-6 space-y-4">
            <Callout tone="navy" icon={ShieldCheck}>
              <b>Coordinator Guarantee:</b> Cannot read individual plaintext scores ✓. Aggregation operates purely on ciphertext.
            </Callout>

            <div className="space-y-4">
              {aggData.accounts.map(acct => <div key={acct.token} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                    Account Token: <span className="font-mono text-navy-950">{acct.token_short}</span>
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-sm font-mono font-semibold">
                    {acct.inputs.map((inp, idx) => <div key={inp.bank} className="flex items-center gap-2">
                        {idx > 0 && <span className="text-brand-600 font-bold text-lg">+</span>}
                        <span className="rounded-md bg-slate-100 px-2.5 py-1 text-xs text-navy-900 border border-slate-200">
                          {inp.label} ({bankName(inp.bank)})
                        </span>
                      </div>)}
                    <span className="text-slate-400 font-bold text-lg">↓</span>
                    <Badge tone="blue">Homomorphic Add</Badge>
                  </div>

                  <div className="mt-3">
                    <p className="text-xs font-semibold text-slate-500 mb-1">Encrypted Aggregate Result:</p>
                    <Cipher value={acct.aggregate_cipher} chars={48} />
                  </div>
                </div>)}
            </div>
          </div>
        </Card>}

      {/* SECTION 17: THRESHOLD DECRYPTION GATE */}
      {inv.current_step >= 7 && <Card className="border-brand-200">
          <CardHeader title="4. 2-of-3 Threshold Decryption / Consent Gate" subtitle="At least 2 participating bank key shares are required to decrypt the joint risk score." icon={KeyRound} />
          <div className="p-6 space-y-6">
            {/* Key Shares Status */}
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                Key Share Approvals ({inv.decryption.approvals.length} / {inv.decryption.required} Required)
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                {inv.participants.map(p => {
              const hasApproved = inv.decryption.approvals.includes(p.bank);
              return <div key={p.bank} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                      <span className="font-semibold text-slate-800">{bankName(p.bank)} Share</span>
                      {hasApproved ? <Badge tone="green" icon={Check}>
                          APPROVED
                        </Badge> : <Badge tone="yellow" icon={Clock}>
                          AWAITING SHARE
                        </Badge>}
                    </div>;
            })}
              </div>
            </div>

            {/* Approval Controls */}
            {inv.status === 'AWAITING_DECRYPTION' && <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-100/70 p-4">
                <div>
                  <p className="text-sm font-bold text-navy-950">Your Key Share Action ({bankName(session.bank)})</p>
                  <p className="text-xs text-slate-500">
                    {inv.decryption.my_share_approved ? 'You have approved the use of your key share for partial decryption.' : 'Approve your threshold key share to enable joint risk score decryption.'}
                  </p>
                </div>
                {!inv.decryption.my_share_approved && <Button variant="success" icon={Check} loading={busy} onClick={handleApproveKeyShare}>
                    APPROVE KEY SHARE
                  </Button>}
              </div>}

            {/* Decrypt Actions */}
            {inv.status === 'AWAITING_DECRYPTION' && <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="primary" size="lg" icon={KeyRound} loading={busy} disabled={inv.decryption.approvals.length < inv.decryption.required} onClick={() => handleDecrypt('normal')}>
                    DECRYPT JOINT RISK
                  </Button>

                  <Button variant="secondary" size="sm" loading={busy} onClick={() => handleDecrypt('single_share')}>
                    Demonstrate 1 Bank Alone (DENIED)
                  </Button>
                </div>

                {inv.decryption.approvals.length < inv.decryption.required && <p className="text-xs font-semibold text-amber-700">
                    ⚠️ Need at least {inv.decryption.required} bank key share approvals before decryption can be combined.
                  </p>}
              </div>}

            {/* Decryption Error / Denial Callout */}
            {decryptError && <Callout tone="red" icon={X}>
                <b>Threshold Decryption Denied:</b> {decryptError.message}.
                <br />
                Coordinator alone: <b>{decryptError.coordinator_alone}</b> (Provided {decryptError.shares_provided} / {decryptError.shares_required} required shares).
              </Callout>}

            <p className="text-xs text-slate-500">
              "Coordinator alone cannot decrypt the result." 2-of-3 threshold combination is enforced cryptographically.
            </p>
          </div>
        </Card>}

      {/* SECTION 18 & 14: SUSPICIOUS CROSS-BANK ACCOUNTS TABLE */}
      {resultsData?.results && resultsData.results.length > 0 && <Card>
          <CardHeader title="Suspicious Cross-Bank Accounts" subtitle="Final joint-risk score evaluation for cross-bank matches. Account identity remains protected by default." icon={ShieldAlert} />
          <SuspiciousTable rows={resultsData.results.map(r => ({
        ...r,
        investigation_id: inv.id
      }))} onChanged={refreshResults} defaultOpen={`${inv.id}-${resultsData.results[0]?.id}`} />
        </Card>}
    </div>;
}

// ==================== pages/Investigations.jsx ====================
const ALL_BANKS = ['A', 'B', 'C'];
function Investigations() {
  const {
    session
  } = useAuth();
  const {
    refresh: refreshSummary
  } = useSummary();
  const toast = useToast();
  const navigate = useNavigate();
  const fetchInvs = useCallback(() => api('/investigations'), []);
  const {
    data,
    loading,
    refresh
  } = usePolling(fetchInvs, 4000);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [selectedBanks, setSelectedBanks] = useState({
    A: true,
    B: true,
    C: true
  });
  const [purpose, setPurpose] = useState('Privacy-preserving fraud detection');
  const [busy, setBusy] = useState(false);
  const toggleBank = b => {
    if (b === session.bank) return; // Current bank is mandatory
    setSelectedBanks(prev => ({
      ...prev,
      [b]: !prev[b]
    }));
  };
  const handleCreate = async e => {
    e.preventDefault();
    const invited = Object.keys(selectedBanks).filter(b => b !== session.bank && selectedBanks[b]);
    if (invited.length === 0) {
      toast('Select at least one other participating bank.', 'error');
      return;
    }
    setBusy(true);
    try {
      const created = await api('/investigations', {
        method: 'POST',
        body: {
          participants: invited,
          purpose
        }
      });
      toast(`Investigation ${created.id} initiated. Participation consent requests sent.`, 'success');
      setCreateModalOpen(false);
      refresh();
      refreshSummary();
      navigate(`/investigations/${created.id}`);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const handleConsent = async (code, agree) => {
    setBusy(true);
    try {
      const endpoint = `/investigations/${code}/${agree ? 'participate' : 'decline'}`;
      const updated = await api(endpoint, {
        method: 'POST'
      });
      toast(agree ? `Agreed to participate in ${code}.` : `Declined participation in ${code}. Investigation cancelled.`, agree ? 'success' : 'info');
      refresh();
      refreshSummary();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const list = data?.investigations || [];

  // Pending consent requests directed to ME
  const pendingForMe = list.filter(inv => inv.status === 'PENDING_CONSENT' && inv.participants.some(p => p.bank === session.bank && p.consent === 'PENDING'));
  if (loading && !data) return <Spinner label="Fetching investigations…" />;
  return <div className="space-y-6">
      <PageHeader eyebrow="Consortium Collaboration" title="Cross-Bank Investigations" subtitle="Initiate and manage privacy-preserving fraud detection campaigns across participating bank nodes." action={<Button icon={Plus} onClick={() => setCreateModalOpen(true)} size="lg">
            START CROSS-BANK INVESTIGATION
          </Button>} />

      {/* Pending Participation Consent Requests Banner */}
      {pendingForMe.length > 0 && <section aria-labelledby="pending-consent-title">
          <Card className="border-amber-200 bg-amber-50/50">
            <CardHeader title={`Action Required: ${pendingForMe.length} Participation Consent Request(s)`} subtitle="You must explicitly agree before any cryptographic matching occurs." icon={UserCheck} />
            <div className="divide-y divide-amber-200/60 p-4">
              {pendingForMe.map(inv => <div key={inv.id} className="flex flex-wrap items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <div>
                    <span className="font-mono text-base font-bold text-navy-950">{inv.id}</span>
                    <span className="ml-2 text-xs text-slate-600">
                      Initiated by <b>{bankName(inv.initiator)}</b>
                    </span>
                    <p className="mt-0.5 text-sm text-slate-700">{inv.purpose}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-500">Participants:</span>
                      {inv.participants.map(p => <BankChip key={p.bank} bank={p.bank} state={consentState(p.consent)} you={p.bank === session.bank} />)}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button variant="success" size="sm" icon={Check} loading={busy} onClick={() => handleConsent(inv.id, true)}>
                      AGREE TO PARTICIPATE
                    </Button>
                    <Button variant="secondary" size="sm" icon={X} loading={busy} onClick={() => handleConsent(inv.id, false)}>
                      DECLINE
                    </Button>
                  </div>
                </div>)}
            </div>
          </Card>
        </section>}

      {/* All Investigations Table */}
      <Card>
        <CardHeader title="Investigation History" icon={Network} />
        <Table>
          <thead>
            <tr>
              <Th>Investigation ID</Th>
              <Th>Initiated By</Th>
              <Th>Participants</Th>
              <Th>Created Date</Th>
              <Th>Status</Th>
              <Th>Suspicious Accounts</Th>
              <Th className="text-right">Action</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.map(inv => <tr key={inv.id} onClick={() => navigate(`/investigations/${inv.id}`)} className="cursor-pointer hover:bg-slate-50 transition-colors">
                <Td className="font-mono font-bold text-navy-950">{inv.id}</Td>
                <Td className="font-semibold text-slate-800">{bankName(inv.initiator)}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {inv.participants.map(p => <BankChip key={p.bank} bank={p.bank} state={consentState(p.consent)} />)}
                  </div>
                </Td>
                <Td className="text-slate-500 text-xs">{fmtDateTime(inv.created_at)}</Td>
                <Td>
                  <InvestigationStatusBadge status={inv.status} />
                </Td>
                <Td className="font-semibold tabular-nums">
                  {inv.suspicious_count > 0 ? <span className="text-navy-950">{inv.suspicious_count} accounts ({inv.high_risk_count} high risk)</span> : <span className="text-slate-400">0</span>}
                </Td>
                <Td className="text-right">
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700 hover:underline">
                    View Pipeline <ArrowRight size={14} />
                  </span>
                </Td>
              </tr>)}
            {list.length === 0 && <tr>
                <td colSpan={7} className="py-12 text-center text-sm text-slate-500">
                  No investigations recorded yet. Click <b>"START CROSS-BANK INVESTIGATION"</b> above to launch one.
                </td>
              </tr>}
          </tbody>
        </Table>
      </Card>

      {/* Start Investigation Modal */}
      <Modal open={createModalOpen} onClose={() => setCreateModalOpen(false)} title="Start Cross-Bank Investigation" size="md" footer={<>
            <Button variant="secondary" onClick={() => setCreateModalOpen(false)}>
              Cancel
            </Button>
            <Button icon={Network} loading={busy} onClick={handleCreate}>
              INITIATE INVESTIGATION
            </Button>
          </>}>
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase text-slate-500 mb-2">
              Select Participating Banks
            </label>
            <div className="grid grid-cols-3 gap-3">
              {ALL_BANKS.map(b => {
              const isCurrent = b === session.bank;
              const isSelected = selectedBanks[b];
              return <button type="button" key={b} onClick={() => toggleBank(b)} className={cn('flex items-center justify-between rounded-xl border p-3.5 text-sm font-semibold transition-colors', isSelected ? 'border-brand-500 bg-brand-50/70 text-navy-950 ring-2 ring-brand-500/20' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300')}>
                    <span className="flex items-center gap-2">
                      <Landmark size={16} /> Bank {b}
                    </span>
                    {isCurrent ? <Badge tone="blue">Current</Badge> : isSelected ? <CheckCircle2 size={16} className="text-brand-600" /> : <span className="h-4 w-4 rounded border border-slate-300" />}
                  </button>;
            })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">
              Investigation Purpose
            </label>
            <input type="text" value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="Privacy-preserving fraud detection" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none" required />
          </div>

          <Callout tone="blue" icon={ShieldAlert}>
            <b>Participation Rule:</b> The initiating bank ({bankName(session.bank)}) cannot automatically force another bank to participate. Each requested bank must explicitly agree before analysis begins.
          </Callout>
        </form>
      </Modal>
    </div>;
}

// ==================== pages/Login.jsx ====================
const BANKS = ['A', 'B', 'C'];
function Login() {
  const {
    login
  } = useAuth();
  const navigate = useNavigate();
  const [bank, setBank] = useState('A');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async e => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(bank, username.trim(), password);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const fillDemo = () => {
    setUsername(`bank_${bank.toLowerCase()}`);
    setPassword(`bank_${bank.toLowerCase()}123`);
  };
  return <div className="grid min-h-screen w-full bg-slate-50 lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel with KineticGrid background */}
      <div className="relative hidden h-full overflow-hidden bg-navy-950 text-white lg:block">
        <KineticGrid className="h-full w-full" globalColor="default">
          <div className="relative flex h-full flex-col justify-between p-12 text-white">
            <div className="relative flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500/20 text-brand-300 ring-1 ring-brand-400/40 backdrop-blur-md">
                <ShieldCheck size={24} />
              </span>
              <span className="text-lg font-bold tracking-[0.2em] text-white">VAULTLEDGER</span>
            </div>

            <div className="relative max-w-lg">
              <span className="mb-4 inline-block rounded-full border border-brand-400/30 bg-brand-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand-300 backdrop-blur-sm">
                Interactive Kinetic Grid · Move & Click
              </span>
              <h1 className="text-4xl font-bold leading-tight tracking-tight text-white">
                Find fraud rings across banks.
                <span className="text-brand-300"> Without sharing customer data.</span>
              </h1>
              <p className="mt-5 text-navy-200 leading-relaxed">
                Banks compute risk locally, match flagged accounts with private set intersection,
                aggregate encrypted scores, and only reveal an identity when a threshold of banks
                consents.
              </p>
            </div>

            <p className="relative text-xs text-navy-300">
              Academic prototype – the cryptography is a simplified demonstration and is not
              production banking infrastructure.
            </p>
          </div>
        </KineticGrid>
      </div>

      {/* Form */}
      <div className="flex h-full items-center justify-center bg-slate-50 px-5 py-12">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <p className="flex items-center gap-2 text-lg font-bold tracking-[0.2em] text-navy-950">
              <ShieldCheck className="text-brand-600" /> VAULTLEDGER
            </p>
          </div>

          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-600">
            Consortium sign-in
          </p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight text-navy-950">
            Privacy-Preserving Cross-Bank Fraud Detection
          </h2>

          <form onSubmit={submit} className="mt-8 space-y-5" aria-label="Bank login">
            <fieldset>
              <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Login as
              </legend>
              <div className="mt-2 grid grid-cols-3 gap-2" role="radiogroup">
                {BANKS.map(b => <button type="button" key={b} id={`login-bank-${b}`} role="radio" aria-checked={bank === b} onClick={() => setBank(b)} className={cn('flex flex-col items-center gap-1 rounded-xl border px-3 py-3 text-sm font-semibold transition-colors', bank === b ? 'border-brand-500 bg-brand-50 text-brand-700 ring-2 ring-brand-500/20' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300')}>
                    <Landmark size={18} />
                    Bank {b}
                  </button>)}
              </div>
            </fieldset>

            <div>
              <label htmlFor="login-username" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Username
              </label>
              <input id="login-username" value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" required className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20" placeholder={`bank_${bank.toLowerCase()}`} />
            </div>

            <div>
              <label htmlFor="login-password" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Password
              </label>
              <div className="relative mt-1.5">
                <input id="login-password" type={show ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 pr-10 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20" />
                <button type="button" onClick={() => setShow(s => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" aria-label={show ? 'Hide password' : 'Show password'}>
                  {show ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>}

            <button id="login-submit" type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-lg bg-navy-900 px-4 py-3 text-sm font-semibold tracking-[0.18em] text-white shadow-sm transition-colors hover:bg-navy-800 disabled:opacity-60">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Lock size={15} />}
              LOGIN
            </button>
          </form>

          <div className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white/60 px-4 py-3 text-xs text-slate-500">
            <p className="font-semibold text-slate-600">Prototype demo credentials</p>
            <p className="mt-1 font-mono">
              bank_{bank.toLowerCase()} / bank_{bank.toLowerCase()}123
            </p>
            <button type="button" onClick={fillDemo} className="mt-1.5 font-semibold text-brand-600 hover:underline">
              Fill in for Bank {bank}
            </button>
          </div>

          <p className="mt-6 flex items-start gap-2 text-xs text-slate-500">
            <Lock size={13} className="mt-0.5 shrink-0" />
            Your raw customer and transaction data remains inside your bank.
          </p>
        </div>
      </div>
    </div>;
}

// ==================== pages/PrivacySecurity.jsx ====================
const PRIVACY_RULES = ["Bank A cannot see Bank B's raw transactions.", "Bank A cannot see Bank C's raw transactions.", "Each bank can see all of its own customers.", "Each bank can see its own risk scores and risk factors.", "Each bank can manually flag/unflag only its own customers.", "Manual flagging/unflagging is local and does not alter another bank's state.", "A bank cannot force another bank to participate in an investigation.", "Cross-bank analysis begins only after required participating banks explicitly approve.", "PSI reveals only qualifying cross-bank matches (flagged by ≥ 2 banks).", "Individual plaintext risk scores are never presented to the coordinator node.", "Encrypted scores can be displayed for educational demonstration.", "Homomorphic aggregation operates strictly on ciphertext.", "One threshold key share alone is insufficient to decrypt scores.", "Suspicious account identities remain hidden after risk analysis.", "Identity reveal requires a separate consent request.", "Identity reveal requires at least 2 participating-bank approvals.", "If the threshold is not reached, the actual account ID remains hidden.", "Every important action is recorded in an immutable audit log."];
function PrivacySecurity() {
  return <div className="space-y-6">
      <PageHeader eyebrow="Consortium Guarantees" title="Privacy & Security Architecture" subtitle="Mathematical and architectural framework protecting sensitive banking data during cross-institution fraud detection." />

      <Card className="border-brand-200 bg-brand-50/30 p-6">
        <h2 className="text-sm font-bold uppercase tracking-wider text-brand-900 mb-3">Core Privacy Indicators</h2>
        <PrivacyChips />
        <p className="mt-4 text-xs font-semibold text-brand-800">
          Persistent Policy Banner: "VaultLedger never transfers raw customer transaction data between participating banks."
        </p>
      </Card>

      {/* Cryptographic Primitives Breakdown */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="p-5">
          <CardHeader title="Diffie-Hellman Private Set Intersection (DH-PSI)" icon={Lock} className="px-0 pt-0 mb-3" />
          <p className="text-sm text-slate-600 leading-relaxed">
            DH-PSI enables banks to discover accounts flagged by at least 2 institutions without revealing their full flagged list or any unflagged customer records.
          </p>
          <ul className="mt-4 space-y-2 text-xs text-slate-700">
            <li className="flex items-center gap-2">
              <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
              Entities blinded using 256-bit prime modulus exponentiation.
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
              Only matching blinded tokens are revealed to the coordinator.
            </li>
          </ul>
        </Card>

        <Card className="p-5">
          <CardHeader title="Threshold Paillier Homomorphic Encryption" icon={KeyRound} className="px-0 pt-0 mb-3" />
          <p className="text-sm text-slate-600 leading-relaxed">
            Paillier homomorphic encryption allows the coordinator to sum risk scores directly in ciphertext form: <code className="bg-slate-100 px-1 py-0.5 rounded text-navy-950">E(risk_A) × E(risk_B) = E(risk_A + risk_B)</code>.
          </p>
          <ul className="mt-4 space-y-2 text-xs text-slate-700">
            <li className="flex items-center gap-2">
              <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
              Coordinator never sees individual plaintext scores.
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
              2-of-3 Lagrange key share polynomial secret sharing for decryption.
            </li>
          </ul>
        </Card>
      </div>

      {/* 18 Strict Privacy Rules Checklist */}
      <Card>
        <CardHeader title="Strict Privacy Rules & Consortium Policies" icon={ShieldCheck} />
        <div className="p-6">
          <div className="grid gap-3 sm:grid-cols-2">
            {PRIVACY_RULES.map((rule, idx) => <div key={idx} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 font-bold text-emerald-800 text-[10px]">
                  {idx + 1}
                </span>
                <span className="font-medium text-slate-700">{rule}</span>
              </div>)}
          </div>
        </div>
      </Card>
    </div>;
}

// ==================== pages/RiskAnalysis.jsx ====================
function RiskAnalysis() {
  const {
    session
  } = useAuth();
  const {
    summary,
    refresh: refreshSummary
  } = useSummary();
  const toast = useToast();
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const runAnalysis = async () => {
    setAnalyzing(true);
    try {
      const res = await api(`/banks/${session.bank}/local-analysis`, {
        method: 'POST'
      });
      setAnalysisResult(res);
      toast(`Local risk analysis executed for ${bankName(session.bank)}.`, 'success');
      refreshSummary();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setAnalyzing(false);
    }
  };
  const bankId = session.bank;
  const name = bankName(bankId);
  return <div className="space-y-6">
      <PageHeader eyebrow={`Bank ${bankId} Engine`} title="Local Risk Analysis" subtitle={`Execute account-level rule scoring locally inside ${name}. All computation occurs isolated behind your firewall.`} action={<Button icon={Play} loading={analyzing} onClick={runAnalysis} size="lg">
            RUN LOCAL ANALYSIS
          </Button>} />

      {/* Main Stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Risk Threshold" value="50" icon={Sliders} tone="navy" hint="Standard consortium cutoff" />
        <StatCard label="Total Accounts Analyzed" value={fmtNum(summary?.total_customers)} icon={Users} />
        <StatCard label="Flagged Accounts" value={fmtNum(summary?.flagged)} icon={Flag} tone="red" hint="Risk score ≥ 50" />
        <StatCard label="Normal Accounts" value={fmtNum(summary?.normal)} icon={CheckCircle2} tone="green" hint="Below threshold" />
      </div>

      {/* Pipeline Diagram Card */}
      <Card>
        <CardHeader title="Local Scoring Pipeline & Data Boundaries" subtitle="Visual demonstration of how local transactions produce flagged account sets." icon={Activity} />
        <div className="p-6">
          <div className="mx-auto max-w-xl space-y-3">
            {/* Step 1 */}
            <div className="flex items-center gap-4 rounded-xl border border-navy-200 bg-navy-50 p-4 shadow-sm">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-navy-900 text-white font-bold">
                {bankId}
              </div>
              <div className="flex-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-navy-700">Bank Node</p>
                <p className="text-sm font-bold text-navy-950">{name} Environment</p>
              </div>
              <Badge tone="blue">Isolated Firewall</Badge>
            </div>

            <div className="flex justify-center text-slate-400">
              <ArrowDown size={20} className="animate-bounce" />
            </div>

            {/* Step 2 */}
            <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                <Database size={20} />
              </div>
              <div className="flex-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Input Data</p>
                <p className="text-sm font-bold text-navy-950">Local Transaction & KYC Records</p>
                <p className="text-xs text-slate-500">{fmtNum(summary?.total_transactions)} transactions evaluated</p>
              </div>
              <Badge tone="green">Local Only</Badge>
            </div>

            <div className="flex justify-center text-slate-400">
              <ArrowDown size={20} />
            </div>

            {/* Step 3 */}
            <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                <Activity size={20} />
              </div>
              <div className="flex-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Computation</p>
                <p className="text-sm font-bold text-navy-950">Account-Level Risk Calculation</p>
                <p className="text-xs text-slate-500">Velocity, structuring, counterparty & pass-through factors</p>
              </div>
            </div>

            <div className="flex justify-center text-slate-400">
              <ArrowDown size={20} />
            </div>

            {/* Step 4 */}
            <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700 font-bold">
                50
              </div>
              <div className="flex-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Evaluation Gate</p>
                <p className="text-sm font-bold text-navy-950">Risk Threshold = 50</p>
              </div>
            </div>

            <div className="flex justify-center text-slate-400">
              <ArrowDown size={20} />
            </div>

            {/* Step 5 */}
            <div className="flex items-center gap-4 rounded-xl border border-red-200 bg-red-50 p-4 shadow-sm">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-600 text-white font-bold">
                <Flag size={20} />
              </div>
              <div className="flex-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-red-700">Output Set</p>
                <p className="text-sm font-bold text-red-950">Local Flagged Accounts ({summary?.flagged})</p>
                <p className="text-xs text-red-700">Ready as candidate input for cross-bank PSI</p>
              </div>
            </div>
          </div>

          <div className="mt-8 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
            <p className="flex items-center justify-center gap-2 text-sm font-bold text-emerald-900">
              <ShieldCheck size={18} className="text-emerald-600" />
              "Raw transaction data never leaves {name}."
            </p>
          </div>
        </div>
      </Card>

      {/* Analysis Result Output */}
      {analysisResult && <Card className="vl-fade-in border-brand-200">
          <CardHeader title="Last Local Analysis Execution" subtitle={`Executed at ${fmtDateTime(analysisResult.ran_at)}`} icon={FileCheck} />
          <div className="p-5">
            <div className="grid gap-4 sm:grid-cols-4">
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Accounts Analyzed</p>
                <p className="text-lg font-bold text-navy-950">{analysisResult.accounts_analyzed}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Txns Evaluated</p>
                <p className="text-lg font-bold text-navy-950">{analysisResult.transactions_analyzed}</p>
              </div>
              <div className="rounded-lg bg-red-50 p-3">
                <p className="text-xs text-red-600">Flagged Accounts</p>
                <p className="text-lg font-bold text-red-700">{analysisResult.flagged}</p>
              </div>
              <div className="rounded-lg bg-emerald-50 p-3">
                <p className="text-xs text-emerald-700">Normal / Low Risk</p>
                <p className="text-lg font-bold text-emerald-800">{analysisResult.normal + analysisResult.medium}</p>
              </div>
            </div>
          </div>
        </Card>}
    </div>;
}

// ==================== pages/SuspiciousAccounts.jsx ====================
function SuspiciousAccounts() {
  const {
    session
  } = useAuth();
  const fetchAccounts = useCallback(() => api('/suspicious-accounts'), []);
  const {
    data,
    loading,
    refresh
  } = usePolling(fetchAccounts, 5000);
  const [filter, setFilter] = useState('ALL'); // 'ALL' | 'HIGH' | 'REVEALED'

  const accounts = data?.accounts || [];
  const filtered = useMemo(() => {
    return accounts.filter(a => {
      if (filter === 'HIGH') return a.fraud_ring_candidate;
      if (filter === 'REVEALED') return a.identity.state === 'REVEALED';
      return true;
    });
  }, [accounts, filter]);
  if (loading && !data) return <Spinner label="Loading suspicious accounts…" />;
  return <div className="space-y-6">
      <PageHeader eyebrow="Consortium Intelligence" title="Suspicious Cross-Bank Accounts" subtitle="Accounts identified by DH-PSI matching and homomorphic risk aggregation across multiple banks." />

      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1">
              <Filter size={14} /> Filter Results:
            </span>
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1">
              {[{
              id: 'ALL',
              label: `All (${accounts.length})`
            }, {
              id: 'HIGH',
              label: `High Risk Candidates (${accounts.filter(a => a.fraud_ring_candidate).length})`
            }, {
              id: 'REVEALED',
              label: `Revealed Identities (${accounts.filter(a => a.identity.state === 'REVEALED').length})`
            }].map(f => <button key={f.id} onClick={() => setFilter(f.id)} className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${filter === f.id ? 'bg-white text-navy-950 shadow-sm' : 'text-slate-600 hover:text-navy-950'}`}>
                  {f.label}
                </button>)}
            </div>
          </div>
        </div>
      </Card>

      <Card>
        {filtered.length > 0 ? <SuspiciousTable rows={filtered} onChanged={refresh} showInvestigation /> : <div className="py-16 text-center text-sm text-slate-500">
            No suspicious cross-bank accounts match the selected filter.
          </div>}
      </Card>
    </div>;
}

// ==================== App.jsx ====================
function Protected({
  children
}) {
  const {
    session
  } = useAuth();
  return session ? children : <Navigate to="/login" replace />;
}
function App() {
  const {
    session
  } = useAuth();
  return <Routes>
      <Route path="/login" element={session ? <Navigate to="/" replace /> : <Login />} />
      <Route element={<Protected>
            <Layout />
          </Protected>}>
        <Route index element={<Dashboard />} />
        <Route path="customers" element={<Customers />} />
        <Route path="risk-analysis" element={<RiskAnalysis />} />
        <Route path="investigations" element={<Investigations />} />
        <Route path="investigations/:id" element={<InvestigationDetail />} />
        <Route path="suspicious-accounts" element={<SuspiciousAccounts />} />
        <Route path="identity-requests" element={<IdentityRequests />} />
        <Route path="audit-logs" element={<AuditLogs />} />
        <Route path="privacy" element={<PrivacySecurity />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>;
}

export default App;
export { App };
