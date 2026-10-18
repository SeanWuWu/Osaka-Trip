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
      quickCapsules: Array.isArray(st.quickCapsules) ? st.quickCapsules : undefined,
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
      if (window.updateSyncStatusUI) window.updateSyncStatusUI(true, '雲端已連線');
    } catch (err) {
      if (window.updateSyncStatusUI) window.updateSyncStatusUI(false, '本機儲存中');
      C.showSyncBanner('雲端暫時無法連線，已安全保存在這支手機');
    }
  };

  window.updateSyncStatusUI = function (isOk, text) {
    const dot = document.getElementById('sync-dot-live');
    const btn = document.getElementById('header-sync-status');
    if (dot) dot.classList.toggle('offline', !isOk);
    if (btn && text) btn.setAttribute('title', `雲端同步狀態：${text}（點擊診斷）`);
    const txt = document.getElementById('sync-text-live');
    if (txt && text) txt.textContent = text;
  };

  window.pullFromSupabaseAsync = async function (isDiagnosticOnly = false) {
    const cfg = getSupaConfig();
    if (!cfg.url || !cfg.key) {
      if (window.updateSyncStatusUI) window.updateSyncStatusUI(false, '本機模式');
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
      if (!res.ok) {
        if (window.updateSyncStatusUI) window.updateSyncStatusUI(false, '雲端回應異常');
        return { ok: false, msg: `雲端回應狀態碼 ${res.status}` };
      }
      const rows = await res.json();
      if (window.updateSyncStatusUI) window.updateSyncStatusUI(true, '雲端已連線');
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
      if (window.updateSyncStatusUI) window.updateSyncStatusUI(false, '本機離線中');
      return { ok: false, msg: '網路或雲端連線失敗，本機資料完好無損' };
    }
  };

  // 3.1 頂部眉題與副標（依日本時間計算倒數，保持極簡乾淨）
  window.renderHeaderAndIdentity = function () {
    const eyebrowEl = document.getElementById('header-eyebrow');
    const subEl = document.getElementById('header-subtitle');
    const moreUserLabel = document.getElementById('more-current-user');

    const u = C.getUser();
    if (moreUserLabel) moreUserLabel.textContent = u || '尚未選擇';

    const nowJst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
    const todayMidnight = new Date(nowJst.getFullYear(), nowJst.getMonth(), nowJst.getDate());
    const startMidnight = new Date(2026, 9, 22); // 10/22
    const endMidnight = new Date(2026, 9, 25);   // 10/25
    const diffDays = Math.round((startMidnight - todayMidnight) / 86400000);

    if (diffDays > 0) {
      eyebrowEl.textContent = `OSAKA · KYOTO BY THE SEA · D-${diffDays}`;
      subEl.textContent = `大阪・環球影城・海之京都四日旅`;
    } else if (todayMidnight >= startMidnight && todayMidnight <= endMidnight) {
      const dayNum = Math.round((todayMidnight - startMidnight) / 86400000) + 1;
      eyebrowEl.textContent = `OSAKA · KYOTO BY THE SEA · DAY ${dayNum}`;
      const daySubtitles = [
        'Day 1：抵達關西・難波・心齋橋・道頓堀',
        'Day 2：日本環球影城 USJ 全日狂歡',
        'Day 3：海之京都・丹後列車・天橋立・伊根舟屋',
        'Day 4：中崎町老屋咖啡・梅田採買・平安返台'
      ];
      subEl.textContent = daySubtitles[dayNum - 1] || daySubtitles[0];
    } else {
      eyebrowEl.textContent = 'OSAKA · KYOTO BY THE SEA · 2026';
      subEl.textContent = '大阪・環球影城・海之京都四日旅';
    }
  };
})();

// ==================== Part 3: 天氣、匯率條與 M1 時間表渲染 ====================
(function () {
  const C = window.__APP_CORE;

  function wmoToDesc(code) {
    if (code === 0 || code === 1) return '☀️ 晴朗';
    if (code === 2) return '⛅ 晴時多雲';
    if (code === 3) return '☁️ 多雲時陰';
    if (code >= 45 && code <= 48) return '🌫️ 薄霧';
    if (code >= 51 && code <= 67) return '🌧️ 短暫雨';
    if (code >= 80 && code <= 82) return '🌦️ 陣雨';
    if (code >= 95) return '⛈️ 雷陣雨';
    return '⛅ 晴時多雲';
  }

  // 天氣抓取（清晰 4 列直式清單：Day 1 ~ Day 4 逐日一列，不再擠成四宮格）
  window.fetchAndRenderWeather = async function () {
    const box = document.getElementById('weather-content');
    if (!box) return;
    box.innerHTML = '<div style="font-size:12px;color:var(--sub);padding:6px 0;">正在查詢大阪與丹後地區氣象資料...</div>';

    // 10 月下旬日本氣象廳歷年氣候平均基準（當距離出發超過 16 天、或離線時顯示）
    const defaultDays = [
      { day: 'Day 1', date: '10/22 (四)', loc: '大阪難波・心齋橋・道頓堀', cond: '☀️ 晴時多雲', tMin: 15, tMax: 23, pop: 20 },
      { day: 'Day 2', date: '10/23 (五)', loc: '日本環球影城 USJ・難波', cond: '☀️ 晴朗舒適', tMin: 14, tMax: 22, pop: 15 },
      { day: 'Day 3', date: '10/24 (六)', loc: '京都天橋立・伊根灣（海邊偏涼）', cond: '⛅ 多雲海風', tMin: 12, tMax: 19, pop: 30 },
      { day: 'Day 4', date: '10/25 (日)', loc: '中崎町・梅田・關西機場', cond: '☀️ 晴時多雲', tMin: 14, tMax: 22, pop: 20 }
    ];

    function buildRowsHtml(rows, badgeText, currentNote) {
      const listHtml = rows.map((r) => `
        <div class="wx-row">
          <div class="wx-left">
            <div class="wx-day-line">
              <span class="wx-day-tag">${r.day}</span>
              <span class="wx-date-txt">${r.date}</span>
              <span class="wx-cond">${r.cond}</span>
            </div>
            <div class="wx-loc-txt">${r.loc}</div>
          </div>
          <div class="wx-right">
            <div class="wx-temp">${r.tMin}°~${r.tMax}°C</div>
            <div class="wx-pop">💧 降雨 ${r.pop}%</div>
          </div>
        </div>
      `).join('');

      return `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:4px;">
          <span style="font-size:11.5px;color:var(--sub);">${currentNote}</span>
          <span class="wx-badge">${badgeText}</span>
        </div>
        <div class="wx-list">${listHtml}</div>
        <div class="wx-foot">
          <span>穿衣建議：薄長袖＋防風外套（天橋立海邊較涼）</span>
          <div class="wx-links">
            <a href="https://tenki.jp/forecast/6/30/6200/27100/" target="_blank" rel="noopener">↗ 大阪 10日預報</a>
            <a href="https://tenki.jp/forecast/6/29/6120/26405/" target="_blank" rel="noopener">↗ 天橋立/伊根預報</a>
          </div>
        </div>
      `;
    }

    try {
      // 1. 先嘗試抓取 2026-10-22 ~ 2026-10-25 區間預報
      const url = 'https://api.open-meteo.com/v1/forecast?latitude=34.6937,35.56&longitude=135.5023,135.19&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FTokyo&start_date=2026-10-22&end_date=2026-10-25';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const osaka = Array.isArray(data) ? data[0] : data;
        const kyotoNorth = Array.isArray(data) && data[1] ? data[1] : osaka;
        if (osaka && osaka.daily && osaka.daily.temperature_2m_max && osaka.daily.temperature_2m_max[0] !== null && osaka.daily.temperature_2m_max[0] !== undefined) {
          const srcs = [osaka, osaka, kyotoNorth, osaka];
          const liveRows = defaultDays.map((d, idx) => {
            const s = srcs[idx].daily;
            const tMax = s.temperature_2m_max && s.temperature_2m_max[idx] != null ? Math.round(s.temperature_2m_max[idx]) : d.tMax;
            const tMin = s.temperature_2m_min && s.temperature_2m_min[idx] != null ? Math.round(s.temperature_2m_min[idx]) : d.tMin;
            const pop = s.precipitation_probability_max && s.precipitation_probability_max[idx] != null ? Math.round(s.precipitation_probability_max[idx]) : d.pop;
            const code = s.weather_code && s.weather_code[idx] != null ? s.weather_code[idx] : 1;
            return { ...d, cond: wmoToDesc(code), tMin, tMax, pop };
          });
          box.innerHTML = buildRowsHtml(liveRows, 'Open-Meteo 即時預報', '已連線更新 10/22–10/25 每日預報');
          return;
        }
      }

      // 2. 若距離出發超過 16 天預報窗，抓取目前大阪即時氣溫供參考，並顯示 4 列清晰氣候表
      let nowNote = '出發前 16 天內將自動切換為每日即時預報';
      try {
        const nowRes = await fetch('https://api.open-meteo.com/v1/forecast?latitude=34.6937&longitude=135.5023&current=temperature_2m,weather_code&timezone=Asia%2FTokyo');
        if (nowRes.ok) {
          const nowJson = await nowRes.json();
          if (nowJson && nowJson.current && nowJson.current.temperature_2m != null) {
            const curT = Math.round(nowJson.current.temperature_2m);
            const curDesc = wmoToDesc(nowJson.current.weather_code || 1);
            nowNote = `目前大阪即時：${curDesc} ${curT}°C`;
          }
        }
      } catch (e2) {}

      box.innerHTML = buildRowsHtml(defaultDays, '10月下旬歷年氣候', nowNote);
    } catch (e) {
      box.innerHTML = buildRowsHtml(defaultDays, '10月下旬歷年氣候', '離線模式：顯示 10 月下旬平均氣候');
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
    const fxpRateEl = document.getElementById('fxp-rate');

    if (fxpRateEl) {
      fxpRateEl.textContent = `1 ¥ ≈ ${rate.toFixed(3)}$`;
    }
    const fxBtn = document.getElementById('fx-btn');
    if (fxBtn) {
      fxBtn.setAttribute('title', `日圓 ⇄ 台幣即時換匯 (1¥ ≈ ${rate.toFixed(3)}$)`);
    }

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
  // 1. 南海電鐵（d1-2 去程）：開啟「關西國際機場 ➔ APA 飯店〈大阪難波車站前塔〉」大眾運輸路線規劃（搭乘南海電鐵）
  // 2. 南海電鐵（d4-7 返程）：開啟「APA 飯店〈大阪難波車站前塔〉 ➔ 關西國際機場第1航廈」大眾運輸路線規劃
  // 3. 其他通勤路段（如 d2-1 飯店往環球影城、d4-6 梅田回飯店）亦開啟大眾運輸路線規劃
  // 4. 航班開機場；一般景點開 Google 地圖定位
  function getMapUrlForItem(item) {
    const baseId = String(item.id || '').split('-mv-')[0];
    const text = `${item.title || ''} ${item.note || ''}`;
    const kix = '関西国際空港 Kansai International Airport';
    const kixT1 = '関西国際空港 第1ターミナル Kansai Airport Terminal 1';
    const apa = 'アパホテル＆リゾート 大阪なんば駅前タワー 1-2-13 Minatomachi, Naniwa-ku, Osaka';
    const usj = 'ユニバーサル・スタジオ・ジャパン Universal Studios Japan';

    // 南海電鐵：機場 ⇄ 飯店 大眾運輸路徑規劃
    if (baseId === 'd1-2' || (/南海[電地]鐵/.test(text) && !/前往關西機場|往機場/.test(item.title || ''))) {
      return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(kix)}&destination=${encodeURIComponent(apa)}&travelmode=transit`;
    }
    if (baseId === 'd4-7' || (/南海[電地]鐵/.test(text) && /前往關西機場|往機場/.test(item.title || ''))) {
      return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(apa)}&destination=${encodeURIComponent(kixT1)}&travelmode=transit`;
    }
    if (baseId === 'd2-1') {
      return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(apa)}&destination=${encodeURIComponent(usj)}&travelmode=transit`;
    }
    if (baseId === 'd4-6') {
      return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent('大阪梅田駅 Umeda Station')}&destination=${encodeURIComponent(apa)}&travelmode=transit`;
    }

    let query = item.title;
    if (item.flight) {
      query = kix;
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

  function getTimelineBadges(it) {
    const baseId = String(it.id || '').split('-mv-')[0];
    const title = String(it.title || '');
    const badges = [];

    // 若使用者手動指定了標籤，優先依照指定標籤顯示
    if (it.tag === '通勤') {
      badges.push({ text: '通勤', cls: 'tl-commute-badge', cardCls: 'is-commute' });
      return badges;
    } else if (it.tag === '住宿') {
      badges.push({ text: '住宿', cls: 'tl-hotel-badge', cardCls: 'is-hotel' });
      return badges;
    } else if (it.tag === '航班') {
      badges.push({ text: '航班', cls: 'tl-flight-badge', cardCls: 'is-flight' });
      return badges;
    }

    const isFlight = !!it.flight || /航班|起飛|VZ566|GK057/.test(title);
    if (isFlight) {
      badges.push({ text: '航班', cls: 'tl-flight-badge', cardCls: 'is-flight' });
    }

    const isCommute = !isFlight && (
      ['d1-2', 'd2-1', 'd3-1', 'd3-2', 'd3-6', 'd4-6', 'd4-7'].includes(baseId) ||
      /南海[電地]鐵|搭車|搭乘|搭御堂筋線|地鐵|JR|專車返回|巴士移動|集合出發|前往日本環球影城|前往關西機場/.test(title)
    );
    if (isCommute) {
      badges.push({ text: '通勤', cls: 'tl-commute-badge', cardCls: 'is-commute' });
    }

    const isHotel = !isFlight && (
      ['d1-3', 'd3-7', 'd4-1', 'd4-6'].includes(baseId) ||
      (/APA|飯店|入住|退房|寄放行李|領取行李/.test(title) && baseId !== 'd2-1')
    );
    if (isHotel) {
      badges.push({ text: '住宿', cls: 'tl-hotel-badge', cardCls: 'is-hotel' });
    }

    return badges;
  }

  window.renderTimeline = function () {
    const dayIdx = C.getDayIdx();
    const daysMeta = window.HANDBOOK_DATA.days;

    // 1. Day Tabs（加上星期：例如 Day 1 · 10/22 (四)）
    const tabsEl = document.getElementById('day-tabs');
    if (tabsEl) {
      tabsEl.innerHTML = daysMeta.map((d, i) => {
        const wkShort = String(d.weekday || '').replace('週', '');
        const dateWithWk = wkShort ? `${d.dateStr} (${wkShort})` : d.dateStr;
        return `
          <button type="button" class="day-tab ${i === dayIdx ? 'active' : ''}" data-day-idx="${i}" role="tab" aria-selected="${i === dayIdx}">
            <span class="day-tab-top">${d.label}</span>
            <span class="day-tab-sub">${dateWithWk}</span>
          </button>
        `;
      }).join('');
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
        listEl.innerHTML = items.map((it) => {
          const mapUrl = H.getMapUrlForItem(it);
          const badges = getTimelineBadges(it);
          const primaryCardCls = badges.length > 0 ? badges[0].cardCls : '';
          const badgesHtml = badges.map((b) => `<span class="${b.cls}">${b.text}</span>`).join('');
          return `
            <div class="tl-card ${primaryCardCls}" data-item-id="${it.id}">
              <div class="tl-card-main">
                <div class="tl-time-row">
                  <span class="tl-time">${escapeHtml(it.time)}</span>
                  ${badgesHtml}
                </div>
                <div class="tl-title">${escapeHtml(it.title)}</div>
                ${it.note ? `<div class="tl-note">${escapeHtml(it.note)}</div>` : ''}
              </div>
              <div class="tl-actions">
                <button type="button" class="tl-icon-btn tl-edit-btn" data-id="${it.id}" title="編輯行程" aria-label="編輯行程">
                  <svg width="13.5" height="13.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                </button>
                <div class="tl-drag-handle" tabindex="0" role="button" aria-label="按住六點拖曳排序" title="按住六點上下移動或拖到其他天" data-id="${it.id}">
                  <svg width="12" height="15" viewBox="0 0 14 16" fill="currentColor">
                    <circle cx="4" cy="3" r="1.4"/><circle cx="10" cy="3" r="1.4"/>
                    <circle cx="4" cy="8" r="1.4"/><circle cx="10" cy="8" r="1.4"/>
                    <circle cx="4" cy="13" r="1.4"/><circle cx="10" cy="13" r="1.4"/>
                  </svg>
                </div>
                <a href="${mapUrl}" target="_blank" rel="noopener" class="tl-icon-btn tl-map-btn" title="在 Google 地圖開啟" aria-label="開啟地圖">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                </a>
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
        listEl.querySelectorAll('.tl-drag-handle').forEach((handle) => {
          bindDragHandle(handle);
        });
      }
    }
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

    const presetSel = document.getElementById('tl-time-preset-select');
    if (presetSel) {
      presetSel.addEventListener('change', () => {
        const tok = presetSel.value;
        FS.setActiveToken(tok);
        const defaultTimes = {
          '早餐': ['08', '30'],
          '上午': ['10', '00'],
          '午餐': ['12', '30'],
          '下午': ['14', '30'],
          '傍晚': ['17', '00'],
          '晚餐': ['18', '30'],
          '宵夜': ['21', '30']
        };
        if (defaultTimes[tok]) {
          const [defH, defM] = defaultTimes[tok];
          document.getElementById('tl-start-hour').value = defH;
          ensureMinuteOption('tl-start-min', defM);
        }
        syncTimeFormUI();
      });
    }

    [sh, sm, eh, em].forEach((selEl) => {
      selEl.addEventListener('change', () => {
        if (FS.getActiveToken() === '全天') {
          FS.setActiveToken('');
          syncTimeFormUI();
        }
      });
    });

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
    const presetSel = document.getElementById('tl-time-preset-select');

    if (presetSel) {
      presetSel.value = tok || '';
    }

    document.querySelectorAll('#tl-token-pills .token-pill').forEach((b) => {
      const bTok = b.getAttribute('data-tok');
      b.classList.toggle('active', (tok === '' && bTok === '時鐘') || bTok === tok);
    });

    if (tok === '全天') {
      if (wheelArea) {
        wheelArea.style.opacity = '0.35';
        wheelArea.style.pointerEvents = 'none';
      }
      if (endWrap) endWrap.style.display = 'none';
      if (toggleEndBtn) toggleEndBtn.style.display = 'none';
      if (preview) preview.textContent = `將儲存為：「全天」行程`;
    } else {
      if (wheelArea) {
        wheelArea.style.opacity = '1';
        wheelArea.style.pointerEvents = 'auto';
        wheelArea.style.display = 'flex';
      }
      if (endWrap) endWrap.style.display = hasEnd ? 'grid' : 'none';
      if (toggleEndBtn) {
        toggleEndBtn.style.display = hasEnd ? 'none' : 'inline-block';
        toggleEndBtn.textContent = '＋ 設定結束時間';
      }
      if (preview) preview.textContent = tok ? `時段推薦：「${tok}」（可微調右側時分）` : '';
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

  let restoreDayTimer = null;
  let restoreDayConfirm = false;

  function resetRestoreDayBtn() {
    restoreDayConfirm = false;
    if (restoreDayTimer) {
      clearTimeout(restoreDayTimer);
      restoreDayTimer = null;
    }
    const btn = document.getElementById('tl-restore-day-btn');
    if (btn) {
      btn.textContent = '恢復本日預設行程';
      btn.style.color = 'var(--sub)';
      btn.style.fontWeight = 'normal';
    }
  }

  function setTimelineTagPills(tag) {
    const curTag = tag || '';
    const inp = document.getElementById('tl-custom-tag');
    if (inp) inp.value = curTag;
    const typeSel = document.getElementById('tl-type-select');
    if (typeSel) typeSel.value = curTag;
    document.querySelectorAll('#tl-tag-pills .badge-tag-btn').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-tag') === curTag);
    });
  }

  function openTlModal(isEdit, title) {
    const backdrop = document.getElementById('tl-modal-backdrop');
    const titleEl = document.getElementById('tl-modal-title');
    if (titleEl) titleEl.textContent = title || (isEdit ? '✏️ 編輯行程' : '＋ 新增行程');
    if (backdrop) backdrop.classList.add('open');
  }

  function closeTlModal() {
    const backdrop = document.getElementById('tl-modal-backdrop');
    if (backdrop) backdrop.classList.remove('open');
    resetRestoreDayBtn();
  }

  window.openTlFormForAdd = function () {
    document.getElementById('tl-edit-id').value = '';
    document.getElementById('tl-title-input').value = '';
    document.getElementById('tl-note-input').value = '';
    document.getElementById('tl-form-error').textContent = '';
    document.getElementById('tl-submit-btn').textContent = '儲存行程';
    document.getElementById('tl-delete-btn').style.display = 'none';
    setTimelineTagPills('');
    FS.setDeleteConfirm(false);
    FS.setOverwriteConfirm(false);
    setFormTimeValue('10:00');
    openTlModal(false, '＋ 新增行程');
  };

  window.openTlFormForEdit = function (itemId) {
    const dayIdx = C.getDayIdx();
    const items = C.getState().daysMap[dayIdx] || [];
    const item = items.find((x) => x.id === itemId && !x.movedAway);
    if (!item) return;

    document.getElementById('tl-edit-id').value = item.id;
    document.getElementById('tl-title-input').value = item.title;
    document.getElementById('tl-note-input').value = item.note || '';
    document.getElementById('tl-form-error').textContent = '';
    document.getElementById('tl-submit-btn').textContent = '儲存修改';

    const delBtn = document.getElementById('tl-delete-btn');
    delBtn.style.display = 'block';
    delBtn.textContent = '刪除此筆行程';
    delBtn.classList.remove('confirming');

    setTimelineTagPills(item.tag || '');
    FS.setDeleteConfirm(false);
    FS.setOverwriteConfirm(false);
    setFormTimeValue(item.time);
    openTlModal(true, '✏️ 編輯行程');
  };

  window.initTimelineFormEvents = function () {
    populateTimeWheels();

    // 類型下拉與膠囊切換（通勤、住宿、航班；未選則為一般）
    const typeSelect = document.getElementById('tl-type-select');
    if (typeSelect) {
      typeSelect.addEventListener('change', () => {
        setTimelineTagPills(typeSelect.value);
      });
    }
    document.querySelectorAll('#tl-tag-pills .badge-tag-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const clickedTag = btn.getAttribute('data-tag');
        const curTag = document.getElementById('tl-custom-tag').value;
        const nextTag = curTag === clickedTag ? '' : clickedTag;
        setTimelineTagPills(nextTag);
      });
    });

    // APA 飯店計程車卡彈窗（委派監聽，支援更多分頁動態渲染）
    const hotelBackdrop = document.getElementById('hotel-modal-backdrop');
    const hotelCloseBtn = document.getElementById('hotel-modal-close');
    const hotelCopyBtn = document.getElementById('hotel-copy-addr-btn');
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('#hotel-taxi-card-btn');
      if (btn && hotelBackdrop) {
        hotelBackdrop.classList.add('open');
      }
    });
    if (hotelCloseBtn && hotelBackdrop) {
      hotelCloseBtn.addEventListener('click', () => {
        hotelBackdrop.classList.remove('open');
      });
    }
    if (hotelBackdrop) {
      hotelBackdrop.addEventListener('click', (e) => {
        if (e.target === hotelBackdrop) hotelBackdrop.classList.remove('open');
      });
    }
    if (hotelCopyBtn) {
      hotelCopyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText('〒556-0017 大阪府大阪市浪速区湊町1丁目2-13');
          C.showSyncBanner('✓ 已複製 APA 飯店日文地址到剪貼簿');
        } catch (err) {
          C.showSyncBanner('複製失敗，請手動複製');
        }
      });
    }

    // 新增行程彈窗按鈕
    document.getElementById('tl-add-trigger').addEventListener('click', () => {
      C.requireIdentity(() => {
        window.openTlFormForAdd();
      });
    });

    const toggleEndBtn = document.getElementById('tl-toggle-end-btn');
    if (toggleEndBtn) {
      toggleEndBtn.addEventListener('click', () => {
        FS.setHasEndTime(true);
        const sh = parseInt(document.getElementById('tl-start-hour').value || '9', 10);
        const nextH = String((sh + 1) % 24).padStart(2, '0');
        const nextM = document.getElementById('tl-start-min').value || '00';
        document.getElementById('tl-end-hour').value = nextH;
        ensureMinuteOption('tl-end-min', nextM);
        syncTimeFormUI();
      });
    }

    const removeEndBtn = document.getElementById('tl-remove-end-btn');
    if (removeEndBtn) {
      removeEndBtn.addEventListener('click', () => {
        FS.setHasEndTime(false);
        syncTimeFormUI();
      });
    }

    document.getElementById('tl-cancel-btn').addEventListener('click', closeTlModal);
    const tlCloseBtn = document.getElementById('tl-modal-close');
    if (tlCloseBtn) tlCloseBtn.addEventListener('click', closeTlModal);
    const tlBackdrop = document.getElementById('tl-modal-backdrop');
    if (tlBackdrop) {
      tlBackdrop.addEventListener('click', (e) => {
        if (e.target === tlBackdrop) closeTlModal();
      });
    }

    document.getElementById('tl-form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (!C.requireIdentity(() => {})) return;

      const editId = document.getElementById('tl-edit-id').value;
      const title = document.getElementById('tl-title-input').value.trim();
      const note = document.getElementById('tl-note-input').value.trim();
      const tag = document.getElementById('tl-custom-tag').value.trim();
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
        item.tag = tag || undefined;
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
          tag: tag || undefined,
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
      closeTlModal();
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
      closeTlModal();
      window.renderTimeline();
      H.showTlStatus('已刪除該筆行程');
    });

    // 恢復本日原行程（兩段式防呆確認，4秒未確認自動回覆）
    document.getElementById('tl-restore-day-btn').addEventListener('click', () => {
      const btn = document.getElementById('tl-restore-day-btn');
      if (!restoreDayConfirm) {
        restoreDayConfirm = true;
        btn.textContent = '⚠️ 確定要覆蓋並恢復本日預設？（再按一次）';
        btn.style.color = '#B0432E';
        btn.style.fontWeight = '700';
        restoreDayTimer = setTimeout(resetRestoreDayBtn, 4000);
        return;
      }
      resetRestoreDayBtn();
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
      closeTlModal();
      window.renderTimeline();
      H.showTlStatus(`已恢復 ${dMeta.label} 預設行程`);
    });
  };
})();

// ==================== Part 5: M2 記帳（My-Bank 快速記帳 ＋ 總花費統計與分類明細） ====================
(function () {
  const C = window.__APP_CORE;
  const esc = window.__escapeHtml;

  let currentSplitSelection = ['老公', '老婆'];
  let expDeleteConfirm = false;
  let quickPayer = '老公';
  let quickCurr = 'JPY';
  let expListExpanded = false;

  const DEFAULT_CAPSULES = [
    { icon: '🍜', name: '拉麵／正餐', cat: '美食', jpy: 2500, twd: 550, presetsJpy: [1200, 2000, 2500, 3500, 5000], presetsTwd: [250, 400, 550, 800, 1200] },
    { icon: '🥩', name: '燒肉／大餐', cat: '美食', jpy: 10000, twd: 2200, presetsJpy: [5000, 8000, 10000, 15000, 20000], presetsTwd: [1000, 1600, 2200, 3200, 4500] },
    { icon: '🏪', name: '超商／零食', cat: '美食', jpy: 800, twd: 180, presetsJpy: [300, 500, 800, 1200, 2000], presetsTwd: [60, 100, 180, 260, 450] },
    { icon: '☕', name: '咖啡／甜點', cat: '美食', jpy: 1200, twd: 260, presetsJpy: [600, 900, 1200, 1800, 2500], presetsTwd: [120, 200, 260, 400, 550] },
    { icon: '🚇', name: '地鐵／交通', cat: '交通', jpy: 600, twd: 130, presetsJpy: [240, 480, 600, 1000, 3000], presetsTwd: [50, 100, 130, 220, 650] },
    { icon: '🛍️', name: '藥妝／伴手禮', cat: '購物/伴手禮', jpy: 5000, twd: 1100, presetsJpy: [2000, 3500, 5000, 10000, 15000], presetsTwd: [450, 750, 1100, 2200, 3300] }
  ];

  function getCapsules() {
    const st = C.getState();
    if (!Array.isArray(st.quickCapsules) || st.quickCapsules.length !== DEFAULT_CAPSULES.length) {
      st.quickCapsules = DEFAULT_CAPSULES.map((c) => ({ ...c }));
    } else {
      st.quickCapsules.forEach((c) => {
        if (c.cat === '伴手禮・購物') c.cat = '購物/伴手禮';
      });
    }
    return st.quickCapsules;
  }

  function spawnParticle(e, text) {
    const el = document.createElement('div');
    el.className = 'floating-particle';
    el.textContent = text;
    const x = (e && e.clientX) ? e.clientX : window.innerWidth / 2;
    const y = (e && e.clientY) ? e.clientY : 160;
    el.style.left = `${Math.min(window.innerWidth - 90, Math.max(90, x))}px`;
    el.style.top = `${Math.max(60, y - 12)}px`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1100);
  }

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

  function renderQuickCapsules() {
    const grid = document.getElementById('exp-capsule-grid');
    if (!grid) return;
    const caps = getCapsules();
    const sym = quickCurr === 'JPY' ? '¥' : 'NT$';

    document.querySelectorAll('#quick-payer-seg .quick-seg-btn').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-payer') === quickPayer);
    });
    document.querySelectorAll('#quick-curr-seg .quick-seg-btn').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-curr') === quickCurr);
    });

    grid.innerHTML = caps.map((c, idx) => {
      const price = quickCurr === 'JPY' ? c.jpy : c.twd;
      return `
        <div class="capsule-btn" data-cap-idx="${idx}">
          <div class="cap-left">
            <span class="cap-icon">${c.icon}</span>
            <div class="cap-info">
              <div class="cap-name">${esc(c.name)}</div>
              <div class="cap-price">${sym} ${Number(price).toLocaleString()}</div>
            </div>
          </div>
          <button type="button" class="zap-btn" data-zap-idx="${idx}" title="一秒快速記帳">⚡</button>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('.zap-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.getAttribute('data-zap-idx'), 10);
        C.requireIdentity(() => {
          const cap = getCapsules()[idx];
          if (!cap) return;
          const amount = quickCurr === 'JPY' ? cap.jpy : cap.twd;
          const st = C.getState();
          st.expenses.push({
            id: `exp-${Date.now().toString(36)}`,
            title: `${cap.icon} ${cap.name}`,
            amount,
            currency: quickCurr,
            category: cap.cat,
            payer: quickPayer,
            split: ['老公', '老婆'],
            note: '⚡ 快速秒記',
            who: C.getUser() || quickPayer,
            upd: Date.now()
          });
          C.saveLocalState(true);
          window.renderExpenses();
          spawnParticle(e, `⚡ 已記 ${cap.name} ${sym}${amount.toLocaleString()}`);
          const statusEl = document.getElementById('quick-exp-status');
          if (statusEl) statusEl.textContent = `✓ 剛記下：${cap.name} ${sym}${amount.toLocaleString()}（${quickPayer}付）`;
        });
      });
    });

    grid.querySelectorAll('.capsule-btn').forEach((card) => {
      card.addEventListener('click', () => {
        const idx = parseInt(card.getAttribute('data-cap-idx'), 10);
        C.requireIdentity(() => openExpFormFromCapsule(idx));
      });
    });
  }

  window.renderExpenses = function () {
    renderQuickCapsules();
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

    const needCollapse = sorted.length > 10;
    const displayList = (needCollapse && !expListExpanded) ? sorted.slice(0, 10) : sorted;

    let itemsHtml = displayList.map((ex) => {
      const twd = toTwdInt(ex.amount, ex.currency);
      const isPendingZero = Number(ex.amount) === 0;
      const catColor = getCatColor(ex.category);
      const amtDisplay = isPendingZero
        ? '<span style="color:var(--accent);font-size:12.5px;font-weight:700;">金額待補（點鉛筆填入）</span>'
        : ex.currency === 'JPY'
          ? `<div style="font-size:14px;font-weight:700;color:var(--text);">¥ ${Number(ex.amount).toLocaleString()}</div><div style="font-size:11.5px;color:var(--sub);">≈ NT$ ${twd.toLocaleString()}</div>`
          : `<div style="font-size:14px;font-weight:700;color:var(--text);">NT$ ${Number(ex.amount).toLocaleString()}</div>`;

      const dt = ex.upd ? new Date(ex.upd) : null;
      const timeStr = dt
        ? `${dt.getMonth() + 1}/${dt.getDate()} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`
        : '';

      return `
        <div class="exp-item-card" style="border-left:3px solid ${catColor};">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px;gap:6px;">
              <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;">
                <span style="font-size:11px;color:${catColor};border:1px solid ${catColor};border-radius:3px;padding:0 5px;">${esc(ex.category)}</span>
                <span style="font-size:11.5px;color:var(--sub);">${esc(ex.payer)} 付款 · ${esc((ex.split || ['老公', '老婆']).join('、'))}</span>
              </div>
              ${timeStr ? `<span style="font-size:11px;color:var(--muted);white-space:nowrap;">${timeStr}</span>` : ''}
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

    if (needCollapse) {
      itemsHtml += `
        <button type="button" id="exp-toggle-more-btn" class="exp-toggle-more-btn">
          ${expListExpanded ? '收合帳目（只顯示最新 10 筆） ▴' : `展開其餘 ${sorted.length - 10} 筆帳目 ▾`}
        </button>
      `;
    }

    listEl.innerHTML = itemsHtml;

    const toggleMoreBtn = document.getElementById('exp-toggle-more-btn');
    if (toggleMoreBtn) {
      toggleMoreBtn.addEventListener('click', () => {
        expListExpanded = !expListExpanded;
        window.renderExpenses();
      });
    }

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

  function syncSliderAndStepUI() {
    const cur = document.getElementById('exp-currency-select').value || 'JPY';
    const amt = Math.max(0, Math.round(parseFloat(document.getElementById('exp-amount-input').value) || 0));
    const slider = document.getElementById('exp-price-slider');
    const liveNum = document.getElementById('exp-live-num');
    const liveConv = document.getElementById('exp-live-conv');
    const stepRow = document.getElementById('exp-step-row');
    const chipsBox = document.getElementById('exp-preset-chips');
    const capIdxStr = document.getElementById('exp-capsule-idx').value;
    const pinBtn = document.getElementById('exp-pin-default-btn');

    if (pinBtn) {
      pinBtn.style.display = capIdxStr !== '' ? 'inline-block' : 'none';
    }

    if (slider) {
      if (cur === 'JPY') {
        slider.max = String(Math.max(20000, amt));
        slider.step = '100';
      } else {
        slider.max = String(Math.max(5000, amt));
        slider.step = '50';
      }
      slider.value = String(amt);
    }

    if (liveNum) {
      liveNum.textContent = cur === 'JPY' ? `¥ ${amt.toLocaleString()}` : `NT$ ${amt.toLocaleString()}`;
    }
    if (liveConv) {
      if (cur === 'JPY') {
        liveConv.textContent = `≈ NT$ ${toTwdInt(amt, 'JPY').toLocaleString()}`;
      } else {
        const rate = Number(C.getState().fxRate || 0.215);
        const jpyEq = rate > 0 ? Math.round(amt / rate) : 0;
        liveConv.textContent = `≈ ¥ ${jpyEq.toLocaleString()}`;
      }
    }

    if (stepRow) {
      const steps = cur === 'JPY' ? [-1000, -100, 100, 1000] : [-500, -100, 100, 500];
      stepRow.innerHTML = steps.map((s) =>
        `<button type="button" class="step-btn" data-step="${s}">${s > 0 ? '+' + s : s}</button>`
      ).join('');
      stepRow.querySelectorAll('.step-btn').forEach((b) => {
        b.addEventListener('click', () => {
          const delta = parseInt(b.getAttribute('data-step'), 10);
          const next = Math.max(0, (parseFloat(document.getElementById('exp-amount-input').value) || 0) + delta);
          document.getElementById('exp-amount-input').value = next;
          updateExpPreview();
        });
      });
    }

    if (chipsBox) {
      let presets = cur === 'JPY' ? [500, 1000, 2500, 5000, 10000] : [100, 300, 500, 1000, 2500];
      if (capIdxStr !== '') {
        const cap = getCapsules()[parseInt(capIdxStr, 10)];
        if (cap) presets = cur === 'JPY' ? (cap.presetsJpy || presets) : (cap.presetsTwd || presets);
      }
      const sym = cur === 'JPY' ? '¥' : '$';
      chipsBox.innerHTML = presets.map((p) =>
        `<button type="button" class="preset-chip ${amt === p ? 'active' : ''}" data-preset="${p}">${sym}${p.toLocaleString()}</button>`
      ).join('');
      chipsBox.querySelectorAll('.preset-chip').forEach((ch) => {
        ch.addEventListener('click', () => {
          document.getElementById('exp-amount-input').value = ch.getAttribute('data-preset');
          updateExpPreview();
        });
      });
    }
  }

  // 規格 M2：即時預覽每人分到多少，餘數放到付款人身上，加總必等於換算後台幣
  function updateExpPreview() {
    syncSliderAndStepUI();
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

  function openExpModal(titleText) {
    const titleEl = document.getElementById('exp-modal-title');
    if (titleEl && titleText) titleEl.textContent = titleText;
    const backdrop = document.getElementById('exp-modal-backdrop');
    if (backdrop) backdrop.classList.add('open');
  }

  function closeExpModal() {
    const backdrop = document.getElementById('exp-modal-backdrop');
    if (backdrop) backdrop.classList.remove('open');
  }

  function openExpFormFromCapsule(idx) {
    const cap = getCapsules()[idx];
    if (!cap) return;
    const amt = quickCurr === 'JPY' ? cap.jpy : cap.twd;
    document.getElementById('exp-edit-id').value = '';
    document.getElementById('exp-capsule-idx').value = String(idx);
    document.getElementById('exp-title-input').value = `${cap.icon} ${cap.name}`;
    document.getElementById('exp-amount-input').value = amt;
    document.getElementById('exp-currency-select').value = quickCurr;
    document.getElementById('exp-category-select').value = cap.cat;
    document.getElementById('exp-payer-select').value = quickPayer;
    document.getElementById('exp-note-input').value = '';
    document.getElementById('exp-form-error').textContent = '';
    document.getElementById('exp-delete-btn').style.display = 'none';
    currentSplitSelection = ['老公', '老婆'];
    expDeleteConfirm = false;
    renderSplitButtons();
    updateExpPreview();
    openExpModal(`⚡ 微調記帳：${cap.name}`);
  }

  function openExpFormForEdit(id) {
    const st = C.getState();
    const ex = (st.expenses || []).find((x) => x.id === id);
    if (!ex) return;
    document.getElementById('exp-edit-id').value = ex.id;
    document.getElementById('exp-capsule-idx').value = '';
    document.getElementById('exp-title-input').value = ex.title;
    document.getElementById('exp-amount-input').value = ex.amount > 0 ? ex.amount : 0;
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

    openExpModal('✏️ 修改帳目明細');
  }

  window.initExpenseEvents = function () {
    const catSel = document.getElementById('exp-category-select');
    if (catSel) {
      catSel.innerHTML = window.HANDBOOK_DATA.expenseCategories
        .map((c) => `<option value="${c.name}">${c.name}</option>`).join('');
    }
    if (C.getUser()) quickPayer = C.getUser();
    renderSplitButtons();
    renderQuickCapsules();

    document.querySelectorAll('#quick-payer-seg .quick-seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        quickPayer = btn.getAttribute('data-payer');
        renderQuickCapsules();
      });
    });

    document.querySelectorAll('#quick-curr-seg .quick-seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        quickCurr = btn.getAttribute('data-curr');
        renderQuickCapsules();
      });
    });

    document.getElementById('exp-reset-filter-btn').addEventListener('click', () => {
      C.setExpFilterCat('');
      window.renderExpenses();
    });

    document.getElementById('exp-add-trigger').addEventListener('click', () => {
      C.requireIdentity(() => {
        document.getElementById('exp-edit-id').value = '';
        document.getElementById('exp-capsule-idx').value = '';
        document.getElementById('exp-title-input').value = '';
        document.getElementById('exp-amount-input').value = quickCurr === 'JPY' ? 1500 : 300;
        document.getElementById('exp-currency-select').value = quickCurr;
        document.getElementById('exp-category-select').value = '美食';
        document.getElementById('exp-payer-select').value = quickPayer || C.getUser() || '老公';
        document.getElementById('exp-note-input').value = '';
        document.getElementById('exp-form-error').textContent = '';
        document.getElementById('exp-delete-btn').style.display = 'none';
        currentSplitSelection = ['老公', '老婆'];
        expDeleteConfirm = false;
        renderSplitButtons();
        updateExpPreview();
        openExpModal('＋ 手動輸入／自訂記帳');
      });
    });

    const closeBtn = document.getElementById('exp-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', closeExpModal);

    const backdropEl = document.getElementById('exp-modal-backdrop');
    if (backdropEl) {
      backdropEl.addEventListener('click', (e) => {
        if (e.target === backdropEl) closeExpModal();
      });
    }

    const sliderEl = document.getElementById('exp-price-slider');
    if (sliderEl) {
      sliderEl.addEventListener('input', () => {
        document.getElementById('exp-amount-input').value = sliderEl.value;
        updateExpPreview();
      });
    }

    const zeroBtn = document.getElementById('exp-zero-btn');
    if (zeroBtn) {
      zeroBtn.addEventListener('click', () => {
        document.getElementById('exp-amount-input').value = 0;
        updateExpPreview();
      });
    }

    const pinBtn = document.getElementById('exp-pin-default-btn');
    if (pinBtn) {
      pinBtn.addEventListener('click', () => {
        const idxStr = document.getElementById('exp-capsule-idx').value;
        if (idxStr === '') return;
        const cap = getCapsules()[parseInt(idxStr, 10)];
        if (!cap) return;
        const cur = document.getElementById('exp-currency-select').value;
        const amt = Math.max(0, Math.round(parseFloat(document.getElementById('exp-amount-input').value) || 0));
        const titleVal = document.getElementById('exp-title-input').value.trim();
        if (titleVal) {
          const cleanedName = titleVal.replace(cap.icon, '').trim() || titleVal;
          cap.name = cleanedName;
        }
        if (cur === 'JPY') cap.jpy = amt;
        else cap.twd = amt;
        C.saveLocalState(true);
        renderQuickCapsules();
        C.showSyncBanner(`📌 已將「${cap.name}」預設價設為 ${cur === 'JPY' ? '¥' : 'NT$'}${amt.toLocaleString()}`);
      });
    }

    ['exp-amount-input', 'exp-currency-select', 'exp-payer-select'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', updateExpPreview);
      if (el) el.addEventListener('change', updateExpPreview);
    });

    document.getElementById('exp-cancel-btn').addEventListener('click', closeExpModal);

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
      closeExpModal();
      window.renderExpenses();
      const sym = currency === 'JPY' ? '¥' : 'NT$';
      spawnParticle(null, `✓ 已儲存 ${title} ${sym}${amount.toLocaleString()}`);
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
      closeExpModal();
      window.renderExpenses();
      C.showSyncBanner('已刪除該筆帳目');
    });
  };
})();

// ==================== Part 6: M3 美食景點 與 M4 日文小卡 ====================
(function () {
  const C = window.__APP_CORE;
  const H = window.__TL_HELPERS;
  const esc = window.__escapeHtml;
  const plDeleteStageMap = {};
  let plFormDeleteConfirm = false;

  function openPlModal(isEdit, title) {
    const backdrop = document.getElementById('pl-modal-backdrop');
    const titleEl = document.getElementById('pl-modal-title');
    if (titleEl) titleEl.textContent = title || (isEdit ? '✏️ 編輯口袋名單' : '＋ 收藏推薦店家／景點');
    if (backdrop) backdrop.classList.add('open');
  }

  function closePlModal() {
    const backdrop = document.getElementById('pl-modal-backdrop');
    if (backdrop) backdrop.classList.remove('open');
    plFormDeleteConfirm = false;
  }

  function openPlFormForAdd() {
    document.getElementById('pl-edit-id').value = '';
    document.getElementById('pl-name-input').value = '';
    document.getElementById('pl-tag-input').value = '';
    document.getElementById('pl-note-input').value = '';
    document.getElementById('pl-form-error').textContent = '';
    document.getElementById('pl-submit-btn').textContent = '加入口袋名單';
    document.getElementById('pl-delete-btn').style.display = 'none';
    openPlModal(false, '＋ 收藏推薦店家／景點');
  }

  function openPlFormForEdit(plId) {
    const st = C.getState();
    const p = (st.places || []).find((x) => x.id === plId);
    if (!p) return;
    document.getElementById('pl-edit-id').value = p.id;
    document.getElementById('pl-name-input').value = p.n;
    document.getElementById('pl-tag-input').value = (p.tags || []).join('、');
    document.getElementById('pl-note-input').value = p.note || '';
    document.getElementById('pl-form-error').textContent = '';
    document.getElementById('pl-submit-btn').textContent = '儲存修改';
    const delBtn = document.getElementById('pl-delete-btn');
    delBtn.style.display = 'block';
    delBtn.textContent = '刪除此景點';
    delBtn.classList.remove('confirming');
    plFormDeleteConfirm = false;
    openPlModal(true, '✏️ 編輯景點／美食');
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

    // 2. 篩選與排序（自己加的最新在上，手冊原本列好的維持原順序）
    const filtered = activeTag === '全部'
      ? places.slice()
      : places.filter((p) => (p.tags || []).includes(activeTag));

    const userAdded = [];
    const handbookDefault = [];
    filtered.forEach((p) => {
      if (p.who) userAdded.push(p);
      else handbookDefault.push(p);
    });

    userAdded.sort((a, b) => (b.upd || 0) - (a.upd || 0));
    const finalOrdered = [...userAdded, ...handbookDefault];

    const listEl = document.getElementById('pl-list');
    const me = C.getUser();
    if (!listEl) return;

    listEl.innerHTML = finalOrdered.map((p) => {
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
            <div style="font-size:15px;font-weight:700;color:var(--text);">${esc(p.n)}</div>
            <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;">
              ${(p.tags || []).map((t) => `<span class="place-tag">${esc(t)}</span>`).join('')}
            </div>
          </div>
          <div style="font-size:13px;color:var(--sub);margin-bottom:8px;">${esc(p.note || '')}</div>
          <div class="place-btn-row" style="display:grid;grid-template-columns:1fr auto auto;gap:6px;">
            <a href="${mapUrl}" target="_blank" rel="noopener" class="btn-secondary" style="text-align:center;text-decoration:none;margin:0;padding:7px 10px;">📍 地圖導航</a>
            <button type="button" class="btn-secondary pl-add-to-tl-btn" data-name="${esc(p.n)}" data-note="${esc(p.note || '')}" style="margin:0;padding:7px 10px;white-space:nowrap;">＋ 排入行程</button>
            <button type="button" class="btn-secondary pl-edit-btn" data-pl-id="${p.id}" style="margin:0;padding:7px 10px;white-space:nowrap;">✏️ 編輯</button>
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

    // 綁定編輯
    listEl.querySelectorAll('.pl-edit-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const plId = btn.getAttribute('data-pl-id');
        C.requireIdentity(() => openPlFormForEdit(plId));
      });
    });

    // 綁定＋排入行程
    listEl.querySelectorAll('.pl-add-to-tl-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        C.requireIdentity(() => {
          const name = btn.getAttribute('data-name');
          const note = btn.getAttribute('data-note') || '';
          document.getElementById('pl-to-tl-name').value = name;
          document.getElementById('pl-to-tl-note').value = note;
          document.getElementById('pl-to-tl-target-name').textContent = `景點／店家：${name}`;
          document.getElementById('pl-to-tl-day').value = String(C.getDayIdx());
          document.getElementById('pl-to-tl-time').value = '12:00';
          document.getElementById('pl-to-tl-modal-backdrop').classList.add('open');
        });
      });
    });

    // 綁定刪除
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

  window.initPlaceEvents = function () {
    document.getElementById('pl-add-trigger').addEventListener('click', () => {
      C.requireIdentity(() => openPlFormForAdd());
    });

    document.getElementById('pl-cancel-btn').addEventListener('click', closePlModal);
    const plCloseBtn = document.getElementById('pl-modal-close');
    if (plCloseBtn) plCloseBtn.addEventListener('click', closePlModal);
    const plBackdrop = document.getElementById('pl-modal-backdrop');
    if (plBackdrop) {
      plBackdrop.addEventListener('click', (e) => {
        if (e.target === plBackdrop) closePlModal();
      });
    }

    // 景點表單兩段式刪除
    document.getElementById('pl-delete-btn').addEventListener('click', () => {
      const editId = document.getElementById('pl-edit-id').value;
      if (!editId) return;
      const delBtn = document.getElementById('pl-delete-btn');
      if (!plFormDeleteConfirm) {
        plFormDeleteConfirm = true;
        delBtn.textContent = '再按一次確定刪除';
        delBtn.classList.add('confirming');
        return;
      }
      plFormDeleteConfirm = false;
      const st = C.getState();
      st.places = (st.places || []).filter((x) => x.id !== editId);
      st.tombstones[editId] = Date.now();
      C.saveLocalState(true);
      closePlModal();
      window.renderPlaces();
      if (window.renderMoreSection) window.renderMoreSection();
      C.showSyncBanner('已刪除該筆景點');
    });

    // 景點表單儲存
    document.getElementById('pl-form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (!C.requireIdentity(() => {})) return;
      const editId = document.getElementById('pl-edit-id').value;
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
      if (editId) {
        const p = (st.places || []).find((x) => x.id === editId);
        if (p) {
          p.n = n;
          p.tags = tags.length > 0 ? tags : ['推薦'];
          p.note = note || '';
          p.who = p.who || C.getUser();
          p.upd = Date.now();
        }
      } else {
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
      }
      C.saveLocalState(true);
      closePlModal();
      window.renderPlaces();
      C.showSyncBanner(editId ? `已更新景點「${n}」` : `已加入推薦景點「${n}」`);
    });

    // 排入行程表單
    const plToTlForm = document.getElementById('pl-to-tl-form');
    if (plToTlForm) {
      plToTlForm.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!C.requireIdentity(() => {})) return;
        const targetDayIdx = parseInt(document.getElementById('pl-to-tl-day').value, 10);
        const timeStr = document.getElementById('pl-to-tl-time').value.trim() || '12:00';
        const name = document.getElementById('pl-to-tl-name').value;
        const note = document.getElementById('pl-to-tl-note').value;
        const st = C.getState();
        const newItem = {
          id: `tl-${Date.now().toString(36)}`,
          time: timeStr,
          title: name,
          baseTitle: name,
          note: note,
          q: name,
          baseQ: name,
          flight: false,
          isHandbook: false,
          who: C.getUser(),
          upd: Date.now()
        };
        st.daysMap[targetDayIdx] = st.daysMap[targetDayIdx] || [];
        st.daysMap[targetDayIdx].push(newItem);
        const ordered = H.getOrderedDayItems(targetDayIdx);
        if (!ordered.some((x) => x.id === newItem.id)) ordered.push(newItem);
        H.saveDayOrder(targetDayIdx, ordered);
        C.saveLocalState(true);
        document.getElementById('pl-to-tl-modal-backdrop').classList.remove('open');
        C.setDayIdx(targetDayIdx);
        document.querySelectorAll('.tab-pane').forEach((p) => {
          p.classList.toggle('active', p.id === 'pane-tl');
        });
        document.querySelectorAll('.nav-tab').forEach((b) => {
          b.classList.toggle('active', b.getAttribute('data-tab') === 'tl');
        });
        history.replaceState(null, '', '#tl');
        window.renderTimeline();
        H.showTlStatus(`已將「${name}」排入 Day ${targetDayIdx + 1}`);
      });
    }

    const plToTlClose = document.getElementById('pl-to-tl-close');
    const plToTlCancel = document.getElementById('pl-to-tl-cancel');
    const plToTlBackdrop = document.getElementById('pl-to-tl-modal-backdrop');
    if (plToTlClose && plToTlBackdrop) plToTlClose.addEventListener('click', () => plToTlBackdrop.classList.remove('open'));
    if (plToTlCancel && plToTlBackdrop) plToTlCancel.addEventListener('click', () => plToTlBackdrop.classList.remove('open'));
    if (plToTlBackdrop) {
      plToTlBackdrop.addEventListener('click', (e) => {
        if (e.target === plToTlBackdrop) plToTlBackdrop.classList.remove('open');
      });
    }
  };

  // ==================== M4 小卡 ====================
  window.renderPhraseCards = function () {
    const st = C.getState();
    const customList = st.customPhrases || [];
    const builtIn = window.HANDBOOK_DATA.phraseCards || [];
    const cards = [...customList, ...builtIn];

    const cats = ['全部', '問候', '點餐', '購物', '交通', '住宿', '身體不適'];
    customList.forEach((c) => {
      if (c.cat && !cats.includes(c.cat)) cats.push(c.cat);
    });
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

    listEl.innerHTML = filtered.map((c) => {
      const isCustom = c.id && c.id.startsWith('cphrase-');
      return `
        <div class="phrase-card" data-card-id="${c.id}">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px;">
            <div class="phrase-cat">${esc(c.cat)} · 點選放大給店員看</div>
            ${isCustom ? `<button type="button" class="chk-del-btn custom-phrase-del-btn" data-cphrase-id="${c.id}" title="刪除此小卡" aria-label="刪除此小卡">✕</button>` : ''}
          </div>
          <div class="phrase-jp">${esc(c.jp)}</div>
          <div class="phrase-zh">${esc(c.zh)}</div>
          <div class="phrase-pron">近似讀音：${esc(c.pron)}</div>
          ${isCustom && c.who ? `<div style="font-size:11px;color:var(--muted);margin-top:4px;">由 ${esc(c.who)} 新增</div>` : ''}
        </div>
      `;
    }).join('');

    // 刪除自訂小卡
    listEl.querySelectorAll('.custom-phrase-del-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cpId = btn.getAttribute('data-cphrase-id');
        C.requireIdentity(() => {
          const s = C.getState();
          s.customPhrases = (s.customPhrases || []).filter((x) => x.id !== cpId);
          C.saveLocalState(true);
          window.renderPhraseCards();
          C.showSyncBanner('已刪除自訂日文小卡');
        });
      });
    });

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
    const phraseModal = document.getElementById('phrase-modal');
    if (phraseModal) {
      phraseModal.addEventListener('click', (e) => {
        if (e.target === phraseModal) {
          if (window.speechSynthesis) {
            try { window.speechSynthesis.cancel(); } catch (err) {}
          }
          phraseModal.classList.remove('open');
        }
      });
    }

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

    // 自訂日文小卡彈窗事件
    const cardAddTrigger = document.getElementById('card-add-trigger');
    const customCardBackdrop = document.getElementById('custom-card-modal-backdrop');
    const customCardClose = document.getElementById('custom-card-modal-close');
    const customCardCancel = document.getElementById('custom-card-cancel');
    const customCardForm = document.getElementById('custom-card-form');

    if (cardAddTrigger && customCardBackdrop) {
      cardAddTrigger.addEventListener('click', () => {
        C.requireIdentity(() => {
          customCardBackdrop.classList.add('open');
        });
      });
    }
    if (customCardClose && customCardBackdrop) {
      customCardClose.addEventListener('click', () => customCardBackdrop.classList.remove('open'));
    }
    if (customCardCancel && customCardBackdrop) {
      customCardCancel.addEventListener('click', () => customCardBackdrop.classList.remove('open'));
    }
    if (customCardBackdrop) {
      customCardBackdrop.addEventListener('click', (e) => {
        if (e.target === customCardBackdrop) customCardBackdrop.classList.remove('open');
      });
    }

    if (customCardForm) {
      customCardForm.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!C.requireIdentity(() => {})) return;
        const jp = document.getElementById('custom-card-jp').value.trim();
        const zh = document.getElementById('custom-card-zh').value.trim();
        const pron = document.getElementById('custom-card-pron').value.trim() || '—';
        const cat = document.getElementById('custom-card-cat').value.trim() || '自訂';
        const errEl = document.getElementById('custom-card-error');

        if (!jp || !zh) {
          errEl.textContent = '請填寫日文句子與中文意思';
          return;
        }

        const st = C.getState();
        if (!st.customPhrases) st.customPhrases = [];
        st.customPhrases.unshift({
          id: `cphrase-${Date.now().toString(36)}`,
          jp,
          zh,
          pron,
          cat,
          who: C.getUser(),
          upd: Date.now()
        });
        C.saveLocalState(true);
        document.getElementById('custom-card-jp').value = '';
        document.getElementById('custom-card-zh').value = '';
        document.getElementById('custom-card-pron').value = '';
        errEl.textContent = '';
        customCardBackdrop.classList.remove('open');
        window.renderPhraseCards();
        C.showSyncBanner('✓ 已新增自訂日文小卡');
      });
    }
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
        const isCustom = item.id && item.id.startsWith('chk-');
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
              ${isCustom ? `<button type="button" class="chk-del-btn" data-del-id="${item.id}" title="刪除此項目" aria-label="刪除此項目">✕</button>` : ''}
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

      // 刪除自訂行前項目
      chkListEl.querySelectorAll('.chk-del-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = btn.getAttribute('data-del-id');
          C.requireIdentity(() => {
            const s = C.getState();
            s.checklist = (s.checklist || []).filter((x) => x.id !== id);
            C.saveLocalState(true);
            window.renderMoreSection();
            C.showSyncBanner('已刪除自訂行前項目');
          });
        });
      });
    }

    const pct = maxChecks > 0 ? Math.round((totalChecks / maxChecks) * 100) : 0;
    const progressTxt = document.getElementById('chk-progress-text');
    if (progressTxt) progressTxt.textContent = `${pct}% (${totalChecks}/${maxChecks})`;
    const progressBadge = document.getElementById('chk-progress-badge');
    if (progressBadge) progressBadge.textContent = `${pct}%`;
    const progressFill = document.getElementById('chk-progress-fill');
    if (progressFill) progressFill.style.width = `${pct}%`;

    // 2. 外部連結與自訂電子票券夾（規格 M5：沒有網址的外連不放假連結）
    const linksWrap = document.getElementById('more-links-wrap');
    if (linksWrap) {
      const customTicketUrl = (st.customLinks && st.customLinks.ticketFolderUrl) || '';
      let html = '';

      // APA 飯店住宿與計程車卡（放置在更多分頁，界面更優雅乾淨）
      html += `
        <div class="hotel-summary-card">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
            <div style="flex:1;min-width:0;">
              <div style="font-size:11px;font-weight:700;color:var(--green);letter-spacing:0.04em;margin-bottom:2px;">🏨 飯店住宿・計程車大字卡</div>
              <div style="font-size:14px;font-weight:700;color:var(--text);">APA 飯店＆度假村〈大阪難波車站前塔〉</div>
              <div style="font-size:12px;color:var(--sub);margin-top:2px;">〒556-0017 大阪府大阪市浪速区湊町1丁目2-13</div>
            </div>
            <button type="button" id="hotel-taxi-card-btn" class="fx-pill" style="white-space:nowrap;padding:6px 10px;border-color:var(--accent);color:var(--accent);font-weight:700;background:var(--accent-soft);">🚖 司機字卡</button>
          </div>
        </div>
      `;

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

    // 4. 兩則短提醒
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

    // 5. 緊急聯絡電話
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

    // 右上角天氣抽屜與隱藏式換匯抽屜（如同越南專案，點開一個時自動收合另一個）
    const wxBtn = document.getElementById('weather-btn');
    const wxDrawer = document.getElementById('weather-drawer');
    const fxBtn = document.getElementById('fx-btn');
    const fxDrawer = document.getElementById('fx-drawer');

    wxBtn.addEventListener('click', () => {
      const willOpen = !wxDrawer.classList.contains('open');
      wxDrawer.classList.toggle('open', willOpen);
      wxBtn.classList.toggle('open', willOpen);
      wxBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      if (willOpen) {
        fxDrawer.classList.remove('open');
        fxBtn.classList.remove('open');
        fxBtn.setAttribute('aria-expanded', 'false');
        window.fetchAndRenderWeather();
      }
    });

    document.getElementById('weather-close-btn').addEventListener('click', () => {
      wxDrawer.classList.remove('open');
      wxBtn.classList.remove('open');
      wxBtn.setAttribute('aria-expanded', 'false');
    });

    document.getElementById('more-open-weather-btn').addEventListener('click', () => {
      wxDrawer.classList.add('open');
      wxBtn.classList.add('open');
      wxBtn.setAttribute('aria-expanded', 'true');
      fxDrawer.classList.remove('open');
      fxBtn.classList.remove('open');
      fxBtn.setAttribute('aria-expanded', 'false');
      window.fetchAndRenderWeather();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    fxBtn.addEventListener('click', () => {
      const willOpen = !fxDrawer.classList.contains('open');
      fxDrawer.classList.toggle('open', willOpen);
      fxBtn.classList.toggle('open', willOpen);
      fxBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      if (willOpen) {
        wxDrawer.classList.remove('open');
        wxBtn.classList.remove('open');
        wxBtn.setAttribute('aria-expanded', 'false');
        window.renderFxBar();
      }
    });

    document.getElementById('fx-close-btn').addEventListener('click', () => {
      fxDrawer.classList.remove('open');
      fxBtn.classList.remove('open');
      fxBtn.setAttribute('aria-expanded', 'false');
    });

    // 匯率條事件
    const fxLeftInput = document.getElementById('fx-left-input');
    if (fxLeftInput) {
      fxLeftInput.addEventListener('focus', function () {
        this.select();
      });
      fxLeftInput.addEventListener('input', () => {
        window.renderFxBar();
      });
    }

    const fxClearBtn = document.getElementById('fx-clear-btn');
    if (fxClearBtn && fxLeftInput) {
      fxClearBtn.addEventListener('click', () => {
        fxLeftInput.value = '0';
        window.renderFxBar();
      });
    }

    document.getElementById('fx-swap-btn').addEventListener('click', () => {
      const rev = !C.getFxReversed();
      C.setFxReversed(rev);
      if (fxLeftInput) fxLeftInput.value = '1000';
      window.renderFxBar();
    });
    document.getElementById('refresh-fx-btn').addEventListener('click', () => {
      window.refreshExchangeRate(true);
    });

    // 頂部同步狀態點點擊快速診斷
    const headerSyncStatusBtn = document.getElementById('header-sync-status');
    if (headerSyncStatusBtn) {
      headerSyncStatusBtn.addEventListener('click', async () => {
        C.showSyncBanner('正在檢查 Supabase 雲端連線狀態...');
        const res = await window.pullFromSupabaseAsync(true);
        if (window.updateSyncStatusUI) window.updateSyncStatusUI(res.ok, res.ok ? '雲端已連線' : '本機離線中');
        C.showSyncBanner(res.msg);
      });
    }

    // 更多分頁可摺疊手風琴標題
    document.querySelectorAll('.accordion-header').forEach((hdr) => {
      hdr.addEventListener('click', () => {
        const targetId = hdr.getAttribute('data-target');
        const body = document.getElementById(targetId);
        if (!body) return;
        const isCollapsed = body.classList.contains('collapsed');
        body.classList.toggle('collapsed', !isCollapsed);
        hdr.classList.toggle('collapsed', !isCollapsed);
      });
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

    // 更多分頁：一鍵切換身份（老公 / 老婆）
    const switchToHusbandBtn = document.getElementById('switch-to-husband-btn');
    if (switchToHusbandBtn) {
      switchToHusbandBtn.addEventListener('click', () => {
        C.setUser('老公');
        window.renderHeaderAndIdentity();
        window.renderPlaces();
        window.renderMoreSection();
        C.showSyncBanner('已切換這支手機的身份為：老公');
      });
    }

    const switchToWifeBtn = document.getElementById('switch-to-wife-btn');
    if (switchToWifeBtn) {
      switchToWifeBtn.addEventListener('click', () => {
        C.setUser('老婆');
        window.renderHeaderAndIdentity();
        window.renderPlaces();
        window.renderMoreSection();
        C.showSyncBanner('已切換這支手機的身份為：老婆');
      });
    }

    // 保留相容性文字切換
    const switchUserBtn = document.getElementById('switch-user-btn');
    if (switchUserBtn) {
      switchUserBtn.addEventListener('click', () => {
        const input = document.getElementById('switch-user-input');
        if (!input) return;
        const val = input.value.trim();
        const msgEl = document.getElementById('switch-user-msg');
        if (val !== '老公' && val !== '老婆') {
          if (msgEl) msgEl.textContent = '請完整輸入「老公」或「老婆」才能切換身份';
          return;
        }
        C.setUser(val);
        input.value = '';
        if (msgEl) msgEl.textContent = '';
        window.renderHeaderAndIdentity();
        window.renderPlaces();
        window.renderMoreSection();
        C.showSyncBanner(`已切換這支手機的身份為：${val}`);
      });
    }
  }

  // 旅遊期間自動跳轉至當日行程（10/22 ~ 10/25）
  function autoSelectTripDay() {
    const now = new Date();
    const m = now.getMonth() + 1;
    const d = now.getDate();
    if (m === 10) {
      if (d === 22) C.setDayIdx(0);
      else if (d === 23) C.setDayIdx(1);
      else if (d === 24) C.setDayIdx(2);
      else if (d === 25) C.setDayIdx(3);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    window.initTimelineFormEvents();
    window.initExpenseEvents();
    window.initPlaceEvents();
    window.initPhraseCardEvents();
    initGlobalEvents();

    autoSelectTripDay();

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
