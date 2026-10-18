(function () {
  'use strict';

  const STORAGE_KEY = 'osaka_couple_handbook_v1';
  const USER_KEY = 'osaka_couple_identity_v1';
  const SUPA_CFG_KEY = 'osaka_couple_supabase_cfg_v1';

  const SPECIAL_TIME_TOKENS = ['上午', '中午', '下午', '傍晚', '待排', '入住', '接機', '起飛'];

  // 初始狀態建立與合併
  function createInitialState() {
    const daysMap = {};
    const dayOrders = {};
    window.HANDBOOK_DATA.days.forEach((d, idx) => {
      daysMap[idx] = d.items.map((it) => ({
        id: it.id,
        time: it.time,
        title: it.title,
         baseTitle: it.title,
        note: it.note || '',
        q: it.q || it.title,
        baseQ: it.q || it.title,
        flight: !!it.flight,
        isHandbook: true,
        who: '手冊預設',
        upd: 1760000000000
      }));
      dayOrders[idx] = d.items.map((it) => it.id).join(',');
    });

    return {
      upd: Date.now(),
      fxRate: 0.215,
      fxUpdated: Date.now(),
      daysMap,
      dayOrders,
      expenses: JSON.parse(JSON.stringify(window.HANDBOOK_DATA.defaultExpenses)),
      places: window.HANDBOOK_DATA.defaultPlaces.map((p, i) => ({
        id: p.id,
        n: p.n,
        tags: p.tags.slice(),
        note: p.note,
        q: p.q,
        isHandbook: true,
        checkins: {},
        upd: 1760000000000 + i
      })),
      checklist: window.HANDBOOK_DATA.defaultChecklist.map((c) => ({
        id: c.id,
        text: c.text,
        checkedBy: {},
        upd: 1760000000000
      })),
      customLinks: {
        ticketFolderUrl: '',
        slidesUrl: '',
        upd: 1760000000000
      },
      tombstones: {}
    };
  }

  let state = loadLocalState();
  let currentUser = localStorage.getItem(USER_KEY) || '';
  let currentTab = 'tl';
  let currentDayIdx = detectInitialDayIndex();
  let fxReversed = false; // false: JPY -> TWD, true: TWD -> JPY
  let expFilterCat = '';
  let plFilterTag = '全部';
  let cardFilterCat = '全部';
  let activeZoomPhrase = null;
  let pendingActionAfterIdentity = null;

  function loadLocalState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return createInitialState();
      const parsed = JSON.parse(raw);
      const base = createInitialState();
      return Object.assign(base, parsed);
    } catch (e) {
      return createInitialState();
    }
  }

  function saveLocalState(triggerCloud = true) {
    state.upd = Date.now();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      showSyncBanner('手機儲存空間不足，請留意備份');
    }
    if (triggerCloud) {
      pushToSupabaseAsync();
    }
  }

  // 檢查是否疑似護照號、信用卡號、身分證字號或密碼（規格 3.5）
  function looksLikeSensitiveId(str) {
    if (!str) return false;
    const s = String(str).trim();
    // 信用卡 15~16 碼數字（含連字號或空白）
    if (/(?:\d[ -]*?){15,16}/.test(s)) return true;
    // 台灣身分證字號 A123456789 或護照 9 碼純數字連寫且含 passport/護照/密碼關鍵字
    if (/\b[A-Z][12]\d{8}\b/i.test(s)) return true;
    if (/(護照號碼|信用卡號|卡號|CVV|密碼|password)/i.test(s) && /\d{6,}/.test(s)) return true;
    return false;
  }

  function showSyncBanner(msg, autoHideMs = 4000) {
    const banner = document.getElementById('sync-banner');
    const txt = document.getElementById('sync-banner-text');
    if (!banner || !txt) return;
    txt.textContent = msg;
    banner.classList.add('show');
    if (autoHideMs > 0) {
      clearTimeout(window.__syncBannerTimer);
      window.__syncBannerTimer = setTimeout(() => {
        banner.classList.remove('show');
      }, autoHideMs);
    }
  }

  function detectInitialDayIndex() {
    try {
      const nowJst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
      const yyyy = nowJst.getFullYear();
      const mm = String(nowJst.getMonth() + 1).padStart(2, '0');
      const dd = String(nowJst.getDate()).padStart(2, '0');
      const todayStr = `${yyyy}-${mm}-${dd}`;
      const idx = window.HANDBOOK_DATA.days.findIndex((d) => d.fullDate === todayStr);
      return idx >= 0 ? idx : 0;
    } catch (e) {
      return 0;
    }
  }

  function requireIdentity(callback) {
    if (currentUser === '老公' || currentUser === '老婆') {
      callback();
      return true;
    }
    pendingActionAfterIdentity = callback;
    const modal = document.getElementById('identity-modal');
    if (modal) modal.classList.add('open');
    return false;
  }

  window.__APP_CORE = {
    getState: () => state,
    setState: (newState) => { state = newState; },
    saveLocalState,
    looksLikeSensitiveId,
    showSyncBanner,
    requireIdentity,
    getUser: () => currentUser,
    setUser: (u) => {
      currentUser = u;
      localStorage.setItem(USER_KEY, u);
    },
    getDayIdx: () => currentDayIdx,
    setDayIdx: (i) => { currentDayIdx = i; },
    getTab: () => currentTab,
    setTab: (t) => { currentTab = t; },
    getFxReversed: () => fxReversed,
    setFxReversed: (v) => { fxReversed = v; },
    getExpFilterCat: () => expFilterCat,
    setExpFilterCat: (c) => { expFilterCat = c; },
    getPlFilterTag: () => plFilterTag,
    setPlFilterTag: (t) => { plFilterTag = t; },
    getCardFilterCat: () => cardFilterCat,
    setCardFilterCat: (c) => { cardFilterCat = c; },
    getActiveZoomPhrase: () => activeZoomPhrase,
    setActiveZoomPhrase: (p) => { activeZoomPhrase = p; },
    consumePendingAction: () => {
      const fn = pendingActionAfterIdentity;
      pendingActionAfterIdentity = null;
      if (typeof fn === 'function') fn();
    },
    SPECIAL_TIME_TOKENS,
    SUPA_CFG_KEY
  };
})();

// ==================== Part 2: Supabase 同步、匯率、天氣與頂部狀態 ====================
(function () {
  const C = window.__APP_CORE;

  const DEFAULT_SB_URL = 'https://vkczkibsqppyrivvafjk.supabase.co';
  const DEFAULT_SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZrY3praWJzcXBweXJpdnZhZmprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxMjE0ODcsImV4cCI6MjA5OTY5NzQ4N30.Io9qB9Q4_-qtjQBNW-pGqrDYb3ZzjrRdOyMUR_E_cW8';
  const DEFAULT_ROOM_ID = 'osaka_2026_couple';

  function getSupaConfig() {
    try {
      const raw = localStorage.getItem(C.SUPA_CFG_KEY);
      if (!raw) return { url: DEFAULT_SB_URL, key: DEFAULT_SB_KEY, room: DEFAULT_ROOM_ID };
      const parsed = JSON.parse(raw);
      const safeRoom = (!parsed.room || parsed.room === 'main') ? DEFAULT_ROOM_ID : parsed.room;
      return {
        url: parsed.url || DEFAULT_SB_URL,
        key: parsed.key || DEFAULT_SB_KEY,
        room: safeRoom
      };
    } catch (e) {
      return { url: DEFAULT_SB_URL, key: DEFAULT_SB_KEY, room: DEFAULT_ROOM_ID };
    }
  }

  // 規格 3.5：每一筆共用資料只留白名單欄位，不認識的欄位丟掉
  function sanitizeStateForCloud(st) {
    const cleanDays = {};
    Object.keys(st.daysMap || {}).forEach((k) => {
      cleanDays[k] = (st.daysMap[k] || []).map((it) => ({
        id: String(it.id || ''),
        time: String(it.time || '待排'),
        title: String(it.title || ''),
        baseTitle: String(it.baseTitle || it.title || ''),
        note: String(it.note || ''),
        q: String(it.q || ''),
        baseQ: String(it.baseQ || it.q || ''),
        flight: !!it.flight,
        isHandbook: !!it.isHandbook,
        movedAway: !!it.movedAway,
        who: String(it.who || ''),
        upd: Number(it.upd || 0)
      }));
    });

    const cleanExpenses = (st.expenses || []).map((ex) => ({
      id: String(ex.id || ''),
      title: String(ex.title || ''),
      amount: Number(ex.amount || 0),
      currency: ex.currency === 'JPY' ? 'JPY' : 'TWD',
      category: String(ex.category || '其他'),
      payer: ex.payer === '老婆' ? '老婆' : '老公',
      split: Array.isArray(ex.split) ? ex.split.filter((m) => m === '老公' || m === '老婆') : ['老公', '老婆'],
      who: String(ex.who || ''),
      upd: Number(ex.upd || 0),
      note: String(ex.note || '')
    }));

    const cleanPlaces = (st.places || []).map((pl) => ({
      id: String(pl.id || ''),
      n: String(pl.n || ''),
      tags: Array.isArray(pl.tags) ? pl.tags.map(String) : [],
      note: String(pl.note || ''),
      q: String(pl.q || ''),
      isHandbook: !!pl.isHandbook,
      who: pl.who ? String(pl.who) : undefined,
      checkins: pl.checkins || {},
      upd: Number(pl.upd || 0)
    }));

    return {
      upd: Number(st.upd || Date.now()),
      fxRate: Number(st.fxRate || 0.215),
      fxUpdated: Number(st.fxUpdated || 0),
      daysMap: cleanDays,
      dayOrders: st.dayOrders || {},
      expenses: cleanExpenses,
      places: cleanPlaces,
      checklist: st.checklist || [],
      customLinks: st.customLinks || { ticketFolderUrl: '', slidesUrl: '', upd: 0 },
      tombstones: st.tombstones || {}
    };
  }

  function mergeStates(local, remote) {
    if (!remote || typeof remote !== 'object') return local;
    const tombs = Object.assign({}, local.tombstones || {}, remote.tombstones || {});

    // 若遠端整體時間較新，對各清單依 id 與 upd 合併並套用墓碑
    const merged = JSON.parse(JSON.stringify((remote.upd || 0) > (local.upd || 0) ? remote : local));
    merged.tombstones = tombs;

    if ((remote.fxUpdated || 0) > (local.fxUpdated || 0) && remote.fxRate > 0) {
      merged.fxRate = remote.fxRate;
      merged.fxUpdated = remote.fxUpdated;
    }

    // 合併帳目
    const expMap = new Map();
    [...(local.expenses || []), ...(remote.expenses || [])].forEach((ex) => {
      if (tombs[ex.id] && tombs[ex.id] >= (ex.upd || 0)) return;
      const prev = expMap.get(ex.id);
      if (!prev || (ex.upd || 0) >= (prev.upd || 0)) expMap.set(ex.id, ex);
    });
    merged.expenses = Array.from(expMap.values());

    // 合併店家與打卡
    const plMap = new Map();
    [...(local.places || []), ...(remote.places || [])].forEach((pl) => {
      if (tombs[pl.id] && tombs[pl.id] >= (pl.upd || 0)) return;
      const prev = plMap.get(pl.id);
      if (!prev) {
        plMap.set(pl.id, pl);
      } else {
        const newer = (pl.upd || 0) >= (prev.upd || 0) ? pl : prev;
        const older = newer === pl ? prev : pl;
        newer.checkins = Object.assign({}, older.checkins || {}, newer.checkins || {});
        plMap.set(pl.id, newer);
      }
    });
    merged.places = Array.from(plMap.values());

    return merged;
  }

  window.pushToSupabaseAsync = async function () {
    const cfg = getSupaConfig();
    if (!cfg.url || !cfg.key) return;
    // 絕對安全保護：禁止寫入越南專案的 main
    const safeRoom = (!cfg.room || cfg.room === 'main') ? DEFAULT_ROOM_ID : cfg.room;
    const cleanPayload = sanitizeStateForCloud(C.getState());
    const endpoint = `${cfg.url.replace(/\/$/, '')}/rest/v1/trip_store?on_conflict=id`;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'apikey': cfg.key,
          'Authorization': `Bearer ${cfg.key}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify([{
          id: safeRoom,
          data: cleanPayload
        }])
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
    } catch (err) {
      C.showSyncBanner('雲端暫時無法連線，已安全保存在這支手機');
    }
  };

  window.pullFromSupabaseAsync = async function (isDiagnosticOnly = false) {
    const cfg = getSupaConfig();
    if (!cfg.url || !cfg.key) {
      return { ok: false, msg: '尚未設定 Supabase 網址與金鑰（目前為本機獨立儲存模式）' };
    }
    const safeRoom = (!cfg.room || cfg.room === 'main') ? DEFAULT_ROOM_ID : cfg.room;
    const roomParam = encodeURIComponent(safeRoom);
    const endpoint = `${cfg.url.replace(/\/$/, '')}/rest/v1/trip_store?id=eq.${roomParam}&select=id,data`;
    try {
      const res = await fetch(endpoint, {
        method: 'GET',
        headers: {
          'apikey': cfg.key,
          'Authorization': `Bearer ${cfg.key}`
        },
        cache: 'no-store'
      });
      if (!res.ok) return { ok: false, msg: `雲端回應狀態碼 ${res.status}` };
      const rows = await res.json();
      if (isDiagnosticOnly) {
        if (!rows || rows.length === 0) {
          return { ok: true, msg: `唯讀診斷成功：Supabase (trip_store / id="${safeRoom}") 連線正常！雲端尚無大阪初始紀錄，未寫入任何資料，且與越南專案 (id="main") 100% 獨立隔離。` };
        }
        const updTime = rows[0].data && rows[0].data.upd ? new Date(rows[0].data.upd).toLocaleString('zh-TW') : '已同步';
        return { ok: true, msg: `唯讀診斷成功：Supabase (trip_store / id="${safeRoom}") 連線正常！最後更新：${updTime}` };
      }
      if (rows && rows.length > 0 && rows[0].data && Object.keys(rows[0].data).length > 0) {
        const merged = mergeStates(C.getState(), rows[0].data);
        C.setState(merged);
        C.saveLocalState(false);
        if (window.renderAll) window.renderAll();
      }
      return { ok: true, msg: '已與雲端同步最新資料' };
    } catch (err) {
      return { ok: false, msg: '網路或雲端連線失敗，本機資料完好無損' };
    }
  };

  // 3.1 頂部眉題與副標（依日本時間計算倒數）
  window.renderHeaderAndIdentity = function () {
    const eyebrowEl = document.getElementById('header-eyebrow');
    const subEl = document.getElementById('header-subtitle');
    const userLabel = document.getElementById('current-user-label');
    const moreUserLabel = document.getElementById('more-current-user');

    const u = C.getUser();
    if (userLabel) userLabel.textContent = u || '點此選身份';
    if (moreUserLabel) moreUserLabel.textContent = u || '尚未選擇';

    const nowJst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
    const todayMidnight = new Date(nowJst.getFullYear(), nowJst.getMonth(), nowJst.getDate());
    const startMidnight = new Date(2026, 9, 22); // 10/22
    const endMidnight = new Date(2026, 9, 25);   // 10/25
    const diffDays = Math.round((startMidnight - todayMidnight) / 86400000);

    if (diffDays > 0) {
      eyebrowEl.textContent = `JAPAN · OSAKA · D-${diffDays}`;
      subEl.textContent = diffDays <= 7
        ? `再過 ${diffDays} 天就要跟老婆出發去大阪、環球影城與海之京都囉！`
        : `距離老公與老婆的大阪・天橋立・伊根秋日旅行還有 ${diffDays} 天`;
    } else if (todayMidnight >= startMidnight && todayMidnight <= endMidnight) {
      const dayNum = Math.round((todayMidnight - startMidnight) / 86400000) + 1;
      eyebrowEl.textContent = `JAPAN · OSAKA · DAY ${dayNum}`;
      const daySubtitles = [
        'Day 1：順利抵達關西！放好行李去心齋橋逛街、晚上吃和牛燒肉',
        'Day 2：日本環球影城一整天！瑪利歐、哈利波特與萬聖節之夜',
        'Day 3：早起出發海之京都！丹後海上列車、天橋立與伊根舟屋餵海鷗',
        'Day 4：中崎町老屋咖啡與梅田採買伴手禮，晚上平安飛回台灣'
      ];
      subEl.textContent = daySubtitles[dayNum - 1] || daySubtitles[0];
    } else {
      eyebrowEl.textContent = 'OSAKA · AUTUMN 2026';
      subEl.textContent = '那年秋天，我們一起走過道頓堀霓虹與伊根灣的海鷗';
    }
  };
})();

// ==================== Part 3: 天氣、匯率條與 M1 時間表渲染 ====================
(function () {
  const C = window.__APP_CORE;

  // 天氣抓取（Open-Meteo 公開預報，抓不到時提供外部搜尋連結，絕不編造假數字）
  window.fetchAndRenderWeather = async function () {
    const box = document.getElementById('weather-content');
    if (!box) return;
    box.innerHTML = '<div style="font-size:12px;color:var(--sub);">正在查詢日本氣象資料...</div>';

    const fallbackHtml = `
      <div style="font-size:12px;color:var(--sub);margin-bottom:8px;">
        目前無法直接讀取此日期區間的即時預報數值（或處於離線狀態）。請點選下方日本官方氣象連結查詢最新預報：
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;">
        <a href="https://tenki.jp/forecast/6/30/6200/27100/" target="_blank" rel="noopener" class="fx-pill" style="text-decoration:none;color:var(--accent);font-weight:700;">↗ 日本氣象協會：大阪市 10日預報</a>
        <a href="https://tenki.jp/forecast/6/29/6120/26405/" target="_blank" rel="noopener" class="fx-pill" style="text-decoration:none;color:var(--accent);font-weight:700;">↗ 日本氣象協會：天橋立・伊根町預報</a>
      </div>
    `;

    try {
      const url = 'https://api.open-meteo.com/v1/forecast?latitude=34.6937,35.56&longitude=135.5023,135.19&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FTokyo&start_date=2026-10-22&end_date=2026-10-25';
      const res = await fetch(url);
      if (!res.ok) {
        box.innerHTML = fallbackHtml;
        return;
      }
      const data = await res.json();
      const osaka = Array.isArray(data) ? data[0] : data;
      const kyotoNorth = Array.isArray(data) && data[1] ? data[1] : osaka;
      if (!osaka || !osaka.daily || !osaka.daily.time || osaka.daily.time.length === 0) {
        box.innerHTML = fallbackHtml;
        return;
      }

      const dayLabels = [
        { date: '10/22 (四)', loc: '大阪難波・心齋橋', src: osaka, i: 0 },
        { date: '10/23 (五)', loc: '日本環球影城 USJ', src: osaka, i: 1 },
        { date: '10/24 (六)', loc: '天橋立・伊根舟屋', src: kyotoNorth, i: 2 },
        { date: '10/25 (日)', loc: '中崎町・梅田', src: osaka, i: 3 }
      ];

      let cardsHtml = '<div class="weather-grid">';
      let hasValidNumber = false;
      dayLabels.forEach((d) => {
        const tMax = d.src.daily.temperature_2m_max ? d.src.daily.temperature_2m_max[d.i] : null;
        const tMin = d.src.daily.temperature_2m_min ? d.src.daily.temperature_2m_min[d.i] : null;
        const pop = d.src.daily.precipitation_probability_max ? d.src.daily.precipitation_probability_max[d.i] : null;
        if (tMax !== null && tMax !== undefined && !isNaN(tMax)) hasValidNumber = true;
        const tempText = (tMax !== null && tMin !== null && !isNaN(tMax))
          ? `${Math.round(tMin)}°C – ${Math.round(tMax)}°C`
          : '待氣象局更新';
        const popText = (pop !== null && pop !== undefined && !isNaN(pop))
          ? `降雨機率 ${pop}%`
          : '點下方看即時預報';
        cardsHtml += `
          <div class="weather-day-card">
            <div class="weather-day-title">${d.date} · ${d.loc}</div>
            <div class="weather-day-meta">🌡 ${tempText} ｜ ☂ ${popText}</div>
          </div>
        `;
      });
      cardsHtml += '</div>';

      if (!hasValidNumber) {
        box.innerHTML = fallbackHtml;
        return;
      }
      box.innerHTML = cardsHtml + `
        <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
          <a href="https://tenki.jp/forecast/6/30/6200/27100/" target="_blank" rel="noopener" style="font-size:11.5px;color:var(--accent);">↗ tenki.jp 大阪天氣</a>
          <a href="https://tenki.jp/forecast/6/29/6120/26405/" target="_blank" rel="noopener" style="font-size:11.5px;color:var(--accent);">↗ tenki.jp 天橋立/伊根天氣</a>
        </div>
      `;
    } catch (e) {
      box.innerHTML = fallbackHtml;
    }
  };

  // 3.2 匯率雙來源驗證與換算
  window.refreshExchangeRate = async function (showToast = false) {
    const st = C.getState();
    let r1 = null;
    let r2 = null;
    try {
      const res1 = await fetch('https://open.er-api.com/v6/latest/JPY');
      if (res1.ok) {
        const j1 = await res1.json();
        if (j1 && j1.rates && j1.rates.TWD) r1 = Number(j1.rates.TWD);
      }
    } catch (e) {}

    try {
      const res2 = await fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/jpy.json');
      if (res2.ok) {
        const j2 = await res2.json();
        if (j2 && j2.jpy && j2.jpy.twd) r2 = Number(j2.jpy.twd);
      }
    } catch (e) {}

    if (r1 && r2) {
      const diffRatio = Math.abs(r1 - r2) / ((r1 + r2) / 2);
      if (diffRatio <= 0.05 && r1 > 0.1 && r1 < 0.5) {
        st.fxRate = Number(((r1 + r2) / 2).toFixed(4));
        st.fxUpdated = Date.now();
        C.saveLocalState(true);
        if (showToast) C.showSyncBanner(`已更新雙來源驗證匯率：1 日圓 ≈ ${st.fxRate} 台幣`);
      } else if (showToast) {
        C.showSyncBanner('兩組公開匯率差距過大，沿用上次驗證匯率');
      }
    } else if ((r1 || r2) && (r1 || r2) > 0.1 && (r1 || r2) < 0.5) {
      st.fxRate = Number((r1 || r2).toFixed(4));
      st.fxUpdated = Date.now();
      C.saveLocalState(true);
      if (showToast) C.showSyncBanner(`匯率已更新：1 日圓 ≈ ${st.fxRate} 台幣`);
    } else if (showToast) {
      C.showSyncBanner(`目前離線，沿用上次匯率：1 日圓 ≈ ${st.fxRate} 台幣`);
    }
    window.renderFxBar();
    if (window.renderExpenses) window.renderExpenses();
  };

  window.renderFxBar = function () {
    const st = C.getState();
    const rate = Number(st.fxRate || 0.215);
    const rev = C.getFxReversed();
    const leftLabel = document.getElementById('fx-left-label');
    const rightLabel = document.getElementById('fx-right-label');
    const leftIn = document.getElementById('fx-left-input');
    const rightIn = document.getElementById('fx-right-input');
    const pillsBox = document.getElementById('fx-quick-pills');
    const infoEl = document.getElementById('fx-rate-info');

    if (!leftIn || !rightIn) return;
    leftLabel.textContent = rev ? '台幣 $' : '日圓 ¥';
    rightLabel.textContent = rev ? '日圓 ¥' : '台幣 $';
    infoEl.textContent = `1 日圓 ≈ ${rate.toFixed(4)} 台幣`;

    const val = parseFloat(leftIn.value) || 0;
    if (!rev) {
      rightIn.value = Math.round(val * rate);
    } else {
      rightIn.value = rate > 0 ? Math.round(val / rate) : 0;
    }

    const quickNums = rev ? [300, 1000, 3000, 5000] : [1000, 3000, 5000, 10000];
    pillsBox.innerHTML = quickNums.map((n) => {
      const sym = rev ? '$' : '¥';
      return `<button type="button" class="fx-pill" data-fx-val="${n}">${sym}${n.toLocaleString()}</button>`;
    }).join('');

    pillsBox.querySelectorAll('[data-fx-val]').forEach((btn) => {
      btn.addEventListener('click', () => {
        leftIn.value = btn.getAttribute('data-fx-val');
        window.renderFxBar();
      });
    });
  };
})();

// ==================== Part 4a: M1 時間表渲染、排序與上下尖角搬移 ====================
(function () {
  const C = window.__APP_CORE;

  function parseClockMinutes(timeStr) {
    if (!timeStr) return null;
    const m = String(timeStr).match(/^(\d{1,2}):(\d{2})(?:[–-](\d{1,2}):(\d{2}))?$/);
    if (!m) return null;
    const start = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    const end = m[3] !== undefined ? parseInt(m[3], 10) * 60 + parseInt(m[4], 10) : start;
    return { start, end: end < start ? end + 1440 : end };
  }

  function hasClockConflict(timeStr, targetItems) {
    const rng = parseClockMinutes(timeStr);
    if (!rng) return false;
    return targetItems.some((it) => {
      if (it.movedAway) return false;
      const other = parseClockMinutes(it.time);
      if (!other) return false;
      if (rng.start === other.start) return true;
      return Math.max(rng.start, other.start) < Math.min(rng.end, other.end);
    });
  }

  function getOrderedDayItems(dayIdx) {
    const st = C.getState();
    const rawList = (st.daysMap[dayIdx] || []).filter((it) => !it.movedAway);
    const orderStr = st.dayOrders && st.dayOrders[dayIdx];
    if (orderStr) {
      const orderIds = orderStr.split(',').filter(Boolean);
      const mapById = new Map(rawList.map((it) => [it.id, it]));
      const ordered = [];
      orderIds.forEach((id) => {
        if (mapById.has(id)) {
          ordered.push(mapById.get(id));
          mapById.delete(id);
        }
      });
      mapById.forEach((it) => ordered.push(it));
      return ordered;
    }
    return rawList;
  }

  function saveDayOrder(dayIdx, items) {
    const st = C.getState();
    if (!st.dayOrders) st.dayOrders = {};
    st.dayOrders[dayIdx] = items.map((it) => it.id).join(',');
  }

  // 規格 M1 地圖規則：
  // 1. 航班的釘開機場（関西国際空港）
  // 2. 手冊原有的若沒改名稱，釘用原地址 baseQ；改了名稱則搜新名稱
  // 3. 自己新加的事項，釘用卡片上的名稱
  function getMapUrlForItem(item) {
    let query = item.title;
    if (item.flight) {
      query = '関西国際空港 Kansai International Airport';
    } else if (item.isHandbook) {
      if (item.title === (item.baseTitle || item.title)) {
        query = item.baseQ || item.q || item.title;
      } else {
        query = item.title;
      }
    }
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  }

  function showTlStatus(text) {
    const bar = document.getElementById('tl-status-bar');
    if (!bar) return;
    bar.textContent = text;
    bar.classList.add('show');
    clearTimeout(window.__tlStatusTimer);
    window.__tlStatusTimer = setTimeout(() => {
      bar.classList.remove('show');
    }, 5000);
  }

  // 跨天搬移規則（規格 M1：手冊原有那一筆原處隱藏並註記移走，目的地新增一筆一樣的內容；時鐘衝突則改成待排）
  function moveItemToAnotherDay(itemId, fromDayIdx, toDayIdx, insertAtTop) {
    const st = C.getState();
    const sourceArr = st.daysMap[fromDayIdx] || [];
    const targetArr = st.daysMap[toDayIdx] || [];
    const item = sourceArr.find((x) => x.id === itemId && !x.movedAway);
    if (!item) return;

    const visibleTarget = getOrderedDayItems(toDayIdx);
    const conflict = hasClockConflict(item.time, visibleTarget);
    const newTime = conflict ? '待排' : item.time;

    let destItem;
    if (item.isHandbook) {
      item.movedAway = true;
      item.upd = Date.now();
      destItem = {
        id: `${item.id}-mv-${Date.now().toString(36)}`,
        time: newTime,
        title: item.title,
        baseTitle: item.baseTitle || item.title,
        note: item.note,
        q: item.q,
        baseQ: item.baseQ || item.q,
        flight: !!item.flight,
        isHandbook: true,
        who: C.getUser() || item.who,
        upd: Date.now()
      };
    } else {
      const idx = sourceArr.indexOf(item);
      if (idx >= 0) sourceArr.splice(idx, 1);
      item.time = newTime;
      item.upd = Date.now();
      destItem = item;
    }

    targetArr.push(destItem);
    st.daysMap[toDayIdx] = targetArr;

    const remainingSource = getOrderedDayItems(fromDayIdx).filter((x) => x.id !== itemId);
    saveDayOrder(fromDayIdx, remainingSource);

    const newTargetOrder = visibleTarget.slice();
    if (insertAtTop) newTargetOrder.unshift(destItem);
    else newTargetOrder.push(destItem);
    saveDayOrder(toDayIdx, newTargetOrder);

    C.setDayIdx(toDayIdx);
    C.saveLocalState(true);
    window.renderTimeline();

    const dayNum = toDayIdx + 1;
    if (conflict) {
      showTlStatus(`「${destItem.title}」放到第 ${dayNum} 天，時間標成 待排`);
    } else {
      showTlStatus(`「${destItem.title}」已移到第 ${dayNum} 天`);
    }
  }

  function moveItemStep(itemId, direction) {
    const dayIdx = C.getDayIdx();
    const ordered = getOrderedDayItems(dayIdx);
    const pos = ordered.findIndex((x) => x.id === itemId);
    if (pos < 0) return;
    const item = ordered[pos];

    if (direction === -1) {
      if (pos > 0) {
        const temp = ordered[pos - 1];
        ordered[pos - 1] = ordered[pos];
        ordered[pos] = temp;
        saveDayOrder(dayIdx, ordered);
        C.saveLocalState(true);
        window.renderTimeline();
        showTlStatus(`「${item.title}」已往上移一格`);
      } else if (dayIdx > 0) {
        moveItemToAnotherDay(itemId, dayIdx, dayIdx - 1, false);
      }
    } else if (direction === 1) {
      if (pos < ordered.length - 1) {
        const temp = ordered[pos + 1];
        ordered[pos + 1] = ordered[pos];
        ordered[pos] = temp;
        saveDayOrder(dayIdx, ordered);
        C.saveLocalState(true);
        window.renderTimeline();
        showTlStatus(`「${item.title}」已往下移一格`);
      } else if (dayIdx < window.HANDBOOK_DATA.days.length - 1) {
        moveItemToAnotherDay(itemId, dayIdx, dayIdx + 1, true);
      }
    }
  }

  window.__TL_HELPERS = {
    getOrderedDayItems,
    saveDayOrder,
    getMapUrlForItem,
    showTlStatus,
    moveItemToAnotherDay,
    moveItemStep
  };
})();

// ==================== Part 4b: M1 卡片渲染、六點拖曳把手與編輯表單 ====================
(function () {
  const C = window.__APP_CORE;
  const H = window.__TL_HELPERS;

  let activeTimeToken = '';
  let hasEndTime = false;
  let deleteConfirmStage = false;
  let overwriteOtherConfirmStage = false;
  let kbGrabbedId = null;
  let kbOriginalOrder = null;

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  window.__escapeHtml = escapeHtml;

  window.renderTimeline = function () {
    const dayIdx = C.getDayIdx();
    const daysMeta = window.HANDBOOK_DATA.days;

    // 1. Day Tabs
    const tabsEl = document.getElementById('day-tabs');
    if (tabsEl) {
      tabsEl.innerHTML = daysMeta.map((d, i) => `
        <button type="button" class="day-tab ${i === dayIdx ? 'active' : ''}" data-day-idx="${i}" role="tab" aria-selected="${i === dayIdx}">
          <span class="day-tab-top">${d.label}</span>
          <span class="day-tab-sub">${d.dateStr}</span>
        </button>
      `).join('');
      tabsEl.querySelectorAll('.day-tab').forEach((btn) => {
        btn.addEventListener('click', () => {
          C.setDayIdx(Number(btn.getAttribute('data-day-idx')));
          window.renderTimeline();
        });
      });
    }

    // 2. 卡片列表
    const listEl = document.getElementById('tl-list');
    const items = H.getOrderedDayItems(dayIdx);
    if (listEl) {
      if (items.length === 0) {
        listEl.innerHTML = '<div class="card" style="color:var(--sub);text-align:center;">這格還沒填（可點上方新增或恢復預設行程）</div>';
      } else {
        listEl.innerHTML = items.map((it, pos) => {
          const isFirstOfFirstDay = dayIdx === 0 && pos === 0;
          const isLastOfLastDay = dayIdx === daysMeta.length - 1 && pos === items.length - 1;
          const mapUrl = H.getMapUrlForItem(it);
          return `
            <div class="tl-card ${it.flight ? 'is-flight' : ''}" data-item-id="${it.id}">
              <div class="tl-card-main">
                <div class="tl-time-row">
                  <span class="tl-time">${escapeHtml(it.time)}</span>
                  ${it.flight ? '<span class="tl-flight-badge">航班</span>' : ''}
                </div>
                <div class="tl-title">${escapeHtml(it.title)}</div>
                ${it.note ? `<div class="tl-note">${escapeHtml(it.note)}</div>` : ''}
              </div>
              <div class="tl-actions">
                <div class="tl-icon-col">
                  <button type="button" class="tl-icon-btn tl-edit-btn" data-id="${it.id}" title="編輯行程" aria-label="編輯行程">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                  </button>
                  <a href="${mapUrl}" target="_blank" rel="noopener" class="tl-icon-btn" title="在 Google 地圖開啟" aria-label="開啟地圖">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                  </a>
                </div>
                <div class="tl-icon-col">
                  <button type="button" class="tl-icon-btn tl-up-btn" data-id="${it.id}" ${isFirstOfFirstDay ? 'disabled' : ''} title="往上移" aria-label="往上移">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="18 15 12 9 6 15"/></svg>
                  </button>
                  <button type="button" class="tl-icon-btn tl-down-btn" data-id="${it.id}" ${isLastOfLastDay ? 'disabled' : ''} title="往下移" aria-label="往下移">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="6 9 12 15 18 9"/></svg>
                  </button>
                </div>
                <div class="tl-drag-handle" tabindex="0" role="button" aria-label="按住六點拖曳排序" data-id="${it.id}">
                  <svg width="14" height="16" viewBox="0 0 14 16" fill="currentColor">
                    <circle cx="4" cy="3" r="1.4"/><circle cx="10" cy="3" r="1.4"/>
                    <circle cx="4" cy="8" r="1.4"/><circle cx="10" cy="8" r="1.4"/>
                    <circle cx="4" cy="13" r="1.4"/><circle cx="10" cy="13" r="1.4"/>
                  </svg>
                </div>
              </div>
            </div>
          `;
        }).join('');

        // 綁定卡片按鈕事件
        listEl.querySelectorAll('.tl-edit-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-id');
            C.requireIdentity(() => openTlFormForEdit(id));
          });
        });
        listEl.querySelectorAll('.tl-up-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-id');
            C.requireIdentity(() => H.moveItemStep(id, -1));
          });
        });
        listEl.querySelectorAll('.tl-down-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-id');
            C.requireIdentity(() => H.moveItemStep(id, 1));
          });
        });
        listEl.querySelectorAll('.tl-drag-handle').forEach((handle) => {
          bindDragHandle(handle);
        });
      }
    }

    // 3. 手繪地圖路線透明度切換（選中那天 opacity=1，其他天 opacity=0.1）
    const dMeta = daysMeta[dayIdx] || daysMeta[0];
    for (let i = 0; i < daysMeta.length; i++) {
      const layer = document.getElementById(`map-route-${i}`);
      if (layer) layer.setAttribute('opacity', i === dayIdx ? '1' : '0.1');
    }
    const sumLine = document.getElementById('route-summary-line');
    const jpLine = document.getElementById('route-jp-line');
    if (sumLine) sumLine.textContent = dMeta.routeSummary || '路線還沒畫';
    if (jpLine) jpLine.textContent = `地名對照：${dMeta.routeJpMap || '這格還沒填'}`;
  };

  // 六個點把手拖曳邏輯（手指移動 > 6px 才算拖；鎖住列表高度避免「當日路線」跳上來）
  function bindDragHandle(handle) {
    const itemId = handle.getAttribute('data-id');

    handle.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!C.requireIdentity(() => {})) return;
        const dayIdx = C.getDayIdx();
        if (kbGrabbedId === itemId) {
          kbGrabbedId = null;
          kbOriginalOrder = null;
          H.showTlStatus('已完成鍵盤排序');
        } else {
          kbGrabbedId = itemId;
          kbOriginalOrder = H.getOrderedDayItems(dayIdx).map((x) => x.id).join(',');
          H.showTlStatus('已抓住此行程：方向鍵上下移動，Enter 放下，Esc 取消');
        }
      } else if (kbGrabbedId === itemId && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        H.moveItemStep(itemId, e.key === 'ArrowUp' ? -1 : 1);
        setTimeout(() => {
          const newHandle = document.querySelector(`.tl-drag-handle[data-id="${itemId}"]`);
          if (newHandle) newHandle.focus();
        }, 20);
      } else if (kbGrabbedId === itemId && e.key === 'Escape') {
        e.preventDefault();
        const dayIdx = C.getDayIdx();
        if (kbOriginalOrder !== null) {
          C.getState().dayOrders[dayIdx] = kbOriginalOrder;
          C.saveLocalState(true);
          window.renderTimeline();
        }
        kbGrabbedId = null;
        kbOriginalOrder = null;
        H.showTlStatus('已取消這次順序調整');
      }
    });

    handle.addEventListener('pointerdown', (e) => {
      if (e.button && e.button !== 0) return;
      if (!C.getUser()) {
        C.requireIdentity(() => {});
        return;
      }
      const card = handle.closest('.tl-card');
      const listEl = document.getElementById('tl-list');
      if (!card || !listEl) return;

      const startX = e.clientX;
      const startY = e.clientY;
      const rect = card.getBoundingClientRect();
      const offsetY = startY - rect.top;
      let dragging = false;
      let ghost = null;
      let hoveredDayTabIdx = null;

      function onMove(ev) {
        const dy = ev.clientY - startY;
        const dx = ev.clientX - startX;
        if (!dragging && Math.hypot(dx, dy) > 6) {
          dragging = true;
          // 鎖定列表最小高度，防止下方「當日路線」標題跳上來
          listEl.style.minHeight = `${listEl.offsetHeight}px`;
          card.classList.add('drag-placeholder');

          ghost = card.cloneNode(true);
          ghost.classList.remove('drag-placeholder');
          ghost.classList.add('tl-card-ghost');
          ghost.style.width = `${rect.width}px`;
          ghost.style.left = `${rect.left}px`;
          ghost.style.top = `${rect.top}px`;
          document.body.appendChild(ghost);
        }

        if (!dragging || !ghost) return;
        ev.preventDefault();

        // 限制幽靈卡片不遮蓋頂部日期列
        const tabsRect = document.getElementById('day-tabs').getBoundingClientRect();
        const minTop = tabsRect.bottom + 2;
        const newTop = Math.max(minTop, ev.clientY - offsetY);
        ghost.style.top = `${newTop}px`;

        // 檢查是否指到上方日期列（跨天投放目標）
        hoveredDayTabIdx = null;
        document.querySelectorAll('.day-tab').forEach((tab) => {
          const r = tab.getBoundingClientRect();
          if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom + 14) {
            tab.classList.add('drag-over');
            hoveredDayTabIdx = Number(tab.getAttribute('data-day-idx'));
          } else {
            tab.classList.remove('drag-over');
          }
        });

        if (hoveredDayTabIdx !== null) return;

        // 同日內交換順序
        const siblings = Array.from(listEl.querySelectorAll('.tl-card'));
        siblings.forEach((sib) => {
          if (sib === card) return;
          const sRect = sib.getBoundingClientRect();
          const midY = sRect.top + sRect.height / 2;
          if (ev.clientY < midY && card.compareDocumentPosition(sib) & Node.DOCUMENT_POSITION_PRECEDING) {
            listEl.insertBefore(card, sib);
          } else if (ev.clientY > midY && card.compareDocumentPosition(sib) & Node.DOCUMENT_POSITION_FOLLOWING) {
            listEl.insertBefore(card, sib.nextSibling);
          }
        });
      }

      function onUp() {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        document.querySelectorAll('.day-tab').forEach((t) => t.classList.remove('drag-over'));

        if (!dragging) return;
        if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
        card.classList.remove('drag-placeholder');
        listEl.style.minHeight = '';

        const fromDayIdx = C.getDayIdx();
        if (hoveredDayTabIdx !== null && hoveredDayTabIdx !== fromDayIdx) {
          H.moveItemToAnotherDay(itemId, fromDayIdx, hoveredDayTabIdx, false);
        } else {
          const newOrderIds = Array.from(listEl.querySelectorAll('.tl-card')).map((el) => el.getAttribute('data-item-id'));
          C.getState().dayOrders[fromDayIdx] = newOrderIds.join(',');
          C.saveLocalState(true);
          window.renderTimeline();
          H.showTlStatus('已更新本日行程順序（時間保持原樣）');
        }
      }

      window.addEventListener('pointermove', onMove, { passive: false });
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });
  }

  window.__TL_FORM_STATE = {
    getActiveToken: () => activeTimeToken,
    setActiveToken: (t) => { activeTimeToken = t; },
    getHasEndTime: () => hasEndTime,
    setHasEndTime: (b) => { hasEndTime = b; },
    getDeleteConfirm: () => deleteConfirmStage,
    setDeleteConfirm: (b) => { deleteConfirmStage = b; },
    getOverwriteConfirm: () => overwriteOtherConfirmStage,
    setOverwriteConfirm: (b) => { overwriteOtherConfirmStage = b; }
  };
})();

// ==================== Part 4c: M1 時間表表單（滾輪選單、新增、修改、兩段刪除、恢復原行程） ====================
(function () {
  const C = window.__APP_CORE;
  const H = window.__TL_HELPERS;
  const FS = window.__TL_FORM_STATE;

  function populateTimeWheels() {
    const sh = document.getElementById('tl-start-hour');
    const sm = document.getElementById('tl-start-min');
    const eh = document.getElementById('tl-end-hour');
    const em = document.getElementById('tl-end-min');
    if (!sh || !sm || !eh || !em) return;

    let hHtml = '';
    for (let h = 0; h < 24; h++) {
      const hh = String(h).padStart(2, '0');
      hHtml += `<option value="${hh}">${hh} 時</option>`;
    }
    sh.innerHTML = hHtml;
    eh.innerHTML = hHtml;

    let mHtml = '';
    for (let m = 0; m < 60; m += 5) {
      const mm = String(m).padStart(2, '0');
      mHtml += `<option value="${mm}">${mm} 分</option>`;
    }
    // 額外保留 28、44 等特殊列車分鐘數
    ['28', '44'].forEach((extra) => {
      mHtml += `<option value="${extra}">${extra} 分</option>`;
    });
    sm.innerHTML = mHtml;
    em.innerHTML = mHtml;

    const pillsBox = document.getElementById('tl-token-pills');
    if (pillsBox) {
      const allTokens = ['時鐘', ...C.SPECIAL_TIME_TOKENS];
      pillsBox.innerHTML = allTokens.map((tok) => `
        <button type="button" class="token-pill ${tok === '時鐘' ? 'active' : ''}" data-tok="${tok}">${tok}</button>
      `).join('');
      pillsBox.querySelectorAll('.token-pill').forEach((btn) => {
        btn.addEventListener('click', () => {
          const tok = btn.getAttribute('data-tok');
          FS.setActiveToken(tok === '時鐘' ? '' : tok);
          syncTimeFormUI();
        });
      });
    }
  }

  function syncTimeFormUI() {
    const tok = FS.getActiveToken();
    const hasEnd = FS.getHasEndTime();
    const wheelArea = document.getElementById('tl-wheel-area');
    const endWrap = document.getElementById('tl-end-wheel-wrap');
    const toggleEndBtn = document.getElementById('tl-toggle-end-btn');
    const preview = document.getElementById('tl-token-preview');

    document.querySelectorAll('#tl-token-pills .token-pill').forEach((b) => {
      const bTok = b.getAttribute('data-tok');
      b.classList.toggle('active', (tok === '' && bTok === '時鐘') || bTok === tok);
    });

    if (tok) {
      wheelArea.style.display = 'none';
      preview.textContent = `將儲存為：「${tok}」`;
    } else {
      wheelArea.style.display = 'block';
      endWrap.style.display = hasEnd ? 'flex' : 'none';
      toggleEndBtn.textContent = hasEnd ? '拿掉結束時間' : '＋ 加結束時間';
      preview.textContent = '';
    }
  }

  function setFormTimeValue(timeStr) {
    const s = String(timeStr || '').trim();
    if (C.SPECIAL_TIME_TOKENS.includes(s)) {
      FS.setActiveToken(s);
      FS.setHasEndTime(false);
      syncTimeFormUI();
      return;
    }
    const m = s.match(/^(\d{1,2}):(\d{2})(?:[–-](\d{1,2}):(\d{2}))?$/);
    if (m) {
      FS.setActiveToken('');
      document.getElementById('tl-start-hour').value = String(m[1]).padStart(2, '0');
      ensureMinuteOption('tl-start-min', String(m[2]).padStart(2, '0'));
      if (m[3] !== undefined && m[4] !== undefined) {
        FS.setHasEndTime(true);
        document.getElementById('tl-end-hour').value = String(m[3]).padStart(2, '0');
        ensureMinuteOption('tl-end-min', String(m[4]).padStart(2, '0'));
      } else {
        FS.setHasEndTime(false);
      }
      syncTimeFormUI();
      return;
    }
    // 其他特殊文字原樣保留
    FS.setActiveToken(s || '待排');
    FS.setHasEndTime(false);
    syncTimeFormUI();
  }

  function ensureMinuteOption(selectId, mm) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    if (!Array.from(sel.options).some((o) => o.value === mm)) {
      const opt = document.createElement('option');
      opt.value = mm;
      opt.textContent = `${mm} 分`;
      sel.appendChild(opt);
    }
    sel.value = mm;
  }

  function readFormTimeString() {
    const tok = FS.getActiveToken();
    if (tok) return tok;
    const sh = document.getElementById('tl-start-hour').value || '09';
    const sm = document.getElementById('tl-start-min').value || '00';
    if (!FS.getHasEndTime()) return `${sh}:${sm}`;
    const eh = document.getElementById('tl-end-hour').value || '10';
    const em = document.getElementById('tl-end-min').value || '00';
    return `${sh}:${sm}–${eh}:${em}`;
  }

  window.openTlFormForAdd = function () {
    const form = document.getElementById('tl-form');
    document.getElementById('tl-edit-id').value = '';
    document.getElementById('tl-title-input').value = '';
    document.getElementById('tl-note-input').value = '';
    document.getElementById('tl-form-error').textContent = '';
    document.getElementById('tl-submit-btn').textContent = '儲存行程';
    document.getElementById('tl-delete-btn').style.display = 'none';
    FS.setDeleteConfirm(false);
    FS.setOverwriteConfirm(false);
    setFormTimeValue('10:00');
    form.classList.add('open');
    document.getElementById('tl-title-input').focus();
  };

  window.openTlFormForEdit = function (itemId) {
    const dayIdx = C.getDayIdx();
    const items = C.getState().daysMap[dayIdx] || [];
    const item = items.find((x) => x.id === itemId && !x.movedAway);
    if (!item) return;

    const form = document.getElementById('tl-form');
    document.getElementById('tl-edit-id').value = item.id;
    document.getElementById('tl-title-input').value = item.title;
    document.getElementById('tl-note-input').value = item.note || '';
    document.getElementById('tl-form-error').textContent = '';
    document.getElementById('tl-submit-btn').textContent = '儲存修改';

    const delBtn = document.getElementById('tl-delete-btn');
    delBtn.style.display = 'block';
    delBtn.textContent = '刪除此筆行程';
    delBtn.classList.remove('confirming');

    FS.setDeleteConfirm(false);
    FS.setOverwriteConfirm(false);
    setFormTimeValue(item.time);
    form.classList.add('open');
    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  window.initTimelineFormEvents = function () {
    populateTimeWheels();

    document.getElementById('tl-add-trigger').addEventListener('click', () => {
      C.requireIdentity(() => {
        const form = document.getElementById('tl-form');
        if (form.classList.contains('open') && !document.getElementById('tl-edit-id').value) {
          form.classList.remove('open');
        } else {
          window.openTlFormForAdd();
        }
      });
    });

    document.getElementById('tl-toggle-end-btn').addEventListener('click', () => {
      FS.setHasEndTime(!FS.getHasEndTime());
      syncTimeFormUI();
    });

    document.getElementById('tl-cancel-btn').addEventListener('click', () => {
      document.getElementById('tl-form').classList.remove('open');
    });

    document.getElementById('tl-form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (!C.requireIdentity(() => {})) return;

      const editId = document.getElementById('tl-edit-id').value;
      const title = document.getElementById('tl-title-input').value.trim();
      const note = document.getElementById('tl-note-input').value.trim();
      const errEl = document.getElementById('tl-form-error');

      if (!title) {
        errEl.textContent = '請填寫地點或事項名稱';
        return;
      }
      if (C.looksLikeSensitiveId(title) || C.looksLikeSensitiveId(note)) {
        errEl.textContent = '為保護個資安全，請勿在欄位中輸入護照號碼、信用卡號或密碼';
        return;
      }

      const dayIdx = C.getDayIdx();
      const st = C.getState();
      const dayArr = st.daysMap[dayIdx] || [];
      const timeStr = readFormTimeString();
      const me = C.getUser();

      if (editId) {
        const item = dayArr.find((x) => x.id === editId && !x.movedAway);
        if (!item) return;

        // 規格 3.4：改到別人寫的那一筆文字時，才問一次「這是某人寫的，仍要改嗎」
        const isOtherPerson = item.who && item.who !== '手冊預設' && item.who !== me;
        const textChanged = item.title !== title || (item.note || '') !== note;
        if (isOtherPerson && textChanged && !FS.getOverwriteConfirm()) {
          FS.setOverwriteConfirm(true);
          errEl.textContent = `這是 ${item.who} 寫的，仍要改嗎？請再按一次儲存確認`;
          document.getElementById('tl-submit-btn').textContent = `確定修改 ${item.who} 的內容`;
          return;
        }

        item.time = timeStr;
        item.title = title;
        item.note = note;
        if (!item.isHandbook) {
          item.q = title;
        } else if (title !== item.baseTitle) {
          item.q = title;
        } else {
          item.q = item.baseQ;
        }
        item.who = me;
        item.upd = Date.now();
      } else {
        const newItem = {
          id: `tl-${Date.now().toString(36)}`,
          time: timeStr,
          title,
          baseTitle: title,
          note,
          q: title,
          baseQ: title,
          flight: false,
          isHandbook: false,
          who: me,
          upd: Date.now()
        };
        dayArr.push(newItem);
        st.daysMap[dayIdx] = dayArr;
        const ordered = H.getOrderedDayItems(dayIdx);
        if (!ordered.some((x) => x.id === newItem.id)) ordered.push(newItem);
        H.saveDayOrder(dayIdx, ordered);
      }

      C.saveLocalState(true);
      document.getElementById('tl-form').classList.remove('open');
      window.renderTimeline();
      H.showTlStatus(editId ? `已更新「${title}」` : `已新增「${title}」`);
    });

    // 兩段式刪除（規格 3.4：再按一次才真的刪）
    document.getElementById('tl-delete-btn').addEventListener('click', () => {
      const editId = document.getElementById('tl-edit-id').value;
      if (!editId) return;
      const delBtn = document.getElementById('tl-delete-btn');
      if (!FS.getDeleteConfirm()) {
        FS.setDeleteConfirm(true);
        delBtn.textContent = '再按一次確定刪除';
        delBtn.classList.add('confirming');
        return;
      }
      const dayIdx = C.getDayIdx();
      const st = C.getState();
      const dayArr = st.daysMap[dayIdx] || [];
      const item = dayArr.find((x) => x.id === editId);
      if (item) {
        if (item.isHandbook) {
          item.movedAway = true;
          item.upd = Date.now();
        } else {
          const idx = dayArr.indexOf(item);
          if (idx >= 0) dayArr.splice(idx, 1);
        }
        st.tombstones[editId] = Date.now();
        const remaining = H.getOrderedDayItems(dayIdx).filter((x) => x.id !== editId);
        H.saveDayOrder(dayIdx, remaining);
        C.saveLocalState(true);
      }
      document.getElementById('tl-form').classList.remove('open');
      window.renderTimeline();
      H.showTlStatus('已刪除該筆行程');
    });

    // 恢復本日原行程
    document.getElementById('tl-restore-day-btn').addEventListener('click', () => {
      const dayIdx = C.getDayIdx();
      const dMeta = window.HANDBOOK_DATA.days[dayIdx];
      if (!dMeta) return;
      const st = C.getState();
      st.daysMap[dayIdx] = dMeta.items.map((it) => ({
        id: it.id,
        time: it.time,
        title: it.title,
        baseTitle: it.title,
        note: it.note || '',
        q: it.q || it.title,
        baseQ: it.q || it.title,
        flight: !!it.flight,
        isHandbook: true,
        who: '手冊預設',
        upd: Date.now()
      }));
      st.dayOrders[dayIdx] = dMeta.items.map((it) => it.id).join(',');
      C.saveLocalState(true);
      document.getElementById('tl-form').classList.remove('open');
      window.renderTimeline();
      H.showTlStatus(`已恢復 ${dMeta.label} 預設行程`);
    });
  };
})();

// ==================== Part 5: M2 記帳（總花費統計與分類明細） ====================
(function () {
  const C = window.__APP_CORE;
  const esc = window.__escapeHtml;

  let currentSplitSelection = ['老公', '老婆'];
  let expDeleteConfirm = false;

  function getCatColor(catName) {
    const found = window.HANDBOOK_DATA.expenseCategories.find((c) => c.name === catName);
    return found ? found.color : '#8A8177';
  }

  function toTwdInt(amount, currency) {
    const num = Number(amount || 0);
    if (currency === 'TWD') return Math.round(num);
    const rate = Number(C.getState().fxRate || 0.215);
    return Math.round(num * rate);
  }

  window.renderExpenses = function () {
    const st = C.getState();
    const tombstones = st.tombstones || {};
    const expenses = (st.expenses || []).filter((ex) => !tombstones[ex.id]);

    let totalTwd = 0;
    let rawTwdSum = 0;
    let rawJpySum = 0;
    let husbandPaidTwd = 0;
    let wifePaidTwd = 0;
    const catTotals = {};

    window.HANDBOOK_DATA.expenseCategories.forEach((c) => {
      catTotals[c.name] = 0;
    });

    expenses.forEach((ex) => {
      const twd = toTwdInt(ex.amount, ex.currency);
      totalTwd += twd;
      if (ex.currency === 'JPY') rawJpySum += Number(ex.amount || 0);
      else rawTwdSum += Number(ex.amount || 0);

      if (ex.payer === '老婆') wifePaidTwd += twd;
      else husbandPaidTwd += twd;

      const cat = catTotals[ex.category] !== undefined ? ex.category : '其他';
      catTotals[cat] = (catTotals[cat] || 0) + twd;
    });

    document.getElementById('exp-total-twd').textContent = `NT$ ${totalTwd.toLocaleString()}`;
    document.getElementById('exp-total-sub').textContent =
      `台幣項目合計 NT$ ${rawTwdSum.toLocaleString()} ＋ 日圓項目合計 ¥${rawJpySum.toLocaleString()}（以 ${st.fxRate} 換算）`;
    document.getElementById('exp-paid-husband').textContent = `NT$ ${husbandPaidTwd.toLocaleString()}`;
    document.getElementById('exp-paid-wife').textContent = `NT$ ${wifePaidTwd.toLocaleString()}`;

    // 分類色條與明細卡片
    const barEl = document.getElementById('exp-cat-bar');
    const gridEl = document.getElementById('exp-cat-grid');
    const filterCat = C.getExpFilterCat();
    const resetBtn = document.getElementById('exp-reset-filter-btn');
    if (resetBtn) resetBtn.style.display = filterCat ? 'inline-block' : 'none';

    if (totalTwd > 0) {
      barEl.style.display = 'flex';
      barEl.innerHTML = window.HANDBOOK_DATA.expenseCategories.map((c) => {
        const val = catTotals[c.name] || 0;
        if (val <= 0) return '';
        const pct = Math.max(2, (val / totalTwd) * 100);
        return `<div style="width:${pct}%;background:${c.color};" title="${c.name}: NT$${val.toLocaleString()}"></div>`;
      }).join('');
    } else {
      barEl.style.display = 'none';
    }

    gridEl.innerHTML = window.HANDBOOK_DATA.expenseCategories.map((c) => {
      const val = catTotals[c.name] || 0;
      const pct = totalTwd > 0 ? Math.round((val / totalTwd) * 100) : 0;
      const isAct = filterCat === c.name;
      return `
        <div class="exp-cat-item ${isAct ? 'active' : ''}" data-cat="${c.name}">
          <span><span class="exp-cat-dot" style="background:${c.color};"></span>${c.name}</span>
          <span>NT$ ${val.toLocaleString()} <small style="color:var(--muted);">(${pct}%)</small></span>
        </div>
      `;
    }).join('');

    gridEl.querySelectorAll('.exp-cat-item').forEach((el) => {
      el.addEventListener('click', () => {
        const cat = el.getAttribute('data-cat');
        C.setExpFilterCat(C.getExpFilterCat() === cat ? '' : cat);
        window.renderExpenses();
      });
    });

    // 帳目列表
    const listEl = document.getElementById('exp-list');
    const filtered = filterCat ? expenses.filter((x) => x.category === filterCat) : expenses;
    const sorted = filtered.slice().sort((a, b) => (b.upd || 0) - (a.upd || 0));

    if (sorted.length === 0) {
      listEl.innerHTML = '<div class="card" style="text-align:center;color:var(--sub);">此分類目前沒有帳目紀錄</div>';
      return;
    }

    listEl.innerHTML = sorted.map((ex) => {
      const twd = toTwdInt(ex.amount, ex.currency);
      const isPendingZero = Number(ex.amount) === 0;
      const catColor = getCatColor(ex.category);
      const amtDisplay = isPendingZero
        ? '<span style="color:var(--accent);font-size:12.5px;font-weight:700;">金額待補（點鉛筆填入）</span>'
        : ex.currency === 'JPY'
          ? `<div style="font-size:14px;font-weight:700;color:var(--text);">¥ ${Number(ex.amount).toLocaleString()}</div><div style="font-size:11.5px;color:var(--sub);">≈ NT$ ${twd.toLocaleString()}</div>`
          : `<div style="font-size:14px;font-weight:700;color:var(--text);">NT$ ${Number(ex.amount).toLocaleString()}</div>`;

      return `
        <div class="exp-item-card" style="border-left:3px solid ${catColor};">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;flex-wrap:wrap;">
              <span style="font-size:11px;color:${catColor};border:1px solid ${catColor};border-radius:3px;padding:0 5px;">${esc(ex.category)}</span>
              <span style="font-size:11.5px;color:var(--sub);">${esc(ex.payer)} 付款 · ${esc((ex.split || ['老公', '老婆']).join('、'))}</span>
            </div>
            <div style="font-size:14px;font-weight:700;color:var(--text);word-break:break-word;">${esc(ex.title)}</div>
            ${ex.note ? `<div style="font-size:12px;color:var(--sub);margin-top:2px;">${esc(ex.note)}</div>` : ''}
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;text-align:right;">
            <div>${amtDisplay}</div>
            <button type="button" class="tl-icon-btn exp-edit-btn" data-id="${ex.id}" title="修改或填入金額" aria-label="修改帳目">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            </button>
          </div>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.exp-edit-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        C.requireIdentity(() => openExpFormForEdit(id));
      });
    });
  };

  function renderSplitButtons() {
    const box = document.getElementById('exp-split-group');
    if (!box) return;
    box.innerHTML = ['老公', '老婆'].map((m) => {
      const checked = currentSplitSelection.includes(m);
      return `<button type="button" class="split-person-btn ${checked ? 'checked' : ''}" data-m="${m}">${checked ? '✓ ' : ''}${m}</button>`;
    }).join('');
    box.querySelectorAll('.split-person-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const m = btn.getAttribute('data-m');
        if (currentSplitSelection.includes(m)) {
          currentSplitSelection = currentSplitSelection.filter((x) => x !== m);
        } else {
          currentSplitSelection.push(m);
        }
        renderSplitButtons();
        updateExpPreview();
      });
    });
  }

  // 規格 M2：即時預覽每人分到多少，餘數放到付款人身上，加總必等於換算後台幣
  function updateExpPreview() {
    const amt = parseFloat(document.getElementById('exp-amount-input').value) || 0;
    const cur = document.getElementById('exp-currency-select').value;
    const payer = document.getElementById('exp-payer-select').value;
    const previewEl = document.getElementById('exp-preview-line');
    if (!previewEl) return;

    if (currentSplitSelection.length === 0) {
      previewEl.textContent = '請至少勾選 1 位使用對象';
      return;
    }
    const twdTotal = toTwdInt(amt, cur);
    const count = currentSplitSelection.length;
    const baseShare = Math.floor(twdTotal / count);
    const remainder = twdTotal - baseShare * count;

    const parts = currentSplitSelection.map((m, idx) => {
      const getsRemainder = currentSplitSelection.includes(payer) ? (m === payer) : (idx === 0);
      const share = baseShare + (getsRemainder ? remainder : 0);
      return `${m} NT$ ${share.toLocaleString()}`;
    });
    previewEl.textContent = `折合台幣共 NT$ ${twdTotal.toLocaleString()}（${parts.join(' ／ ')}）`;
  }

  function openExpFormForEdit(id) {
    const st = C.getState();
    const ex = (st.expenses || []).find((x) => x.id === id);
    if (!ex) return;
    document.getElementById('exp-edit-id').value = ex.id;
    document.getElementById('exp-title-input').value = ex.title;
    document.getElementById('exp-amount-input').value = ex.amount > 0 ? ex.amount : '';
    document.getElementById('exp-currency-select').value = ex.currency || 'TWD';
    document.getElementById('exp-category-select').value = ex.category || '其他';
    document.getElementById('exp-payer-select').value = ex.payer || '老公';
    document.getElementById('exp-note-input').value = ex.note || '';
    document.getElementById('exp-form-error').textContent = '';
    currentSplitSelection = Array.isArray(ex.split) && ex.split.length > 0 ? ex.split.slice() : ['老公', '老婆'];
    renderSplitButtons();
    updateExpPreview();

    const delBtn = document.getElementById('exp-delete-btn');
    delBtn.style.display = 'block';
    delBtn.textContent = '刪除此筆帳目';
    delBtn.classList.remove('confirming');
    expDeleteConfirm = false;

    const form = document.getElementById('exp-form');
    form.classList.add('open');
    document.getElementById('exp-amount-input').focus();
  }

  window.initExpenseEvents = function () {
    const catSel = document.getElementById('exp-category-select');
    if (catSel) {
      catSel.innerHTML = window.HANDBOOK_DATA.expenseCategories
        .map((c) => `<option value="${c.name}">${c.name}</option>`).join('');
    }
    renderSplitButtons();

    document.getElementById('exp-reset-filter-btn').addEventListener('click', () => {
      C.setExpFilterCat('');
      window.renderExpenses();
    });

    document.getElementById('exp-add-trigger').addEventListener('click', () => {
      C.requireIdentity(() => {
        const form = document.getElementById('exp-form');
        if (form.classList.contains('open') && !document.getElementById('exp-edit-id').value) {
          form.classList.remove('open');
          return;
        }
        document.getElementById('exp-edit-id').value = '';
        document.getElementById('exp-title-input').value = '';
        document.getElementById('exp-amount-input').value = '';
        document.getElementById('exp-currency-select').value = 'JPY';
        document.getElementById('exp-category-select').value = '美食';
        document.getElementById('exp-payer-select').value = C.getUser() || '老公';
        document.getElementById('exp-note-input').value = '';
        document.getElementById('exp-form-error').textContent = '';
        document.getElementById('exp-delete-btn').style.display = 'none';
        currentSplitSelection = ['老公', '老婆'];
        expDeleteConfirm = false;
        renderSplitButtons();
        updateExpPreview();
        form.classList.add('open');
        document.getElementById('exp-title-input').focus();
      });
    });

    ['exp-amount-input', 'exp-currency-select', 'exp-payer-select'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', updateExpPreview);
      if (el) el.addEventListener('change', updateExpPreview);
    });

    document.getElementById('exp-cancel-btn').addEventListener('click', () => {
      document.getElementById('exp-form').classList.remove('open');
    });

    document.getElementById('exp-form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (!C.requireIdentity(() => {})) return;
      const editId = document.getElementById('exp-edit-id').value;
      const title = document.getElementById('exp-title-input').value.trim();
      const rawAmt = document.getElementById('exp-amount-input').value.trim();
      const amount = rawAmt === '' ? 0 : Number(rawAmt);
      const currency = document.getElementById('exp-currency-select').value;
      const category = document.getElementById('exp-category-select').value;
      const payer = document.getElementById('exp-payer-select').value;
      const note = document.getElementById('exp-note-input').value.trim();
      const errEl = document.getElementById('exp-form-error');

      if (!title) {
        errEl.textContent = '請填寫帳目項目名稱';
        return;
      }
      if (isNaN(amount) || amount < 0) {
        errEl.textContent = '金額請輸入有效的正整數或數字';
        return;
      }
      if (currentSplitSelection.length === 0) {
        errEl.textContent = '使用對象至少需勾選 1 人';
        return;
      }
      if (C.looksLikeSensitiveId(title) || C.looksLikeSensitiveId(note)) {
        errEl.textContent = '請勿在備註或名稱輸入信用卡號或證件號碼';
        return;
      }

      const st = C.getState();
      if (editId) {
        const ex = (st.expenses || []).find((x) => x.id === editId);
        if (ex) {
          ex.title = title;
          ex.amount = amount;
          ex.currency = currency;
          ex.category = category;
          ex.payer = payer;
          ex.split = currentSplitSelection.slice();
          ex.note = note;
          ex.who = C.getUser();
          ex.upd = Date.now();
        }
      } else {
        st.expenses.push({
          id: `exp-${Date.now().toString(36)}`,
          title,
          amount,
          currency,
          category,
          payer,
          split: currentSplitSelection.slice(),
          note,
          who: C.getUser(),
          upd: Date.now()
        });
      }

      C.saveLocalState(true);
      document.getElementById('exp-form').classList.remove('open');
      window.renderExpenses();
      C.showSyncBanner(editId ? `已更新帳目「${title}」` : `已記帳「${title}」`);
    });

    document.getElementById('exp-delete-btn').addEventListener('click', () => {
      const editId = document.getElementById('exp-edit-id').value;
      if (!editId) return;
      const btn = document.getElementById('exp-delete-btn');
      if (!expDeleteConfirm) {
        expDeleteConfirm = true;
        btn.textContent = '再按一次確定刪除';
        btn.classList.add('confirming');
        return;
      }
      const st = C.getState();
      st.expenses = (st.expenses || []).filter((x) => x.id !== editId);
      st.tombstones[editId] = Date.now();
      C.saveLocalState(true);
      document.getElementById('exp-form').classList.remove('open');
      window.renderExpenses();
      C.showSyncBanner('已刪除該筆帳目');
    });
  };
})();

// ==================== Part 6: M3 美食景點 與 M4 日文小卡 ====================
(function () {
  const C = window.__APP_CORE;
  const esc = window.__escapeHtml;
  const plDeleteStageMap = {};

  function getLatestCheckinTime(pl) {
    const chks = pl.checkins || {};
    const times = Object.values(chks).map(Number).filter((n) => n > 0);
    return times.length > 0 ? Math.max(...times) : 0;
  }

  window.renderPlaces = function () {
    const st = C.getState();
    const tombstones = st.tombstones || {};
    const places = (st.places || []).filter((p) => !tombstones[p.id]);

    // 1. 動態產生分類膠囊
    const tagSet = new Set(['全部']);
    places.forEach((p) => {
      (p.tags || []).forEach((t) => {
        if (t) tagSet.add(t);
      });
    });
    const activeTag = C.getPlFilterTag();
    const pillsEl = document.getElementById('pl-filter-pills');
    if (pillsEl) {
      pillsEl.innerHTML = Array.from(tagSet).map((t) => `
        <button type="button" class="filter-pill ${t === activeTag ? 'active' : ''}" data-tag="${esc(t)}">${esc(t)}</button>
      `).join('');
      pillsEl.querySelectorAll('.filter-pill').forEach((btn) => {
        btn.addEventListener('click', () => {
          C.setPlFilterTag(btn.getAttribute('data-tag'));
          window.renderPlaces();
        });
      });
    }

    // 2. 篩選與三層排序（規格 M3：1.有人打過卡且最新打卡在上 2.未打卡但自己加的最新在上 3.手冊原本列好的維持原順序）
    const filtered = activeTag === '全部'
      ? places.slice()
      : places.filter((p) => (p.tags || []).includes(activeTag));

    const tier1 = [];
    const tier2 = [];
    const tier3 = [];
    filtered.forEach((p) => {
      const latestChk = getLatestCheckinTime(p);
      if (latestChk > 0) tier1.push(p);
      else if (p.who) tier2.push(p);
      else tier3.push(p);
    });

    tier1.sort((a, b) => getLatestCheckinTime(b) - getLatestCheckinTime(a));
    tier2.sort((a, b) => (b.upd || 0) - (a.upd || 0));
    const finalOrdered = [...tier1, ...tier2, ...tier3];

    const listEl = document.getElementById('pl-list');
    const me = C.getUser();
    if (!listEl) return;

    listEl.innerHTML = finalOrdered.map((p) => {
      const chks = p.checkins || {};
      const iChecked = me && chks[me] > 0;
      // 規格 M3 地圖：有 who 的店搜尋用 n，手冊店用 q
      const mapQuery = p.who ? p.n : (p.q || p.n);
      const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`;
      const delStage = plDeleteStageMap[p.id] || 0;
      const isOtherOwner = p.who && me && p.who !== me;
      const delLabel = delStage === 1
        ? (isOtherOwner ? `這是 ${p.who} 推薦的，確定要刪嗎？再按一次` : '再按一次確定刪除')
        : '刪除推薦';

      return `
        <div class="place-card">
          <div class="place-top">
            <div style="font-size:14px;font-weight:700;color:var(--text);">${esc(p.n)}</div>
            <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;">
              ${(p.tags || []).map((t) => `<span class="place-tag">${esc(t)}</span>`).join('')}
            </div>
          </div>
          <div style="font-size:12.5px;color:var(--sub);margin-bottom:6px;">${esc(p.note || '')}</div>
          <div class="checkin-dots">
            <span style="font-size:11.5px;color:var(--sub);">打卡狀態：</span>
            ${['老公', '老婆'].map((m) => {
              const done = chks[m] > 0;
              return `<button type="button" class="checkin-dot ${done ? 'done' : ''}" data-pl-id="${p.id}" data-member="${m}">${done ? '✓ ' : '○ '}${m}</button>`;
            }).join('')}
          </div>
          <div class="place-btn-row">
            <a href="${mapUrl}" target="_blank" rel="noopener" class="btn-secondary" style="text-align:center;text-decoration:none;margin:0;">📍 查看店家</a>
            <button type="button" class="btn-primary pl-checkin-btn" data-pl-id="${p.id}" style="margin:0;${iChecked ? 'background:var(--green);border-color:var(--green);' : ''}">
              ${iChecked ? '✓ 已打卡（再按取消）' : '打卡'}
            </button>
          </div>
          ${p.who ? `
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px;padding-top:8px;border-top:1px dashed var(--line);font-size:11.5px;color:var(--sub);">
              <span>由 <strong>${esc(p.who)}</strong> 推薦</span>
              <button type="button" class="fx-pill pl-del-btn" data-pl-id="${p.id}" style="${delStage === 1 ? 'border-color:var(--accent);color:var(--accent);font-weight:700;' : ''}">${delLabel}</button>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.pl-checkin-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const plId = btn.getAttribute('data-pl-id');
        C.requireIdentity(() => togglePlaceCheckin(plId, C.getUser()));
      });
    });

    listEl.querySelectorAll('.checkin-dot').forEach((dot) => {
      dot.addEventListener('click', () => {
        const plId = dot.getAttribute('data-pl-id');
        C.requireIdentity(() => togglePlaceCheckin(plId, C.getUser()));
      });
    });

    listEl.querySelectorAll('.pl-del-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const plId = btn.getAttribute('data-pl-id');
        C.requireIdentity(() => {
          if (!plDeleteStageMap[plId]) {
            plDeleteStageMap[plId] = 1;
            window.renderPlaces();
            return;
          }
          delete plDeleteStageMap[plId];
          const s = C.getState();
          s.places = (s.places || []).filter((x) => x.id !== plId);
          s.tombstones[plId] = Date.now();
          C.saveLocalState(true);
          window.renderPlaces();
          if (window.renderMoreSection) window.renderMoreSection();
          C.showSyncBanner('已刪除該筆推薦店家');
        });
      });
    });
  };

  function togglePlaceCheckin(plId, memberName) {
    if (!memberName) return;
    const st = C.getState();
    const pl = (st.places || []).find((x) => x.id === plId);
    if (!pl) return;
    if (!pl.checkins) pl.checkins = {};
    if (pl.checkins[memberName] > 0) {
      delete pl.checkins[memberName];
    } else {
      pl.checkins[memberName] = Date.now();
    }
    pl.upd = Date.now();
    C.saveLocalState(true);
    window.renderPlaces();
    if (window.renderMoreSection) window.renderMoreSection();
  }

  window.initPlaceEvents = function () {
    document.getElementById('pl-add-trigger').addEventListener('click', () => {
      C.requireIdentity(() => {
        const form = document.getElementById('pl-form');
        form.classList.toggle('open');
        if (form.classList.contains('open')) {
          document.getElementById('pl-name-input').focus();
        }
      });
    });

    document.getElementById('pl-cancel-btn').addEventListener('click', () => {
      document.getElementById('pl-form').classList.remove('open');
    });

    document.getElementById('pl-form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (!C.requireIdentity(() => {})) return;
      const n = document.getElementById('pl-name-input').value.trim();
      const tagRaw = document.getElementById('pl-tag-input').value.trim() || '推薦';
      const note = document.getElementById('pl-note-input').value.trim();
      const errEl = document.getElementById('pl-form-error');

      if (!n) {
        errEl.textContent = '請貼上或輸入店名／景點名稱';
        return;
      }
      if (C.looksLikeSensitiveId(n) || C.looksLikeSensitiveId(note)) {
        errEl.textContent = '請勿輸入敏感證件或卡號';
        return;
      }

      const tags = tagRaw.split(/[、,，\s]+/).filter(Boolean);
      const st = C.getState();
      st.places.push({
        id: `pl-u-${Date.now().toString(36)}`,
        n,
        tags: tags.length > 0 ? tags : ['推薦'],
        note: note || '口袋推薦名單',
        q: n,
        isHandbook: false,
        who: C.getUser(),
        checkins: {},
        upd: Date.now()
      });
      C.saveLocalState(true);
      document.getElementById('pl-name-input').value = '';
      document.getElementById('pl-tag-input').value = '';
      document.getElementById('pl-note-input').value = '';
      errEl.textContent = '';
      document.getElementById('pl-form').classList.remove('open');
      window.renderPlaces();
      C.showSyncBanner(`已加入推薦店家「${n}」`);
    });
  };

  // ==================== M4 小卡 ====================
  window.renderPhraseCards = function () {
    const cards = window.HANDBOOK_DATA.phraseCards || [];
    const cats = ['全部', '問候', '點餐', '購物', '交通', '住宿', '身體不適'];
    const activeCat = C.getCardFilterCat();

    const pillsEl = document.getElementById('card-filter-pills');
    if (pillsEl) {
      pillsEl.innerHTML = cats.map((c) => `
        <button type="button" class="filter-pill ${c === activeCat ? 'active' : ''}" data-cat="${c}">${c}</button>
      `).join('');
      pillsEl.querySelectorAll('.filter-pill').forEach((btn) => {
        btn.addEventListener('click', () => {
          C.setCardFilterCat(btn.getAttribute('data-cat'));
          window.renderPhraseCards();
        });
      });
    }

    const filtered = activeCat === '全部' ? cards : cards.filter((c) => c.cat === activeCat);
    const listEl = document.getElementById('card-list');
    if (!listEl) return;

    listEl.innerHTML = filtered.map((c) => `
      <div class="phrase-card" data-card-id="${c.id}">
        <div class="phrase-cat">${esc(c.cat)} · 點選放大給店員看</div>
        <div class="phrase-jp">${esc(c.jp)}</div>
        <div class="phrase-zh">${esc(c.zh)}</div>
        <div class="phrase-pron">近似讀音：${esc(c.pron)}</div>
      </div>
    `).join('');

    listEl.querySelectorAll('.phrase-card').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-card-id');
        const found = cards.find((x) => x.id === id);
        if (!found) return;
        C.setActiveZoomPhrase(found);
        document.getElementById('zoom-cat').textContent = found.cat;
        document.getElementById('zoom-jp').textContent = found.jp;
        document.getElementById('zoom-zh').textContent = found.zh;
        document.getElementById('zoom-pron').textContent = `台灣近似讀音：${found.pron}`;
        document.getElementById('zoom-feedback').textContent = '';
        document.getElementById('phrase-modal').classList.add('open');
      });
    });
  };

  window.initPhraseCardEvents = function () {
    document.getElementById('zoom-close-btn').addEventListener('click', () => {
      if (window.speechSynthesis) {
        try { window.speechSynthesis.cancel(); } catch (e) {}
      }
      document.getElementById('phrase-modal').classList.remove('open');
    });

    document.getElementById('zoom-speak-btn').addEventListener('click', () => {
      const p = C.getActiveZoomPhrase();
      const fb = document.getElementById('zoom-feedback');
      if (!p) return;
      try {
        if (!('speechSynthesis' in window)) {
          fb.textContent = '此裝置不支援語音播報，已為您放大日文字體方便直接給店員看';
          return;
        }
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(p.jp);
        utter.lang = 'ja-JP';
        utter.rate = 0.92;
        utter.onerror = () => {
          fb.textContent = '手機目前為靜音或未安裝日文語音，請直接將大字畫面拿給店員看';
        };
        window.speechSynthesis.speak(utter);
        fb.textContent = '正在播放日文語音（若手機開啟靜音，請直接拿畫面給店員看）';
      } catch (e) {
        fb.textContent = '請直接將上方日文畫面拿給店員看，或點下方複製日文';
      }
    });

    document.getElementById('zoom-copy-btn').addEventListener('click', async () => {
      const p = C.getActiveZoomPhrase();
      const fb = document.getElementById('zoom-feedback');
      if (!p) return;
      try {
        await navigator.clipboard.writeText(p.jp);
        fb.textContent = '✓ 已複製這句日文到剪貼簿';
      } catch (e) {
        fb.textContent = '請直接長按上方日文複製';
      }
    });
  };
})();

// ==================== Part 7: M5 更多、雲端設定、身份切換與全域初始化 ====================
(function () {
  const C = window.__APP_CORE;
  const esc = window.__escapeHtml;
  let editingTicketUrl = false;

  const SUPABASE_CREATE_SQL = `-- 請在 Supabase 左側 SQL Editor 貼上以下語法並按 Run：
create table if not exists public.osaka_trip_sync (
  room_id text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.osaka_trip_sync enable row level security;
create policy "Allow anon read write osaka_trip_sync"
  on public.osaka_trip_sync for all to anon
  using (true) with check (true);`;

  window.renderMoreSection = function () {
    const st = C.getState();
    const me = C.getUser();

    // 1. 行前清單
    const chkListEl = document.getElementById('chk-list');
    const checklist = st.checklist || [];
    let totalChecks = 0;
    const maxChecks = checklist.length * 2;

    if (chkListEl) {
      chkListEl.innerHTML = checklist.map((item) => {
        const cb = item.checkedBy || {};
        const count = (cb['老公'] ? 1 : 0) + (cb['老婆'] ? 1 : 0);
        totalChecks += count;
        const iChecked = me && cb[me];
        return `
          <div class="checklist-item">
            <div class="checklist-left" data-chk-id="${item.id}">
              <span class="check-box ${iChecked ? 'checked' : ''}">${iChecked ? '✓' : ''}</span>
              <span style="font-size:13px;${iChecked ? 'text-decoration:line-through;color:var(--sub);' : 'color:var(--text);'}">${esc(item.text)}</span>
            </div>
            <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;font-size:11px;color:var(--sub);">
              <span style="${cb['老公'] ? 'color:var(--green);font-weight:700;' : ''}">老公${cb['老公'] ? '✓' : ''}</span>
              <span>·</span>
              <span style="${cb['老婆'] ? 'color:var(--green);font-weight:700;' : ''}">老婆${cb['老婆'] ? '✓' : ''}</span>
              <span style="margin-left:2px;">(${count}/2)</span>
            </div>
          </div>
        `;
      }).join('');

      chkListEl.querySelectorAll('.checklist-left').forEach((row) => {
        row.addEventListener('click', () => {
          const id = row.getAttribute('data-chk-id');
          C.requireIdentity(() => {
            const u = C.getUser();
            const found = (C.getState().checklist || []).find((x) => x.id === id);
            if (!found) return;
            if (!found.checkedBy) found.checkedBy = {};
            found.checkedBy[u] = !found.checkedBy[u];
            found.upd = Date.now();
            C.saveLocalState(true);
            window.renderMoreSection();
          });
        });
      });
    }

    const pct = maxChecks > 0 ? Math.round((totalChecks / maxChecks) * 100) : 0;
    document.getElementById('chk-progress-text').textContent = `${pct}% (${totalChecks}/${maxChecks})`;
    document.getElementById('chk-progress-fill').style.width = `${pct}%`;

    // 2. 外部連結與自訂電子票券夾（規格 M5：沒有網址的外連不放假連結）
    const linksWrap = document.getElementById('more-links-wrap');
    if (linksWrap) {
      const customTicketUrl = (st.customLinks && st.customLinks.ticketFolderUrl) || '';
      let html = '';

      if (customTicketUrl) {
        html += `
          <a href="${esc(customTicketUrl)}" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:space-between;padding:10px;background:var(--bg);border:1px solid var(--accent);border-radius:4px;text-decoration:none;color:var(--text);">
            <div>
              <div style="font-size:13.5px;font-weight:700;color:var(--accent);">📂 我們的電子票券＆憑證雲端資料夾</div>
              <div style="font-size:11.5px;color:var(--sub);">機票、USJ門票、KKday憑證、訂房確認單</div>
            </div>
            <span style="color:var(--accent);font-weight:700;">↗</span>
          </a>
        `;
      }

      window.HANDBOOK_DATA.officialLinks.forEach((lk) => {
        html += `
          <a href="${esc(lk.url)}" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:space-between;padding:9px 10px;background:var(--bg);border:1px solid var(--line);border-radius:4px;text-decoration:none;color:var(--text);">
            <div>
              <div style="font-size:13px;font-weight:700;">${esc(lk.title)}</div>
              <div style="font-size:11.5px;color:var(--sub);">${esc(lk.sub)}</div>
            </div>
            <span style="color:var(--sub);">↗</span>
          </a>
        `;
      });

      html += `
        <div style="margin-top:4px;">
          <button type="button" id="toggle-ticket-url-btn" class="fx-pill" style="width:100%;padding:6px;">
            ${customTicketUrl ? '✎ 修改電子票券雲端資料夾網址' : '＋ 設定電子票券資料夾網址（Google Drive / Notion）'}
          </button>
          <div id="ticket-url-form" style="display:${editingTicketUrl ? 'block' : 'none'};margin-top:8px;">
            <input type="url" id="ticket-url-input" class="form-input" placeholder="貼上雲端資料夾網址 https://..." value="${esc(customTicketUrl)}" style="margin-bottom:6px;" />
            <button type="button" id="save-ticket-url-btn" class="btn-primary" style="margin:0;">儲存票券資料夾網址</button>
          </div>
        </div>
      `;
      linksWrap.innerHTML = html;

      document.getElementById('toggle-ticket-url-btn').addEventListener('click', () => {
        C.requireIdentity(() => {
          editingTicketUrl = !editingTicketUrl;
          window.renderMoreSection();
        });
      });
      const saveBtn = document.getElementById('save-ticket-url-btn');
      if (saveBtn) {
        saveBtn.addEventListener('click', () => {
          const val = document.getElementById('ticket-url-input').value.trim();
          if (!st.customLinks) st.customLinks = {};
          st.customLinks.ticketFolderUrl = val;
          st.customLinks.upd = Date.now();
          editingTicketUrl = false;
          C.saveLocalState(true);
          window.renderMoreSection();
          C.showSyncBanner(val ? '已儲存電子票券資料夾連結' : '已清除自訂連結');
        });
      }
    }

    // 3. 打卡王排行（並列就並列）
    const lbEl = document.getElementById('more-leaderboard');
    if (lbEl) {
      const tombstones = st.tombstones || {};
      const places = (st.places || []).filter((p) => !tombstones[p.id]);
      let hCount = 0;
      let wCount = 0;
      places.forEach((p) => {
        if (p.checkins && p.checkins['老公'] > 0) hCount++;
        if (p.checkins && p.checkins['老婆'] > 0) wCount++;
      });
      let rankHtml = '';
      if (hCount === wCount) {
        rankHtml = `<div style="font-size:13.5px;font-weight:700;color:var(--accent);">🏆 並列第一：老公（${hCount} 處）＆ 老婆（${wCount} 處）</div>`;
      } else if (hCount > wCount) {
        rankHtml = `
          <div style="font-size:13.5px;font-weight:700;color:var(--accent);">🥇 第 1 名：老公（已打卡 ${hCount} 處）</div>
          <div style="font-size:12.5px;color:var(--sub);margin-top:4px;">🥈 第 2 名：老婆（已打卡 ${wCount} 處）</div>
        `;
      } else {
        rankHtml = `
          <div style="font-size:13.5px;font-weight:700;color:var(--accent);">🥇 第 1 名：老婆（已打卡 ${wCount} 處）</div>
          <div style="font-size:12.5px;color:var(--sub);margin-top:4px;">🥈 第 2 名：老公（已打卡 ${hCount} 處）</div>
        `;
      }
      lbEl.innerHTML = rankHtml;
    }

    // 5. 兩則短提醒
    const remEl = document.getElementById('more-reminders');
    if (remEl) {
      remEl.innerHTML = window.HANDBOOK_DATA.reminders.map((r) => `
        <div class="card">
          <div style="font-size:13.5px;font-weight:700;color:var(--accent);margin-bottom:4px;">${esc(r.title)}</div>
          <div style="font-size:12.5px;color:var(--text);margin-bottom:4px;">${esc(r.line1)}</div>
          <div style="font-size:12.5px;color:var(--sub);">${esc(r.line2)}</div>
        </div>
      `).join('');
    }

    // 6. 緊急聯絡電話
    const emEl = document.getElementById('more-emergency');
    if (emEl) {
      emEl.innerHTML = window.HANDBOOK_DATA.emergencyContacts.map((c) => `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding-bottom:8px;border-bottom:1px solid var(--line);">
          <div>
            <div style="font-size:13px;font-weight:700;">${esc(c.name)}</div>
            <div style="font-size:11.5px;color:var(--sub);">${esc(c.note)}</div>
          </div>
          <a href="tel:${esc(c.tel)}" class="fx-pill" style="text-decoration:none;color:var(--accent);font-weight:700;white-space:nowrap;">📞 ${esc(c.tel)}</a>
        </div>
      `).join('');
    }
  };

  function switchTab(tabName, updateHash = true) {
    const validTabs = ['tl', 'exp', 'pl', 'card', 'more'];
    const target = validTabs.includes(tabName) ? tabName : 'tl';
    C.setTab(target);

    document.querySelectorAll('.tab-pane').forEach((p) => {
      p.classList.toggle('active', p.id === `pane-${target}`);
    });
    document.querySelectorAll('.nav-tab').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-tab') === target);
    });
    if (updateHash && window.location.hash !== `#${target}`) {
      history.replaceState(null, '', `#${target}`);
    }
  }

  window.renderAll = function () {
    window.renderHeaderAndIdentity();
    window.renderFxBar();
    window.renderTimeline();
    window.renderExpenses();
    window.renderPlaces();
    window.renderPhraseCards();
    window.renderMoreSection();
  };

  function initGlobalEvents() {
    // 底部導覽列與 Hash 路由
    document.querySelectorAll('.nav-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        switchTab(btn.getAttribute('data-tab'), true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });

    window.addEventListener('hashchange', () => {
      const h = (window.location.hash || '#tl').replace('#', '');
      switchTab(h, false);
    });

    // 同步橫幅關閉
    document.getElementById('sync-banner-close').addEventListener('click', () => {
      document.getElementById('sync-banner').classList.remove('show');
    });

    // 頂部身份按鈕點選跳到更多設定
    document.getElementById('identity-pill').addEventListener('click', () => {
      if (!C.getUser()) {
        document.getElementById('identity-modal').classList.add('open');
      } else {
        switchTab('more', true);
        setTimeout(() => {
          document.getElementById('switch-user-input').focus();
        }, 100);
      }
    });

    // 全螢幕選身份
    document.querySelectorAll('.id-select-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const m = btn.getAttribute('data-member');
        C.setUser(m);
        document.getElementById('identity-modal').classList.remove('open');
        window.renderHeaderAndIdentity();
        window.renderMoreSection();
        C.consumePendingAction();
      });
    });

    // 天氣抽屜
    document.getElementById('weather-btn').addEventListener('click', () => {
      const dr = document.getElementById('weather-drawer');
      dr.classList.toggle('open');
      if (dr.classList.contains('open')) window.fetchAndRenderWeather();
    });
    document.getElementById('weather-close-btn').addEventListener('click', () => {
      document.getElementById('weather-drawer').classList.remove('open');
    });
    document.getElementById('more-open-weather-btn').addEventListener('click', () => {
      const dr = document.getElementById('weather-drawer');
      dr.classList.add('open');
      window.fetchAndRenderWeather();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // 匯率條事件
    document.getElementById('fx-left-input').addEventListener('input', () => {
      window.renderFxBar();
    });
    document.getElementById('fx-swap-btn').addEventListener('click', () => {
      const rev = !C.getFxReversed();
      C.setFxReversed(rev);
      document.getElementById('fx-left-input').value = rev ? '1000' : '1000';
      window.renderFxBar();
    });
    document.getElementById('refresh-fx-btn').addEventListener('click', () => {
      window.refreshExchangeRate(true);
    });

    // M5 新增自訂行前項目
    document.getElementById('chk-add-btn').addEventListener('click', () => {
      C.requireIdentity(() => {
        const inp = document.getElementById('chk-new-input');
        const txt = inp.value.trim();
        if (!txt) return;
        if (C.looksLikeSensitiveId(txt)) {
          C.showSyncBanner('請勿在行前清單中填入完整證件號碼或密碼');
          return;
        }
        C.getState().checklist.push({
          id: `chk-${Date.now().toString(36)}`,
          text: txt,
          checkedBy: {},
          upd: Date.now()
        });
        inp.value = '';
        C.saveLocalState(true);
        window.renderMoreSection();
      });
    });

    // M5 唯讀同步診斷（規格 1 & M5：診斷按鈕只讀，不寫入任何資料）
    document.getElementById('diag-test-btn').addEventListener('click', async () => {
      const box = document.getElementById('diag-result-box');
      box.style.display = 'block';
      box.textContent = '正在執行唯讀連線診斷（不會新增或修改任何資料）...';
      const res = await window.pullFromSupabaseAsync(true);
      const st = C.getState();
      box.innerHTML = `
        <div><strong>本機狀態：</strong>正常（共 ${st.expenses.length} 筆帳目、${st.places.length} 筆景點美食）</div>
        <div style="margin-top:3px;"><strong>雲端狀態：</strong>${esc(res.msg)}</div>
      `;
    });

    // Supabase 設定展開與儲存
    document.getElementById('supa-toggle-config-btn').addEventListener('click', () => {
      const panel = document.getElementById('supa-config-panel');
      const isOpen = panel.style.display === 'block';
      panel.style.display = isOpen ? 'none' : 'block';
      if (!isOpen) {
        try {
          const cfg = JSON.parse(localStorage.getItem(C.SUPA_CFG_KEY) || '{}');
          document.getElementById('supa-url-input').value = cfg.url || 'https://vkczkibsqppyrivvafjk.supabase.co';
          document.getElementById('supa-key-input').value = cfg.key || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZrY3praWJzcXBweXJpdnZhZmprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxMjE0ODcsImV4cCI6MjA5OTY5NzQ4N30.Io9qB9Q4_-qtjQBNW-pGqrDYb3ZzjrRdOyMUR_E_cW8';
          document.getElementById('supa-room-input').value = (!cfg.room || cfg.room === 'main') ? 'osaka_2026_couple' : cfg.room;
        } catch (e) {}
      }
    });

    document.getElementById('supa-save-btn').addEventListener('click', async () => {
      const url = document.getElementById('supa-url-input').value.trim();
      const key = document.getElementById('supa-key-input').value.trim();
      let room = document.getElementById('supa-room-input').value.trim() || 'osaka_2026_couple';
      if (room === 'main') {
        room = 'osaka_2026_couple';
        document.getElementById('supa-room-input').value = room;
        C.showSyncBanner('為保護越南專案資料，代號已自動鎖定為 osaka_2026_couple');
      }
      localStorage.setItem(C.SUPA_CFG_KEY, JSON.stringify({ url, key, room }));
      if (!url || !key) {
        C.showSyncBanner('已切換為純本機儲存模式');
        return;
      }
      C.showSyncBanner('正在與 Supabase (trip_store) 同步...');
      await window.pullFromSupabaseAsync(false);
      await window.pushToSupabaseAsync();
      C.showSyncBanner('✓ Supabase 雲端連線與雙向同步完成！');
    });

    document.getElementById('supa-copy-sql-btn').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(SUPABASE_CREATE_SQL);
        C.showSyncBanner('✓ 已複製 Supabase 建表 SQL 語法！請至 Supabase SQL Editor 貼上執行');
      } catch (e) {
        C.showSyncBanner('複製失敗，請查看說明文件');
      }
    });

    // 免後端備份碼匯出/匯入
    document.getElementById('export-json-btn').addEventListener('click', async () => {
      try {
        const code = JSON.stringify(C.getState());
        await navigator.clipboard.writeText(code);
        C.showSyncBanner('✓ 已複製目前旅冊資料碼，可透過 LINE 傳給老婆貼上同步！');
      } catch (e) {
        C.showSyncBanner('複製失敗');
      }
    });

    document.getElementById('import-json-btn').addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        const parsed = JSON.parse(text);
        if (!parsed || !parsed.daysMap) {
          C.showSyncBanner('剪貼簿內容不是有效的旅冊資料碼');
          return;
        }
        C.setState(parsed);
        C.saveLocalState(true);
        window.renderAll();
        C.showSyncBanner('✓ 已成功匯入並更新旅冊資料！');
      } catch (e) {
        C.showSyncBanner('請先複製對方傳來的資料碼，並允許剪貼簿讀取權限');
      }
    });

    // 3.3 換人必須輸入對方名字防誤觸
    document.getElementById('switch-user-btn').addEventListener('click', () => {
      const val = document.getElementById('switch-user-input').value.trim();
      const msgEl = document.getElementById('switch-user-msg');
      if (val !== '老公' && val !== '老婆') {
        msgEl.textContent = '請完整輸入「老公」或「老婆」才能切換身份';
        return;
      }
      C.setUser(val);
      document.getElementById('switch-user-input').value = '';
      msgEl.textContent = '';
      window.renderHeaderAndIdentity();
      window.renderPlaces();
      window.renderMoreSection();
      C.showSyncBanner(`已切換這支手機的身份為：${val}`);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    window.initTimelineFormEvents();
    window.initExpenseEvents();
    window.initPlaceEvents();
    window.initPhraseCardEvents();
    initGlobalEvents();

    const initialHash = (window.location.hash || '#tl').replace('#', '');
    switchTab(initialHash, false);
    window.renderAll();

    // 若第一次打開還沒選身份，跳出全螢幕選單
    if (!C.getUser()) {
      document.getElementById('identity-modal').classList.add('open');
    }

    // 啟動時更新即時匯率與雲端同步
    window.refreshExchangeRate(false);
    window.pullFromSupabaseAsync(false);

    // 註冊離線 Service Worker
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  });
})();
