import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ClipboardList,
  GlassWater,
  ListFilter,
  LogOut,
  UserRound,
  Martini,
  Package,
  QrCode,
  Search,
  Sparkles,
  Wine,
  X,
} from 'lucide-react';
import QRCode from 'qrcode';
import { BrandIcon, InviteQr } from './InviteQr';
import { api, ApiError, guestApi, requestKey, usePoll } from './api';
import type { Cocktail, Drink, Guest, Menu, Order } from '../shared/types';
import '@fontsource-variable/noto-sans-jp';
import '@fontsource-variable/noto-serif-jp';
import './style.css';
import { auth, login, logout, useIdentity } from './auth';
import { PurchaseSuggestions } from './PurchaseSuggestions';

function useNavigation() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const update = () => setPath(location.pathname);
    addEventListener('popstate', update);
    return () => removeEventListener('popstate', update);
  }, []);
  const navigate = useCallback((next: string) => {
    history.pushState({}, '', next);
    setPath(next);
    window.dispatchEvent(new PopStateEvent('popstate'));
    window.scrollTo(0, 0);
  }, []);
  return { path, navigate };
}
const time = (value: string) =>
  new Date(value).toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="notice" role="alert">
      <CircleAlert size={18} />
      <span>{children}</span>
    </div>
  );
}
function Empty({
  title,
  children,
  icon = <Martini size={32} />,
}: {
  title: string;
  children?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}
function Loading() {
  return (
    <div className="loading" role="status">
      読み込み中…
    </div>
  );
}
function Photo({ src, name, className = '' }: { src: string; name: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return (
    <div className={`photo ${className}`}>
      {src && !failed ? (
        <img src={src} alt={name} loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <Martini size={44} strokeWidth={1} />
      )}
    </div>
  );
}
function Pager({
  page,
  more,
  onPage,
}: {
  page: number;
  more: boolean;
  onPage: (p: number) => void;
}) {
  return (
    <div className="pager">
      <button
        className="secondary icon-button"
        disabled={page <= 1}
        aria-label="前のページ"
        onClick={() => onPage(page - 1)}
      >
        <ChevronLeft size={20} />
      </button>
      <span>{page}ページ</span>
      <button
        className="secondary icon-button"
        disabled={!more}
        aria-label="次のページ"
        onClick={() => onPage(page + 1)}
      >
        <ChevronRight size={20} />
      </button>
    </div>
  );
}
function Header({ host, navigate }: { host: boolean; navigate: (path: string) => void }) {
  return (
    <header className="site-header">
      <button
        className="brand"
        onClick={() => navigate(host ? '/host' : '/')}
        aria-label="ホームへ"
      >
        <span className="brand-mark">
          <BrandIcon size={22} />
        </span>
        <span>
          Milleflewrs<small>HOME BAR</small>
        </span>
      </button>
      <span className="header-label">{host ? 'HOST COUNTER' : 'WELCOME'}</span>
    </header>
  );
}
function Join({
  onJoin,
  token,
  barId,
}: {
  onJoin: (guest: Guest) => void;
  token: string;
  barId: string;
}) {
  const [nickname, setNickname] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api<{ guest: Guest }>(`/api/b/${barId}/join`, {
        method: 'POST',
        body: JSON.stringify({ nickname, token }),
      });
      onJoin(result.guest);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="welcome">
      <div className="welcome-rule" />
      <div className="eyebrow">MAKE YOURSELF AT HOME</div>
      <h1>今夜の一杯を。</h1>
      <p>
        ようこそ、Milleflewrsへ。
        <br />
        お名前を添えて、カクテルをお選びください。
      </p>
      <form onSubmit={submit}>
        <label htmlFor="nickname">ニックネーム</label>
        <input
          id="nickname"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="お名前"
          maxLength={24}
          autoComplete="nickname"
          required
        />
        {error && <Notice>{error}</Notice>}
        <button disabled={busy || !nickname.trim()}>
          {busy ? '参加しています…' : 'メニューを開く'}
          <ArrowRight size={18} />
        </button>
      </form>
      <span className="welcome-foot">一杯ずつ、心を込めて。</span>
    </main>
  );
}
function GuestMenu({ navigate, barName }: { navigate: (path: string) => void; barName: string }) {
  const [q, setQ] = useState(''),
    [kind, setKind] = useState(''),
    [strength, setStrength] = useState(''),
    [page, setPage] = useState(1),
    [filters, setFilters] = useState(false);
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(q), 200);
    return () => clearTimeout(timer);
  }, [q]);
  const query = new URLSearchParams({ q: debounced, kind, page: String(page) });
  if (strength) {
    const [min, max] = strength.split(':');
    query.set('min', min);
    query.set('max', max);
  }
  const { data, error, loading } = usePoll<Menu>(guestApi(`/menu?${query}`));
  useEffect(() => {
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (tool: unknown, options: { signal: AbortSignal }) => unknown;
        };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const tool = {
      name: 'filter_cocktail_menu',
      title: 'カクテルを検索',
      description:
        '作成可能なカクテルのメニューを名前・材料のキーワードで絞り込み、画面にも反映する。注文は行わない。',
      inputSchema: {
        type: 'object',
        properties: { keyword: { type: 'string' } },
        required: ['keyword'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input: unknown) => {
        if (
          !input ||
          typeof input !== 'object' ||
          !('keyword' in input) ||
          typeof input.keyword !== 'string' ||
          input.keyword.length > 100
        )
          throw new Error('検索キーワードを100文字以内で指定してください。');
        const keyword = input.keyword;
        const result = await api<Menu>(guestApi(`/menu?q=${encodeURIComponent(keyword)}`));
        flushSync(() => {
          setQ(keyword);
          setDebounced(keyword);
          setKind('');
          setStrength('');
          setPage(1);
        });
        return {
          total: result.total,
          cocktails: result.items.map((c) => ({ id: c.id, name: c.name })),
        };
      },
    };
    try {
      void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(
        () => {},
      );
    } catch {
      /* Optional browser API. */
    }
    return () => lifecycle.abort();
  }, []);
  function reset() {
    setQ('');
    setKind('');
    setStrength('');
    setPage(1);
  }
  return (
    <main className="content">
      <section className="page-heading">
        <div>
          <div className="eyebrow">THE MENU</div>
          <h1>今夜のメニュー</h1>
          <p className="page-context">{barName}</p>
        </div>
        <div className="menu-count">
          <strong>{data?.availableTotal ?? '—'}</strong>
          <span>種類のカクテル</span>
        </div>
      </section>
      <div className="search-row">
        <div className="search-input">
          <Search size={19} />
          <input
            aria-label="カクテル名・材料名で検索"
            placeholder="カクテル名・材料名で探す"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
          {q && (
            <button
              aria-label="検索をクリア"
              className="clear-search"
              onClick={() => {
                setQ('');
                setPage(1);
              }}
            >
              <X size={16} />
            </button>
          )}
        </div>
        <button
          className={`secondary filter-button ${filters ? 'active' : ''}`}
          aria-label="絞り込み条件を表示"
          aria-expanded={filters}
          onClick={() => setFilters(!filters)}
        >
          <ListFilter size={20} />
        </button>
      </div>
      {filters && (
        <div className="filters">
          <label>
            お酒の種類
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setPage(1);
              }}
            >
              <option value="">すべてのお酒</option>
              {data?.kinds.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            度数（原レシピの参考値）
            <select
              value={strength}
              onChange={(e) => {
                setStrength(e.target.value);
                setPage(1);
              }}
            >
              <option value="">すべての度数</option>
              <option value="0:0">ノンアルコール · 0%</option>
              <option value="0:8">弱め · 8%以下</option>
              <option value="9:24">普通 · 9〜24%</option>
              <option value="25:100">強め · 25%以上</option>
            </select>
          </label>
        </div>
      )}
      <div className="menu-toolbar">
        <span>
          {kind || strength || q ? `${data?.total ?? '—'} 件の検索結果` : 'いま作れるカクテル'}
          {(kind || strength) && (
            <button className="text-button" onClick={reset}>
              条件をクリア
            </button>
          )}
        </span>
        <span className="quiet-label">
          <span className="live-dot" />
          在庫に合わせて更新
        </span>
      </div>
      {error && <Notice>{error}</Notice>}
      {loading && !data ? (
        <Loading />
      ) : data?.items.length ? (
        <>
          <div className="cocktail-grid">
            {data.items.map((c) => (
              <button
                key={c.id}
                className="cocktail-card"
                onClick={() => navigate(`/cocktails/${c.id}`)}
              >
                <Photo src={c.image} name={c.name} />
                <div className="card-body">
                  <span className="card-technique">{c.technique}</span>
                  <h2>{c.name}</h2>
                  <p className="card-ingredients">
                    {c.ingredients
                      .slice(0, 3)
                      .map((i) => i.name)
                      .join(' / ')}
                  </p>
                  <div className="card-bottom">
                    <span>{c.alcohol ? c.alcohol.replace(/^度数\s*/, '') : '度数不明'}</span>
                    <ArrowRight size={16} />
                  </div>
                  {c.substitution && (
                    <span className="substitution">
                      <Sparkles size={12} />
                      同じ種類の材料で代用
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
          {data.pages > 1 && (
            <Pager page={data.page} more={data.page < data.pages} onPage={setPage} />
          )}
        </>
      ) : (
        data && (
          <Empty
            title={
              data.availableTotal === 0
                ? 'メニューを準備しています'
                : '該当するカクテルがありません'
            }
          >
            {data.availableTotal === 0 ? (
              '家主が材料を登録すると、作れるカクテルがここに並びます。'
            ) : (
              <>
                <span>別の名前や条件で探してみてください。</span>
                <button className="secondary" onClick={reset}>
                  条件をクリア
                </button>
              </>
            )}
          </Empty>
        )
      )}
    </main>
  );
}
function CocktailDetail({ id, navigate }: { id: string; navigate: (path: string) => void }) {
  const { data: cocktail, error } = usePoll<Cocktail>(guestApi(`/cocktails/${id}`));
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [key, setKey] = useState(requestKey),
    [ordered, setOrdered] = useState(false);
  useLayoutEffect(() => {
    // Completion replaces the detail without navigation; reset after the DOM update.
    if (ordered) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [ordered]);
  async function order() {
    if (!cocktail) return;
    setBusy(true);
    setMessage('');
    try {
      await api(guestApi('/orders'), {
        method: 'POST',
        body: JSON.stringify({ cocktailId: cocktail.id, requestKey: key }),
      });
      setOrdered(true);
    } catch (e) {
      setMessage((e as Error).message);
      if (e instanceof ApiError && e.status !== 0 && e.status < 500) setKey(requestKey());
    } finally {
      setBusy(false);
    }
  }
  if (ordered)
    return (
      <main className="content narrow">
        <div className="order-success">
          <div className="success-circle">
            <Check size={36} />
          </div>
          <div className="eyebrow">ORDER RECEIVED</div>
          <h1>ご注文を承りました</h1>
          <p>
            {cocktail?.name}
            <br />
            家主が一杯ずつお作りします。
          </p>
          <button onClick={() => navigate('/orders')}>
            注文状況を見る
            <ArrowRight size={18} />
          </button>
          <button className="secondary" onClick={() => navigate('/')}>
            メニューに戻る
          </button>
        </div>
      </main>
    );
  return (
    <main className="content narrow">
      <button className="back-button" onClick={() => navigate('/')}>
        <ArrowLeft size={18} />
        メニュー
      </button>
      {error && <Notice>{error}</Notice>}
      {!cocktail ? (
        !error && <Loading />
      ) : (
        <>
          <Photo src={cocktail.image} name={cocktail.name} className="detail-photo" />
          <div className="detail-title">
            <div className="eyebrow">{cocktail.technique}</div>
            <h1>{cocktail.name}</h1>
            <span className="degree">
              {cocktail.alcohol || '度数不明'}
              <small>原レシピの参考値</small>
            </span>
          </div>
          {cocktail.description && <p className="description">{cocktail.description}</p>}
          <div className="detail-info">
            <span>
              <Wine size={17} />
              {cocktail.glass}
            </span>
            <span>
              <Martini size={17} />
              {cocktail.technique}
            </span>
          </div>
          <h2 className="section-label">材料</h2>
          <div className="recipe-list">
            {cocktail.ingredients.map((i) => (
              <div key={i.id}>
                <span>
                  {i.name}
                  {i.substitute && <small>同じ種類の材料で代用</small>}
                </span>
                <span>{i.quantity}</span>
              </div>
            ))}
          </div>
          {cocktail.substitution && (
            <p className="hint">
              代用品は家主が選びます。原レシピと味わいや度数が異なる場合があります。
            </p>
          )}
          {message && <Notice>{message}</Notice>}
          <div className="order-action">
            <button disabled={busy || !cocktail.available} onClick={order}>
              {busy
                ? '注文を送信しています…'
                : cocktail.available
                  ? 'このカクテルを1杯注文'
                  : '現在、材料が不足しています'}
              {!busy && cocktail.available && <ArrowRight size={18} />}
            </button>
          </div>
        </>
      )}
    </main>
  );
}
function OrderList({
  host,
  guestIdentity,
}: {
  host: boolean;
  guestIdentity?: { nickname: string; barName: string };
}) {
  const [status, setStatus] = useState('pending'),
    [page, setPage] = useState(1),
    [expanded, setExpanded] = useState<string | null>(null),
    [busy, setBusy] = useState<string | null>(null),
    [message, setMessage] = useState('');
  const { data, error, loading, refresh } = usePoll<{
    orders: Order[];
    more: boolean;
    pendingCount?: number;
  }>(host ? `/api/host/orders?status=${status}&page=${page}` : guestApi(`/orders?page=${page}`));
  async function action(id: string, route: string, body: unknown, method = 'POST') {
    setBusy(id);
    setMessage('');
    try {
      await api(route, { method, body: JSON.stringify(body) });
      await refresh();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <main className="content">
      <section className="page-heading">
        <div>
          <div className="eyebrow">{host ? 'AT THE COUNTER' : 'YOUR ORDERS'}</div>
          <h1>{host ? '注文カウンター' : 'ご注文の一杯'}</h1>
        </div>
        <span className="status-live">
          <span className="live-dot" />
          自動更新
        </span>
      </section>
      {guestIdentity && (
        <div className="guest-identity">
          <UserRound size={20} aria-hidden="true" />
          <div>
            <strong>{guestIdentity.nickname} さんのご注文</strong>
            <span>{guestIdentity.barName}</span>
          </div>
        </div>
      )}
      {host && (
        <div className="segment">
          <button
            className={status === 'pending' ? 'selected' : ''}
            onClick={() => {
              setStatus('pending');
              setPage(1);
            }}
          >
            受付中 <span>{data?.pendingCount ?? '—'}</span>
          </button>
          <button
            className={status === 'completed' ? 'selected' : ''}
            onClick={() => {
              setStatus('completed');
              setPage(1);
            }}
          >
            提供完了の履歴
          </button>
        </div>
      )}
      {(error || message) && <Notice>{message || error}</Notice>}
      {loading && !data ? (
        <Loading />
      ) : data?.orders.length ? (
        <>
          <div className="orders-list">
            {data.orders.map((order) => (
              <article className="order-card" key={order.id}>
                <button
                  className="order-summary"
                  onClick={() => setExpanded(expanded === order.id ? null : order.id)}
                  aria-expanded={expanded === order.id}
                >
                  <Photo src={order.image} name={order.cocktailName} />
                  <div>
                    <span className={`badge ${order.status === 'completed' ? 'done' : ''}`}>
                      {order.status === 'pending' ? '受付' : '提供完了'}
                    </span>
                    <h2>{order.cocktailName}</h2>
                    <p>
                      {host && <strong>{order.nickname} さん · </strong>}
                      {time(order.createdAt)}
                    </p>
                  </div>
                  <ChevronRight className={expanded === order.id ? 'rotated' : ''} size={18} />
                </button>
                {expanded === order.id && (
                  <div className="order-expanded">
                    {host && (
                      <p className="hint">
                        {order.technique} · {order.glass}
                      </p>
                    )}
                    <div className="recipe-list">
                      {order.ingredients.map((i) => (
                        <div className="order-ingredient" key={i.recipeId}>
                          <div className="ingredient-line">
                            <span>{i.name}</span>
                            <span>{i.quantity}</span>
                          </div>
                          {host &&
                          order.status === 'pending' &&
                          (i.selectedId === null || i.selectedId !== i.drinkId || i.missing) ? (
                            <>
                              <label className="substitute-label">
                                {i.selectedId === null ? '使用する代用品を選択' : '使用する材料'}
                                <select
                                  aria-label={`${i.name}の使用材料`}
                                  disabled={busy === order.id || !i.candidates.length}
                                  value={
                                    i.candidates.some((d) => d.id === i.selectedId)
                                      ? i.selectedId!
                                      : ''
                                  }
                                  onChange={(e) =>
                                    action(
                                      order.id,
                                      `/api/host/orders/${order.id}/ingredients/${i.recipeId}`,
                                      { drinkId: Number(e.target.value) },
                                      'PUT',
                                    )
                                  }
                                >
                                  <option value="">
                                    {i.candidates.length
                                      ? '材料を選択してください'
                                      : '現在の在庫に候補がありません'}
                                  </option>
                                  {i.candidates.map((d) => (
                                    <option value={d.id} key={d.id}>
                                      {d.name}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              {i.selectedName && <small>記録済み：{i.selectedName}</small>}
                            </>
                          ) : (
                            i.selectedId !== i.drinkId && (
                              <small>
                                {i.selectedName
                                  ? `使用材料：${i.selectedName}`
                                  : '同じ種類の材料で代用（家主が選択）'}
                              </small>
                            )
                          )}
                          {host && i.missing && (
                            <small className="warning-text">
                              現在の在庫が不足しています。手元の材料をご確認ください。
                            </small>
                          )}
                        </div>
                      ))}
                    </div>
                    {order.completedAt && (
                      <p className="hint">{time(order.completedAt)} 提供完了</p>
                    )}
                    {host && order.status === 'pending' && (
                      <button
                        className="complete-button"
                        disabled={
                          busy === order.id || order.ingredients.some((i) => i.selectedId === null)
                        }
                        onClick={() =>
                          action(order.id, `/api/host/orders/${order.id}/complete`, {})
                        }
                      >
                        <CheckCheck size={19} />
                        {busy === order.id ? '更新しています…' : '提供完了にする'}
                      </button>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
          {(page > 1 || data.more) && <Pager page={page} more={data.more} onPage={setPage} />}
        </>
      ) : (
        data && (
          <Empty
            title={
              host
                ? status === 'pending'
                  ? '受付中の注文はありません'
                  : '提供完了の履歴はまだありません'
                : 'まだ注文はありません'
            }
            icon={<ClipboardList size={32} />}
          >
            {host
              ? '客人からの注文をここで確認できます。'
              : 'メニューから、お好きな一杯をお選びください。'}
          </Empty>
        )
      )}
    </main>
  );
}
function Inventory() {
  const { data, error, loading, refresh } = usePoll<{
    drinks: Drink[];
    availableCount: number;
    catalogVersion: string;
  }>('/api/host/inventory');
  const [q, setQ] = useState(''),
    [filter, setFilter] = useState('all'),
    [busy, setBusy] = useState<number | null>(null),
    [message, setMessage] = useState('');
  async function toggle(d: Drink) {
    setBusy(d.id);
    setMessage('');
    try {
      await api(`/api/host/inventory/${d.id}`, {
        method: 'PUT',
        body: JSON.stringify({ available: !d.available }),
      });
      await refresh();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const normalized = q.normalize('NFKC').toLowerCase();
  const drinks = data?.drinks.filter(
    (d) =>
      `${d.name} ${d.kindName}`.normalize('NFKC').toLowerCase().includes(normalized) &&
      (filter === 'all' ||
        (filter === 'available' && d.available) ||
        (filter === 'alcohol' && d.kindId !== null && d.kindId <= 57) ||
        (filter === 'mixer' && (d.kindId === null || d.kindId > 57))),
  );
  return (
    <main className="content">
      <section className="page-heading">
        <div>
          <div className="eyebrow">ON THE SHELF</div>
          <h1>家にある材料</h1>
        </div>
        <span className="small-summary">水・氷は常備</span>
      </section>
      <div className="inventory-stats">
        <div>
          <span>ある材料</span>
          <strong>
            {data?.drinks.filter((d) => d.available && !d.staple).length ?? '—'}
            <small>種類</small>
          </strong>
        </div>
        <div>
          <span>作れるカクテル</span>
          <strong>
            {data?.availableCount ?? '—'}
            <small>種類</small>
          </strong>
        </div>
      </div>
      <PurchaseSuggestions
        drinks={data?.drinks}
        updating={busy !== null}
        catalogVersion={data?.catalogVersion}
      />
      <div className="search-input">
        <Search size={19} />
        <input
          placeholder="お酒・ジュース・果物を探す"
          aria-label="材料を検索"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="filter-chips">
        {[
          ['all', 'すべて'],
          ['alcohol', 'お酒'],
          ['mixer', '割り材・その他'],
          ['available', 'あるもの'],
        ].map(([value, label]) => (
          <button
            key={value}
            className={filter === value ? 'selected' : ''}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {(message || error) && <Notice>{message || error}</Notice>}
      {loading && !data ? (
        <Loading />
      ) : (
        <div className="inventory-list">
          {drinks?.map((d) => (
            <div className="inventory-row" key={d.id}>
              <div className="drink-icon">
                {d.kindId !== null && d.kindId <= 57 ? (
                  <Wine size={20} />
                ) : (
                  <GlassWater size={20} />
                )}
              </div>
              <div className="drink-name">
                <span>{d.name}</span>
                <small>{d.kindName}</small>
              </div>
              {d.staple ? (
                <span className="staple-label">
                  <Check size={15} />
                  常備
                </span>
              ) : (
                <button
                  className={`switch ${d.available ? 'on' : ''}`}
                  role="switch"
                  aria-checked={d.available}
                  aria-label={`${d.name}の在庫`}
                  disabled={busy !== null}
                  onClick={() => toggle(d)}
                >
                  <span />
                  <small>{busy === d.id ? '…' : d.available ? 'ある' : 'ない'}</small>
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {data && !drinks?.length && (
        <Empty title="材料が見つかりません">名前や条件を変えて検索してください。</Empty>
      )}
    </main>
  );
}
type PublicBar = { id: string; name: string; acceptingOrders: boolean; inventoryVersion: number };
function Invite() {
  const { data, error, refresh } = usePoll<PublicBar & { inviteUrl: string }>(
    '/api/host/invitation',
  );
  const [name, setName] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [confirmRotate, setConfirmRotate] = useState(false);
  useEffect(() => {
    if (data) setName(data.name);
  }, [data?.name]);
  let qr: QRCode.QRCode | null = null;
  try {
    if (data?.inviteUrl && !error)
      qr = QRCode.create(data.inviteUrl, { errorCorrectionLevel: 'H' });
  } catch {
    /* visible fallback below */
  }
  async function update(path: string, method: string, value: unknown) {
    setBusy(true);
    setMessage('');
    try {
      await api(path, { method, body: JSON.stringify(value) });
      await refresh();
      setConfirmRotate(false);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="content narrow">
      <section className="page-heading">
        <div>
          <div className="eyebrow">INVITE YOUR GUESTS</div>
          <h1>客人をお迎えする</h1>
        </div>
      </section>
      <p>このQRコードを読み取って参加してもらってください。</p>
      {error && <Notice>{error}</Notice>}
      {message && <Notice>{message}</Notice>}
      {data && !error && (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void update('/api/host/bar', 'PATCH', { name });
            }}
          >
            <label className="field-label">
              バーの名前
              <input
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </label>
            <button disabled={busy || !name.trim()}>名前を保存</button>
          </form>
          <p>注文受付：{data.acceptingOrders ? '受付中' : '停止中'}</p>
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              update('/api/host/bar', 'PATCH', { acceptingOrders: !data.acceptingOrders })
            }
          >
            {data.acceptingOrders ? '受付を停止する' : '受付を開始する'}
          </button>
          <div className="qr-panel">
            {qr ? (
              <div className="invite-card">
                <div className="invite-card-heading">
                  Milleflewrs<span>{data.name}</span>
                </div>
                <InviteQr code={qr} />
                <div className="invite-card-caption">
                  <span>SCAN TO JOIN</span>
                </div>
              </div>
            ) : (
              <Notice>QRコードを生成できませんでした。</Notice>
            )}
          </div>
          <label className="field-label">
            参加用URL
            <input readOnly value={data.inviteUrl} onFocus={(e) => e.target.select()} />
          </label>
          <button
            className="secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(data.inviteUrl);
                setMessage('参加用URLをコピーしました。');
              } catch {
                setMessage('参加用URLを選択してコピーしてください。');
              }
            }}
          >
            URLをコピー
          </button>
          <p>
            リンクを再発行すると、以前のQRと客人の参加状態が無効になります。注文履歴は残ります。
          </p>
          {confirmRotate ? (
            <>
              <button
                disabled={busy}
                onClick={() => update('/api/host/invitation/rotate', 'POST', {})}
              >
                再発行して以前の招待を無効にする
              </button>
              <button className="text-button" onClick={() => setConfirmRotate(false)}>
                戻る
              </button>
            </>
          ) : (
            <button className="secondary" onClick={() => setConfirmRotate(true)}>
              招待リンクを再発行
            </button>
          )}
        </>
      )}
    </main>
  );
}
function Landing({ host = false }: { host?: boolean }) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <main className="welcome">
      <div className="eyebrow">YOUR OWN HOME BAR</div>
      <h1>自宅を、あなたのバーに。</h1>
      <p>
        手元の材料を登録して、客人をQRでお迎え。
        <br />
        届いた注文を確認し、一杯ずつ提供できます。
      </p>
      {error && <Notice>{error}</Notice>}
      {!auth && <Notice>Googleログインの設定がまだ完了していません。</Notice>}
      <button
        disabled={busy || !auth}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await login();
            location.assign('/host');
          } catch {
            setError('ログインできませんでした。ポップアップを許可して再試行してください。');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'ログイン中…' : 'Googleで登録・ログイン'}
      </button>
      <p>客人の方は、家主から届いた招待QRを読み取ってください。</p>
      {host && <a href="/">サービス案内へ</a>}
    </main>
  );
}
function HostArea() {
  const { user, ready } = useIdentity();
  const [registered, setRegistered] = useState(''),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setRegistered('');
    setError('');
    if (user)
      api('/api/host/bootstrap', { method: 'POST', body: '{}' })
        .then(() => {
          if (active) setRegistered(user.uid);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [user?.uid]);
  useEffect(() => {
    const expired = () => {
      void logout();
    };
    window.addEventListener('host-session-expired', expired);
    return () => window.removeEventListener('host-session-expired', expired);
  }, []);
  if (!ready) return <Loading />;
  if (!user) return <Landing host />;
  if (error)
    return (
      <main className="content">
        <Notice>{error}</Notice>
        <button onClick={() => location.reload()}>再試行</button>
        <button className="secondary" onClick={() => logout()}>
          ログアウト
        </button>
      </main>
    );
  if (registered !== user.uid) return <Loading />;
  return (
    <HostContent
      key={user.uid}
      displayName={user.displayName || user.email || '家主'}
      email={user.email}
    />
  );
}
function HostAccount({ displayName, email }: { displayName: string; email: string | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <main className="content narrow">
      <div className="eyebrow">YOUR ACCOUNT</div>
      <h1>アカウント</h1>
      <section className="account-card" aria-label="ログイン中のアカウント">
        <span className="account-avatar">
          <UserRound size={28} aria-hidden="true" />
        </span>
        <div className="account-details">
          <span className="eyebrow">HOST</span>
          <h2>{displayName}</h2>
          {email && email !== displayName && <p>{email}</p>}
          <span className="account-provider">Googleでログイン中</span>
        </div>
      </section>
      {error && <Notice>{error}</Notice>}
      <button
        className="secondary account-logout"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await logout();
          } catch {
            setError('ログアウトできませんでした。もう一度お試しください。');
          } finally {
            setBusy(false);
          }
        }}
      >
        <LogOut size={18} aria-hidden="true" />
        {busy ? 'ログアウト中…' : 'ログアウト'}
      </button>
    </main>
  );
}
function HostContent({ displayName, email }: { displayName: string; email: string | null }) {
  const { path, navigate } = useNavigation();
  const tab =
    path === '/host/account'
      ? 'account'
      : path.includes('inventory')
        ? 'inventory'
        : path.includes('invite')
          ? 'invite'
          : 'orders';
  return (
    <>
      {tab === 'account' ? (
        <HostAccount displayName={displayName} email={email} />
      ) : tab === 'inventory' ? (
        <Inventory />
      ) : tab === 'invite' ? (
        <Invite />
      ) : (
        <OrderList host />
      )}
      <nav className="bottom-nav" aria-label="家主メニュー">
        {[
          ['orders', '/host', '注文'],
          ['inventory', '/host/inventory', '在庫'],
          ['invite', '/host/invite', 'お迎え'],
          ['account', '/host/account', 'アカウント'],
        ].map(([key, path, label]) => (
          <button
            aria-current={tab === key ? 'page' : undefined}
            className={tab === key ? 'current' : ''}
            key={key}
            onClick={() => navigate(path)}
          >
            {key === 'orders' ? (
              <ClipboardList />
            ) : key === 'inventory' ? (
              <Package />
            ) : key === 'account' ? (
              <UserRound />
            ) : (
              <QrCode />
            )}
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </>
  );
}
function Invitation({ token }: { token: string }) {
  const [bar, setBar] = useState<PublicBar | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api<{ bar: PublicBar }>('/api/invitations/resolve', {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
      .then((d) => {
        if (active) setBar(d.bar);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [token]);
  if (error)
    return (
      <main className="content">
        <Notice>{error}</Notice>
        <p>家主に新しい招待リンクを確認してください。</p>
      </main>
    );
  if (!bar) return <Loading />;
  if (!bar.acceptingOrders)
    return (
      <main className="content">
        <h1>{bar.name}</h1>
        <Notice>ただいま注文の受付を停止しています。</Notice>
      </main>
    );
  return (
    <>
      <div className="content">
        <h2>{bar.name}へようこそ</h2>
      </div>
      <Join token={token} barId={bar.id} onJoin={() => location.replace(`/b/${bar.id}`)} />
    </>
  );
}
function GuestArea({ barId }: { barId: string }) {
  const { path, navigate: go } = useNavigation();
  const base = `/b/${barId}`;
  const navigate = (next: string) => go(base + (next === '/' ? '' : next));
  const { data, error } = usePoll<{ guest: Guest; bar: PublicBar }>(`/api/b/${barId}/session`);
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const end = () => setExpired(true);
    window.addEventListener('guest-session-expired', end);
    return () => window.removeEventListener('guest-session-expired', end);
  }, []);
  if (error || expired)
    return (
      <main className="content">
        <Notice>
          {error || '参加の有効期限が切れました。家主の招待QRから参加し直してください。'}
        </Notice>
      </main>
    );
  if (!data) return <Loading />;
  const relative = path.slice(base.length) || '/';
  const detail = relative.match(/^\/cocktails\/(\d+)$/)?.[1];
  return (
    <>
      {!data.bar.acceptingOrders && (
        <div className="content service-notice">
          <Notice>新しい注文の受付を停止しています。</Notice>
        </div>
      )}
      {detail ? (
        <CocktailDetail key={detail} id={detail} navigate={navigate} />
      ) : relative === '/orders' ? (
        <OrderList
          host={false}
          guestIdentity={{ nickname: data.guest.nickname, barName: data.bar.name }}
        />
      ) : (
        <GuestMenu navigate={navigate} barName={data.bar.name} />
      )}
      <nav className="bottom-nav" aria-label="客人メニュー">
        <button className={relative !== '/orders' ? 'current' : ''} onClick={() => navigate('/')}>
          <Martini />
          <span>メニュー</span>
        </button>
        <button
          className={relative === '/orders' ? 'current' : ''}
          onClick={() => navigate('/orders')}
        >
          <ClipboardList />
          <span>自分の注文</span>
        </button>
      </nav>
    </>
  );
}
function App() {
  const { path, navigate } = useNavigation();
  const token = path.match(/^\/join\/([a-f0-9]{48})$/)?.[1],
    barId = path.match(/^\/b\/([^/]+)/)?.[1];
  return (
    <>
      <Header
        host={path.startsWith('/host')}
        navigate={(next) => {
          if (barId && !path.startsWith('/host')) navigate(`/b/${barId}`);
          else navigate(next);
        }}
      />
      {path.startsWith('/host') ? (
        <HostArea />
      ) : token ? (
        <Invitation key={token} token={token} />
      ) : barId ? (
        <GuestArea key={barId} barId={barId} />
      ) : (
        <Landing />
      )}
    </>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
