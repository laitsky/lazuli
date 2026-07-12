import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Bell,
  Check,
  Copy,
  FolderKanban,
  KeyRound,
  ListPlus,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserRound,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  ApiKeyRecord,
  PasskeyRecord,
  PriceAlertRecord,
  SavedBacktestRecord,
  SavedWorkspaceRecord,
  WatchlistRecord,
} from '@lazuli/shared';
import { useAuth } from '@/lib/auth';
import { LazuliAPI } from '@/lib/api-client';
import { usePreferences } from '@/lib/preferences';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { CardSkeleton, PageHeaderSkeleton } from '@/components/ui/skeleton';

interface AccountResources {
  workspaces: SavedWorkspaceRecord[];
  watchlists: WatchlistRecord[];
  alerts: PriceAlertRecord[];
  apiKeys: ApiKeyRecord[];
  passkeys: PasskeyRecord[];
  backtests: SavedBacktestRecord[];
}

const EMPTY_RESOURCES: AccountResources = {
  workspaces: [],
  watchlists: [],
  alerts: [],
  apiKeys: [],
  passkeys: [],
  backtests: [],
};

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function formatDate(timestamp: number | null): string {
  if (!timestamp) return 'Never';
  const milliseconds = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(milliseconds);
}

function sameItems(left: string[], right: string[]): boolean {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

export default function AccountPage() {
  const auth = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const processedToken = useRef<string | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);

  const magicToken = searchParams.get('token');
  useEffect(() => {
    if (!magicToken || processedToken.current === magicToken) return;
    processedToken.current = magicToken;
    // Remove the credential from history immediately, while retaining it in this closure.
    navigate('/account', { replace: true });
    void auth
      .verifyMagicLink(magicToken)
      .then(() => toast.success('Signed in securely.'))
      .catch((error: unknown) => setVerificationError(message(error, 'Sign-in failed.')));
  }, [auth, magicToken, navigate]);

  if (auth.status === 'loading' || magicToken) {
    return <AccountLoading />;
  }

  if (!auth.user) {
    return <SignInView verificationError={verificationError} />;
  }

  return <AccountSettings />;
}

function AccountLoading() {
  return (
    <div aria-busy="true" aria-label="Loading account">
      <PageHeaderSkeleton />
      <div className="grid gap-4 lg:grid-cols-2">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    </div>
  );
}

function SignInView({ verificationError }: { verificationError: string | null }) {
  const { requestMagicLink, signInWithPasskey, supportsPasskeys } = useAuth();
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState<'magic' | 'passkey' | null>(null);
  const [error, setError] = useState<string | null>(verificationError);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [developmentLink, setDevelopmentLink] = useState<string | null>(null);

  async function submitMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending('magic');
    setError(null);
    try {
      const result = await requestMagicLink(email);
      setSentTo(result.email);
      if (result.magicLink) {
        const url = new URL(result.magicLink, window.location.origin);
        const token = url.searchParams.get('token');
        setDevelopmentLink(
          token ? `/account?token=${encodeURIComponent(token)}` : result.magicLink
        );
      } else {
        setDevelopmentLink(null);
      }
    } catch (nextError) {
      setError(message(nextError, 'Could not send the sign-in link.'));
    } finally {
      setPending(null);
    }
  }

  async function submitPasskey() {
    setPending('passkey');
    setError(null);
    try {
      await signInWithPasskey(email.trim() || undefined);
      toast.success('Signed in with passkey.');
    } catch (nextError) {
      setError(message(nextError, 'Passkey sign-in failed.'));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        icon={ShieldCheck}
        title="Account"
        description="Sign in to sync watchlists, alerts, workspaces, and API access across devices."
      />
      <Card>
        <CardHeader>
          <CardTitle>Passwordless sign in</CardTitle>
          <CardDescription>
            Lazuli stores the session in a secure, HttpOnly cookie. Public market pages remain
            available without an account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {error && <ErrorBanner message={error} />}
          {sentTo ? (
            <div className="rounded-md border border-success/30 bg-success/10 p-4" role="status">
              <div className="flex items-start gap-3">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">Check {sentTo}</p>
                  <p className="text-sm text-muted-foreground">
                    The link expires in 15 minutes and can be used once.
                  </p>
                  {developmentLink && (
                    <a
                      href={developmentLink}
                      className="inline-flex min-h-10 items-center text-sm font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Continue with local development link
                    </a>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={submitMagicLink}>
              <div className="space-y-1.5">
                <label htmlFor="account-email" className="text-sm font-medium text-foreground">
                  Email
                </label>
                <Input
                  id="account-email"
                  type="email"
                  autoComplete="email webauthn"
                  spellCheck={false}
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  aria-describedby="account-email-help"
                />
                <p id="account-email-help" className="text-xs text-muted-foreground">
                  We send one sign-in link. No password required.
                </p>
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={pending !== null}
                aria-busy={pending === 'magic'}
              >
                {pending === 'magic' ? 'Sending link…' : 'Email a sign-in link'}
              </Button>
            </form>
          )}

          <div className="flex items-center gap-3" aria-hidden>
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs uppercase tracking-wider text-muted-foreground">or</span>
            <span className="h-px flex-1 bg-border" />
          </div>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={!supportsPasskeys || pending !== null}
            aria-busy={pending === 'passkey'}
            onClick={submitPasskey}
          >
            <KeyRound aria-hidden />
            {pending === 'passkey' ? 'Checking passkey…' : 'Sign in with a passkey'}
          </Button>
          {!supportsPasskeys && (
            <p className="text-xs text-muted-foreground">
              Passkeys require a supported browser and a secure HTTPS connection.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AccountSettings() {
  const { user, logout, registerPasskey, supportsPasskeys } = useAuth();
  const preferences = usePreferences();
  const [resources, setResources] = useState<AccountResources>(EMPTY_RESOURCES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const initialSyncStarted = useRef(false);

  const loadResources = useCallback(async () => {
    setLoading(true);
    setError(null);
    const responses = await Promise.all([
      LazuliAPI.listWorkspaces(),
      LazuliAPI.listWatchlists(),
      LazuliAPI.listAlerts(),
      LazuliAPI.listApiKeys(),
      LazuliAPI.listPasskeys(),
      LazuliAPI.listSavedBacktests(),
    ]);
    const failures = responses.filter((response) => !response.success);
    setResources({
      workspaces: responses[0].success && responses[0].data ? responses[0].data : [],
      watchlists: responses[1].success && responses[1].data ? responses[1].data : [],
      alerts: responses[2].success && responses[2].data ? responses[2].data : [],
      apiKeys: responses[3].success && responses[3].data ? responses[3].data : [],
      passkeys: responses[4].success && responses[4].data ? responses[4].data : [],
      backtests: responses[5].success && responses[5].data ? responses[5].data : [],
    });
    if (failures.length > 0) {
      setError('Some account data could not be loaded. Retry to restore the missing sections.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadResources();
  }, [loadResources]);

  const syncWatchlist = useCallback(
    async (automatic = false) => {
      if (!user) return;
      const marker = `lazuli.account-sync.v1.${user.id}`;
      if (automatic && window.localStorage.getItem(marker)) return;
      setSyncing(true);
      try {
        const localItems = preferences.watchlist;
        const server =
          resources.watchlists.find((watchlist) => watchlist.name === 'Default') ??
          resources.watchlists[0];
        if (!server && localItems.length > 0) {
          const saved = await LazuliAPI.saveWatchlist({ name: 'Default', items: localItems });
          if (!saved.success)
            throw new Error(saved.error || 'Could not upload the local watchlist.');
        } else if (server) {
          if (localItems.length > 0 && !sameItems(localItems, server.items)) {
            const conflictAlreadySaved = resources.watchlists.some(
              (watchlist) =>
                watchlist.name.startsWith('Local import') && sameItems(watchlist.items, localItems)
            );
            if (!conflictAlreadySaved) {
              const imported = await LazuliAPI.saveWatchlist({
                name: `Local import ${new Date().toISOString().slice(0, 10)}`,
                items: localItems,
              });
              if (!imported.success)
                throw new Error(imported.error || 'Could not preserve the local watchlist.');
            }
          }
          // The named server watchlist is authoritative; a conflict copy above prevents data loss.
          preferences.replaceWatchlist(server.items);
        }
        window.localStorage.setItem(marker, new Date().toISOString());
        await loadResources();
        if (!automatic) toast.success('Watchlist sync complete.');
      } catch (nextError) {
        setError(message(nextError, 'Watchlist sync failed.'));
      } finally {
        setSyncing(false);
      }
    },
    [loadResources, preferences, resources.watchlists, user]
  );

  useEffect(() => {
    if (loading || initialSyncStarted.current) return;
    initialSyncStarted.current = true;
    void syncWatchlist(true);
  }, [loading, syncWatchlist]);

  async function signOut() {
    try {
      await logout();
      toast.success('Signed out.');
    } catch (nextError) {
      toast.error(message(nextError, 'Sign-out could not be confirmed.'));
    }
  }

  if (!user) return null;

  return (
    <div>
      <PageHeader
        icon={UserRound}
        title="Account settings"
        description="Manage synchronized state, alerts, passkeys, and builder access."
        actions={
          <Button variant="outline" onClick={signOut}>
            <LogOut aria-hidden /> Sign out
          </Button>
        }
      />

      <section
        className="mb-4 rounded-lg border border-border bg-surface-1 p-5"
        aria-labelledby="profile-heading"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="profile-heading" className="font-display text-lg font-semibold text-foreground">
              {user.displayName || user.email}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{user.email}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Last sign-in: {formatDate(user.lastLoginAt)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="fresh">Active session</Badge>
            <Button
              variant="secondary"
              onClick={() => void syncWatchlist(false)}
              disabled={syncing || loading}
            >
              <RefreshCw className={cn(syncing && 'animate-spin')} aria-hidden />
              {syncing ? 'Syncing…' : 'Sync local state'}
            </Button>
          </div>
        </div>
      </section>

      {error && (
        <div className="mb-4">
          <ErrorBanner
            message={error}
            action={
              <Button variant="outline" size="sm" onClick={() => void loadResources()}>
                Retry
              </Button>
            }
          />
        </div>
      )}

      {loading ? (
        <div
          className="grid gap-4 lg:grid-cols-2"
          aria-busy="true"
          aria-label="Loading account data"
        >
          {Array.from({ length: 6 }).map((_, index) => (
            <CardSkeleton key={index} />
          ))}
        </div>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <WorkspaceSection items={resources.workspaces} onChanged={loadResources} />
          <WatchlistSection
            items={resources.watchlists}
            localItems={preferences.watchlist}
            onChanged={loadResources}
          />
          <AlertSection items={resources.alerts} email={user.email} onChanged={loadResources} />
          <PasskeySection
            items={resources.passkeys}
            supportsPasskeys={supportsPasskeys}
            registerPasskey={registerPasskey}
            onChanged={loadResources}
          />
          <ApiKeySection items={resources.apiKeys} onChanged={loadResources} />
          <BacktestSection items={resources.backtests} onChanged={loadResources} />
        </div>
      )}
    </div>
  );
}

function WorkspaceSection({
  items,
  onChanged,
}: {
  items: SavedWorkspaceRecord[];
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const response = await LazuliAPI.saveWorkspace({
      name,
      state: { pathname: window.location.pathname, search: window.location.search },
      isDefault: items.length === 0,
    });
    setPending(false);
    if (!response.success) {
      setError(response.error || 'Could not save this workspace.');
      return;
    }
    setName('');
    toast.success('Workspace saved.');
    await onChanged();
  }

  return (
    <SettingsCard
      icon={FolderKanban}
      title="Workspaces"
      description="Save URL-addressable layouts for another device."
    >
      <form onSubmit={save} className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="min-w-0 flex-1">
          <label htmlFor="workspace-name" className="sr-only">
            Workspace name
          </label>
          <Input
            id="workspace-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={80}
            placeholder="Workspace name"
            autoComplete="off"
          />
        </div>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? 'Saving…' : 'Save current page'}
        </Button>
      </form>
      {error && <InlineError message={error} />}
      <ResourceList
        emptyTitle="No saved workspaces"
        emptyDescription="Save the current page and its URL state to start."
      >
        {items.map((item) => (
          <ResourceRow
            key={item.id}
            title={item.name}
            detail={`Updated ${formatDate(item.updatedAt)}`}
            badge={item.isDefault ? 'Default' : undefined}
          >
            <DeleteControl
              label={`Delete ${item.name}`}
              onDelete={async () => {
                const response = await LazuliAPI.deleteWorkspace(item.id);
                if (!response.success) throw new Error(response.error || 'Delete failed.');
                await onChanged();
              }}
            />
          </ResourceRow>
        ))}
      </ResourceList>
    </SettingsCard>
  );
}

function WatchlistSection({
  items,
  localItems,
  onChanged,
}: {
  items: WatchlistRecord[];
  localItems: string[];
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const response = await LazuliAPI.saveWatchlist({ name, items: localItems });
    setPending(false);
    if (!response.success) return setError(response.error || 'Could not save the watchlist.');
    setName('');
    toast.success('Local watchlist saved.');
    await onChanged();
  }
  return (
    <SettingsCard
      icon={ListPlus}
      title="Watchlists"
      description="The dashboard keeps using local state; account copies sync across devices."
    >
      <form onSubmit={save} className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="min-w-0 flex-1">
          <label htmlFor="watchlist-name" className="sr-only">
            Watchlist name
          </label>
          <Input
            id="watchlist-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={80}
            placeholder="Watchlist name"
            autoComplete="off"
          />
        </div>
        <Button type="submit" disabled={pending || localItems.length === 0} aria-busy={pending}>
          {pending ? 'Saving…' : `Save ${localItems.length} symbols`}
        </Button>
      </form>
      {error && <InlineError message={error} />}
      <ResourceList
        emptyTitle="No synchronized watchlists"
        emptyDescription="Star markets locally, then save or sync them here."
      >
        {items.map((item) => (
          <ResourceRow
            key={item.id}
            title={item.name}
            detail={`${item.items.length} symbols · Updated ${formatDate(item.updatedAt)}`}
          >
            <DeleteControl
              label={`Delete ${item.name}`}
              onDelete={async () => {
                const response = await LazuliAPI.deleteWatchlist(item.id);
                if (!response.success) throw new Error(response.error || 'Delete failed.');
                await onChanged();
              }}
            />
          </ResourceRow>
        ))}
      </ResourceList>
    </SettingsCard>
  );
}

function AlertSection({
  items,
  email,
  onChanged,
}: {
  items: PriceAlertRecord[];
  email: string;
  onChanged: () => Promise<void>;
}) {
  const [symbol, setSymbol] = useState('BTC/USDT:USDT');
  const [exchange, setExchange] = useState('bybit');
  const [condition, setCondition] = useState<'above' | 'below'>('above');
  const [target, setTarget] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const priceTarget = Number(target);
    if (!Number.isFinite(priceTarget) || priceTarget <= 0) {
      setPending(false);
      return setError('Target price must be greater than zero.');
    }
    const response = await LazuliAPI.createAlert({
      symbol: symbol.trim().toUpperCase(),
      exchange,
      marketType: symbol.includes(':') ? 'perp' : 'spot',
      condition,
      priceTarget,
      delivery: { channels: ['email'], email },
    });
    setPending(false);
    if (!response.success) return setError(response.error || 'Could not create the alert.');
    setTarget('');
    toast.success('Price alert created.');
    await onChanged();
  }
  return (
    <SettingsCard
      icon={Bell}
      title="Price alerts"
      description="Email delivery plus private realtime events when the target crosses."
    >
      <form onSubmit={save} className="mb-4 grid grid-cols-2 gap-2">
        <div className="col-span-2 space-y-1">
          <label htmlFor="alert-symbol" className="text-xs font-medium text-foreground">
            Symbol
          </label>
          <Input
            id="alert-symbol"
            value={symbol}
            onChange={(event) => setSymbol(event.target.value)}
            required
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="alert-exchange" className="text-xs font-medium text-foreground">
            Exchange
          </label>
          <select
            id="alert-exchange"
            value={exchange}
            onChange={(event) => setExchange(event.target.value)}
            className={selectClassName}
          >
            {['bybit', 'binance', 'okx', 'hyperliquid', 'upbit'].map((value) => (
              <option key={value} value={value}>
                {value.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="alert-condition" className="text-xs font-medium text-foreground">
            Condition
          </label>
          <select
            id="alert-condition"
            value={condition}
            onChange={(event) => setCondition(event.target.value as 'above' | 'below')}
            className={selectClassName}
          >
            <option value="above">Above</option>
            <option value="below">Below</option>
          </select>
        </div>
        <div className="col-span-2 space-y-1">
          <label htmlFor="alert-target" className="text-xs font-medium text-foreground">
            Target price
          </label>
          <Input
            id="alert-target"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            required
            inputMode="decimal"
            pattern="[0-9]*[.]?[0-9]+"
            placeholder="65000"
            autoComplete="off"
          />
        </div>
        <Button type="submit" className="col-span-2" disabled={pending} aria-busy={pending}>
          {pending ? 'Creating…' : 'Create alert'}
        </Button>
      </form>
      {error && <InlineError message={error} />}
      <ResourceList
        emptyTitle="No price alerts"
        emptyDescription="Create an alert for a live spot or perpetual market."
      >
        {items.map((item) => (
          <ResourceRow
            key={item.id}
            title={`${item.symbol} ${item.condition} ${item.priceTarget.toLocaleString()}`}
            detail={`${item.exchange.toUpperCase()} · ${item.marketType}`}
            badge={item.active ? 'Active' : 'Triggered'}
          >
            <DeleteControl
              label={`Delete alert for ${item.symbol}`}
              onDelete={async () => {
                const response = await LazuliAPI.deleteAlert(item.id);
                if (!response.success) throw new Error(response.error || 'Delete failed.');
                await onChanged();
              }}
            />
          </ResourceRow>
        ))}
      </ResourceList>
    </SettingsCard>
  );
}

function PasskeySection({
  items,
  supportsPasskeys,
  registerPasskey,
  onChanged,
}: {
  items: PasskeyRecord[];
  supportsPasskeys: boolean;
  registerPasskey: (name?: string) => Promise<PasskeyRecord>;
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await registerPasskey(name.trim() || undefined);
      setName('');
      toast.success('Passkey added.');
      await onChanged();
    } catch (nextError) {
      setError(message(nextError, 'Could not add the passkey.'));
    } finally {
      setPending(false);
    }
  }
  return (
    <SettingsCard
      icon={ShieldCheck}
      title="Passkeys and devices"
      description="Biometric or security-key sign-in. Each credential identifies a trusted device."
    >
      <form onSubmit={add} className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="min-w-0 flex-1">
          <label htmlFor="passkey-name" className="sr-only">
            Passkey name
          </label>
          <Input
            id="passkey-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            placeholder="MacBook Touch ID"
            autoComplete="off"
          />
        </div>
        <Button type="submit" disabled={!supportsPasskeys || pending} aria-busy={pending}>
          {pending ? 'Waiting…' : 'Add passkey'}
        </Button>
      </form>
      {error && <InlineError message={error} />}
      <ResourceList
        emptyTitle="No passkeys"
        emptyDescription="Add a passkey after signing in with email."
      >
        {items.map((item) => (
          <ResourceRow
            key={item.id}
            title={item.name || 'Unnamed passkey'}
            detail={`${item.deviceType || 'Authenticator'} · Last used ${formatDate(item.lastUsedAt)}`}
            badge={item.backedUp ? 'Synced' : undefined}
          >
            <DeleteControl
              label={`Delete ${item.name || 'passkey'}`}
              onDelete={async () => {
                const response = await LazuliAPI.deletePasskey(item.id);
                if (!response.success) throw new Error(response.error || 'Delete failed.');
                await onChanged();
              }}
            />
          </ResourceRow>
        ))}
      </ResourceList>
    </SettingsCard>
  );
}

function ApiKeySection({
  items,
  onChanged,
}: {
  items: ApiKeyRecord[];
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const response = await LazuliAPI.createApiKey({ name, scopes: ['read:market-data'] });
    setPending(false);
    if (!response.success || !response.data)
      return setError(response.error || 'Could not create the API key.');
    setSecret(response.data.secret);
    setName('');
    await onChanged();
  }
  async function copySecret() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      toast.success('API key copied.');
    } catch {
      setError('Clipboard access failed. Select and copy the key manually.');
    }
  }
  return (
    <SettingsCard
      icon={KeyRound}
      title="API keys"
      description="Scoped builder credentials. Secrets are shown once and stored only as hashes."
    >
      {secret && (
        <div className="mb-4 rounded-md border border-warning/30 bg-warning/10 p-3" role="status">
          <p className="text-sm font-medium text-foreground">Copy this key now</p>
          <p className="mt-1 text-xs text-muted-foreground">It cannot be shown again.</p>
          <div className="mt-2 flex gap-2">
            <Input value={secret} readOnly className="font-mono text-xs" aria-label="New API key" />
            <Button size="icon" variant="outline" onClick={copySecret} aria-label="Copy API key">
              <Copy aria-hidden />
            </Button>
          </div>
        </div>
      )}
      <form onSubmit={create} className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="min-w-0 flex-1">
          <label htmlFor="api-key-name" className="sr-only">
            API key name
          </label>
          <Input
            id="api-key-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={80}
            placeholder="Analytics script"
            autoComplete="off"
          />
        </div>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? 'Creating…' : 'Create read key'}
        </Button>
      </form>
      {error && <InlineError message={error} />}
      <ResourceList
        emptyTitle="No API keys"
        emptyDescription="Create a read-only key for market-data integrations."
      >
        {items
          .filter((item) => !item.revokedAt)
          .map((item) => (
            <ResourceRow
              key={item.id}
              title={item.name}
              detail={`${item.keyPrefix}… · Last used ${formatDate(item.lastUsedAt)}`}
              badge={item.scopes.join(', ')}
            >
              <DeleteControl
                label={`Revoke ${item.name}`}
                actionLabel="Revoke"
                onDelete={async () => {
                  const response = await LazuliAPI.revokeApiKey(item.id);
                  if (!response.success) throw new Error(response.error || 'Revoke failed.');
                  await onChanged();
                }}
              />
            </ResourceRow>
          ))}
      </ResourceList>
    </SettingsCard>
  );
}

function BacktestSection({
  items,
  onChanged,
}: {
  items: SavedBacktestRecord[];
  onChanged: () => Promise<void>;
}) {
  return (
    <SettingsCard
      icon={FolderKanban}
      title="Saved backtests"
      description="Backtest snapshots saved from Signal Lab."
    >
      <ResourceList
        emptyTitle="No saved backtests"
        emptyDescription="Run a strategy in Signal Lab and save the result."
      >
        {items.map((item) => (
          <ResourceRow
            key={item.id}
            title={item.name}
            detail={`${item.exchange.toUpperCase()} · ${item.symbol} · ${item.timeframe}`}
          >
            <DeleteControl
              label={`Delete ${item.name}`}
              onDelete={async () => {
                const response = await LazuliAPI.deleteSavedBacktest(item.id);
                if (!response.success) throw new Error(response.error || 'Delete failed.');
                await onChanged();
              }}
            />
          </ResourceRow>
        ))}
      </ResourceList>
    </SettingsCard>
  );
}

function SettingsCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof UserRound;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-accent" aria-hidden />
          <CardTitle>{title}</CardTitle>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function ResourceList({
  children,
  emptyTitle,
  emptyDescription,
}: {
  children: ReactNode;
  emptyTitle: string;
  emptyDescription: string;
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return hasChildren ? (
    <div className="divide-y divide-border border-t border-border">{children}</div>
  ) : (
    <EmptyState compact title={emptyTitle} description={emptyDescription} />
  );
}

function ResourceRow({
  title,
  detail,
  badge,
  children,
}: {
  title: string;
  detail: string;
  badge?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-14 items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-foreground">{title}</p>
          {badge && (
            <Badge variant="secondary" className="max-w-40 truncate">
              {badge}
            </Badge>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</p>
      </div>
      {children}
    </div>
  );
}

function DeleteControl({
  label,
  actionLabel = 'Delete',
  onDelete,
}: {
  label: string;
  actionLabel?: string;
  onDelete: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function remove() {
    setPending(true);
    setError(null);
    try {
      await onDelete();
      toast.success(`${actionLabel}d.`);
    } catch (nextError) {
      setError(message(nextError, `${actionLabel} failed.`));
    } finally {
      setPending(false);
      setConfirming(false);
    }
  }
  if (confirming) {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => void remove()}
            disabled={pending}
            aria-busy={pending}
          >
            {pending ? `${actionLabel}…` : `Confirm ${actionLabel.toLowerCase()}`}
          </Button>
        </div>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    );
  }
  return (
    <Button size="icon" variant="ghost" onClick={() => setConfirming(true)} aria-label={label}>
      <Trash2 aria-hidden />
    </Button>
  );
}

function ErrorBanner({ message: errorMessage, action }: { message: string; action?: ReactNode }) {
  return (
    <div
      className="flex flex-col gap-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 sm:flex-row sm:items-center"
      role="alert"
    >
      <p className="min-w-0 flex-1 text-sm text-destructive">{errorMessage}</p>
      {action}
    </div>
  );
}

function InlineError({ message: errorMessage }: { message: string }) {
  return (
    <p className="mb-3 text-xs text-destructive" role="alert">
      {errorMessage}
    </p>
  );
}

const selectClassName = cn(
  'flex h-10 w-full rounded-md border border-border bg-surface-1 px-3 text-sm text-foreground',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-accent'
);
