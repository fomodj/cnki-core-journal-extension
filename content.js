/**
 * 核心期刊多库标注插件 — content.js v2.1
 * 支持 CSSCI / 北大核心 / AMI 全系列 / 国家社科基金
 * 支持通过 popup 动态筛选显示的数据集
 *
 * v2.1 修复：期刊名多级标准化匹配
 * 1. 全角括号（）→ 半角括号 ()，全角冒号 → 半角冒号，《》→ 空，空格→ 空
 * 2. 自动补全数据中残缺的右括号（共 6 条脏数据）
 * 3. 剥离数据键末尾的元信息后缀（原:、原名:、中英文、合并、更名、优稿不收…）
 * 构建"简名索引"，允许 CNKI 只显示不含后缀的期刊现用名时也能命中
 * 4. 以上三层查找均无命中时，再走原有 alias 表
 */
(function () {
  'use strict';
  if (window.__cssciLoaded) return;
  window.__cssciLoaded = true;

  // ── 分类定义表：catId → { cls, label } ──────────────────────────
  const CAT_DEFS = {
    'cssci-source':      { cls: 'cat-source',   label: 'CSSCI来源'   },
    'cssci-extend':      { cls: 'cat-extend',   label: 'CSSCI扩展'   },
    'cssci-collect':     { cls: 'cat-collect',  label: 'CSSCI集刊'   },
    'pku':               { cls: 'cat-pku',      label: '北大核心'     },
    'ami-top':           { cls: 'cat-ami-top',  label: 'AMI顶级'     },
    'ami-auth':          { cls: 'cat-ami-auth', label: 'AMI权威'     },
    'ami-core':          { cls: 'cat-ami-core', label: 'AMI核心'     },
    'ami-extend':        { cls: 'cat-ami-ext',  label: 'AMI扩展'     },
    'ami-enter':         { cls: 'cat-ami-ent',  label: 'AMI入库'     },
    'ami-core-journal':  { cls: 'cat-ami-cj',   label: 'AMI核心集刊' },
    'ami-enter-journal': { cls: 'cat-ami-ej',   label: 'AMI入库集刊' },
    'ami-core-intl':     { cls: 'cat-ami-ci',   label: 'AMI核心国际' },
    'ami-enter-intl':    { cls: 'cat-ami-ei',   label: 'AMI入库国际' },
    'nssf':              { cls: 'cat-nssf',     label: '国家社科'     },
  };

  // ── 将单个 type 段归类为 catId（顺序决定优先级）──────────────────
  function classifySegment(seg) {
    if (seg.includes('CSSCI来源'))       return 'cssci-source';
    if (seg.includes('CSSCI扩展'))       return 'cssci-extend';
    if (seg.includes('CSSCI收录'))       return 'cssci-collect';
    if (seg.includes('北大核心') ||
        seg.includes('中文核心'))         return 'pku';
    if (seg.includes('AMI顶级'))         return 'ami-top';
    if (seg.includes('AMI权威'))         return 'ami-auth';
    // 先匹配长串（集刊/国际刊），防止被短串"AMI核心/AMI入库"提前截获
    if (seg.includes('AMI核心集刊'))     return 'ami-core-journal';
    if (seg.includes('AMI入库集刊'))     return 'ami-enter-journal';
    if (seg.includes('AMI核心国际刊'))   return 'ami-core-intl';
    if (seg.includes('AMI入库国际刊'))   return 'ami-enter-intl';
    if (seg.includes('AMI核心'))         return 'ami-core';
    if (seg.includes('AMI扩展'))         return 'ami-extend';
    if (seg.includes('AMI入库'))         return 'ami-enter';
    if (seg.includes('国家社科基金'))    return 'nssf';
    return null;
  }

  // ── 多级标准化查找（核心升级） ────────────────────────────────────
  //
  // 数据中期刊名存在大量"装饰"，CNKI 显示的往往是纯净现用名，例如：
  //   数据键：逻辑学研究（原：中山大学学报论丛）
  //   CNKI：  逻辑学研究
  //
  //   数据键：安徽大学学报（哲社版）（原：安徽大学学报(哲学社会科学版）  ← 括号不匹配
  //   CNKI：  安徽大学学报(哲社版)
  //
  // 三级查找：
  //   Level 1 normIdx   — 全角/空格/书名号标准化后直接命中
  //   Level 2 shortIdx  — 再剥离末尾元信息括号后命中（原:、原名:、中英文、合并…）
  //   Level 3 aliasIdx  — 走原有 alias 表（处理旧名/别名）

  let normIdx  = {};   // normalized(key)        → raw key
  let shortIdx = {};   // stripped(normalized(key)) → raw key，仅存"剥离后与原不同"的条目
  let aliasIdx = {};   // normalized(alias_key)   → alias value（canonical raw key）
  let INDEX    = {};   // raw key → { t, c, i, name }
  let ALIAS    = {};   // raw alias key → canonical raw key

  /** Step 1：字符级标准化（不改变实际含义） */
  function normStr(s) {
    return s
      .replace(/（/g, '(').replace(/）/g, ')')
      .replace(/：/g, ':')
      .replace(/《/g, '').replace(/》/g, '')
      .replace(/\s+/g, '')
      .trim();
  }

  /** 补全缺失的右括号（应对少数脏数据） */
  function balanceParens(s) {
    const diff = (s.match(/\(/g) || []).length - (s.match(/\)/g) || []).length;
    return diff > 0 ? s + ')'.repeat(diff) : s;
  }

  // 末尾元信息括号的内容特征
  const META_RE = /原[名]?:|^中英文$|合并|更名|优稿不收|不收版面费/;

  /**
   * Step 2：从末尾反复剥离"元信息括号组"
   * 支持一层嵌套，例：(原:XX(旧名))
   */
  function stripMetaSuffixes(s) {
    let changed = true;
    while (changed) {
      changed = false;
      // 匹配最后一个顶层括号组（允许其内部有一层嵌套）
      const m = s.match(/\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*$/);
      if (m && META_RE.test(m[1])) {
        s = s.slice(0, m.index).trimEnd();
        changed = true;
      }
    }
    return s;
  }

  async function loadData() {
    const url  = chrome.runtime.getURL('data/core_plugin_data.json');
    const res  = await fetch(url);
    const data = await res.json();
    INDEX = data.index || {};
    ALIAS = data.alias || {};

    // 构建 normIdx
    for (const rawKey of Object.keys(INDEX)) {
      const nk = normStr(rawKey);
      if (!(nk in normIdx)) normIdx[nk] = rawKey;
    }

    // 构建 shortIdx（只存"剥离后与 normIdx 键不同"的映射，避免覆盖精确命中）
    for (const rawKey of Object.keys(INDEX)) {
      const nk      = balanceParens(normStr(rawKey));
      const short   = stripMetaSuffixes(nk);
      const origNk  = normStr(rawKey);           // 未补全括号版，用于比较
      if (short !== origNk && !(short in normIdx) && !(short in shortIdx)) {
        shortIdx[short] = rawKey;
      }
    }

    // 构建 aliasIdx
    for (const [aliasKey, canonical] of Object.entries(ALIAS)) {
      const nk = normStr(aliasKey);
      if (!(nk in aliasIdx)) aliasIdx[nk] = canonical;
    }
  }

  // ── 标准化名称（保留原逻辑，现仅作兜底） ────────────────────────
  function normalize(name) {
    return name
      .replace(/\s+/g, '')
      .replace(/[（(](?:不收|OA期|官网|Email|email|纸质|打印|国际刊号|有稿酬|双月刊|季刊|月刊)[^）)]*[）)]/g, '')
      .trim();
  }

  /**
   * 多级 lookup：
   * 1. normIdx  — 标准化后精确命中
   * 2. shortIdx — 剥离元信息后命中
   * 3. aliasIdx — alias 表命中
   * 4. 原始旧逻辑兜底（直接查 INDEX / ALIAS）
   */
  function lookup(rawName) {
    if (!rawName) return null;
    const name = rawName.trim();

    // Level 1：标准化精确匹配
    const nk = normStr(name);
    let rawKey = normIdx[nk];
    if (!rawKey) {
      // Level 2：剥离元信息后匹配
      rawKey = shortIdx[nk];
    }
    if (!rawKey) {
      // Level 3：alias 表
      const canonical = aliasIdx[nk];
      if (canonical) rawKey = canonical;
    }
    if (!rawKey) {
      // Level 4：原始逻辑兜底（直接 key / normalize）
      if (INDEX[name]) {
        rawKey = name;
      } else if (ALIAS[name] && INDEX[ALIAS[name]]) {
        rawKey = ALIAS[name];
      } else {
        const normalized = normalize(name);
        if (INDEX[normalized]) rawKey = normalized;
      }
    }

    if (!rawKey || !INDEX[rawKey]) return null;
    const info = INDEX[rawKey];
    return {
      name:   info.name   || rawKey,
      type:   info.t      || info.type || '',
      cat:    info.c      || info.cat  || '',
      impact: info.i      || info.impact || '0',
    };
  }

  // ── 用户启用的分类（从 storage 读取）────────────────────────────
  let enabledCats = {};

  function isCatEnabled(catId) {
    if (Object.keys(enabledCats).length === 0) return true;
    return enabledCats[catId] !== false;
  }

  // ── 解析 type 字段 → 徽章列表 ───────────────────────────────────
  function getBadges(typeStr) {
    if (!typeStr) return [];
    const seen   = new Set();
    const result = [];
    for (const seg of typeStr.split(',').map(s => s.trim()).filter(Boolean)) {
      const catId = classifySegment(seg);
      if (!catId || seen.has(catId)) continue;
      seen.add(catId);
      if (!isCatEnabled(catId)) continue;
      const def = CAT_DEFS[catId];
      if (def) result.push({ catId, ...def });
    }
    return result;
  }

  // ── 构造徽章组 DOM ───────────────────────────────────────────────
  function makeBadgeGroup(info) {
    const container = document.createElement('span');
    container.className = 'badge-group';
    container.setAttribute('data-cssci-injected', '1');

    // 优先使用 c 字段（info.cat）：这是预处理好的完整分类列表，包含北大核心等
    // t 字段（info.type）是原始冗长描述，北大核心覆盖不全（1365 vs 1975 条）
    const typeStr  = info.cat || info.type || '';
    const badges   = getBadges(typeStr);
    const impact   = parseFloat(info.impact) > 0
      ? parseFloat(info.impact).toFixed(3)
      : null;

    if (badges.length === 0) return null;

    // 🌟 新增逻辑：为浮层中的 CSSCI 类型追加 (2025-2026)
    const displayTypeStr = typeStr.split(/[,，]/).map(seg => {
      const s = seg.trim();
      // 如果当前字段包含 'CSSCI' 且尚未添加年份，则自动补全年份
      if (s.includes('CSSCI') && !s.includes('(2025-2026)')) {
        return s + '(2025-2026)';
      }
      return s;
    }).join(',');

    badges.forEach(({ cls, label }) => {
      const badge = document.createElement('span');
      badge.className = `cssci-badge ${cls}`;
      badge.innerHTML =
        `${label}<span class="cssci-tooltip">` +
          `<div class="cssci-tooltip-row">` +
            `<span class="cssci-tooltip-label">期刊</span>` +
            `<span class="cssci-tooltip-value">${info.name}</span>` +
          `</div>` +
          `<div class="cssci-tooltip-row">` +
            `<span class="cssci-tooltip-label">收录</span>` +
            `<span class="cssci-tooltip-value" style="white-space:normal;max-width:230px;line-height:1.4">${displayTypeStr}</span>` +
          `</div>` +
          (impact
            ? `<div class="cssci-tooltip-row">` +
                `<span class="cssci-tooltip-label">影响因子</span>` +
                `<span class="cssci-tooltip-value">${impact}</span>` +
              `</div>`
            : '') +
        `</span>`;
      container.appendChild(badge);
    });
    return container;
  }

  // ── 注入逻辑 ────────────────────────────────────────────────────
  let injectedCount = 0;

  function tryInject(sourceEl, titleEl) {
    if (!sourceEl || sourceEl.hasAttribute('data-cssci-checked')) return;
    sourceEl.setAttribute('data-cssci-checked', '1');
    const info = lookup(sourceEl.innerText);
    if (info && titleEl && !titleEl.querySelector('[data-cssci-injected]')) {
      const group = makeBadgeGroup(info);
      if (group) { titleEl.appendChild(group); injectedCount++; }
    }
  }

  function processTableRows() {
    document.querySelectorAll('.result-table tr, .result-table-list tr').forEach(row => {
      tryInject(
        row.querySelector('.source a, td:nth-child(4) a'),
        row.querySelector('.name a, .fz14')
      );
    });
  }

  function processCardItems() {
    document.querySelectorAll('.scjg-list li, .result-list li').forEach(li => {
      tryInject(
        li.querySelector('.left-name a, .source a'),
        li.querySelector('.title a') || li.querySelector('h3 a')
      );
    });
  }

  function processDetailPage() {
    const topSpace = document.querySelector('.top-space a');
    if (!topSpace) return;
    const info    = lookup(topSpace.innerText);
    const titleEl = document.querySelector('#chTitle, .wx-tit h1, .title .main-title');
    if (info && titleEl && !titleEl.querySelector('[data-cssci-injected]')) {
      const group = makeBadgeGroup(info);
      if (group) { titleEl.appendChild(group); injectedCount++; }
    }
  }

  function injectBadges() {
    processTableRows();
    processCardItems();
    processDetailPage();
    try { chrome.storage.local.set({ injectedCount }); } catch (_) {}
  }

  // ── 清除并重新注入（当筛选条件变更时调用）──────────────────────
  function clearAndReinject() {
    document.querySelectorAll('.badge-group[data-cssci-injected]').forEach(el => el.remove());
    document.querySelectorAll('[data-cssci-checked]').forEach(el => {
      el.removeAttribute('data-cssci-checked');
    });
    injectedCount = 0;
    injectBadges();
  }

  // ── MutationObserver（监听 DOM 变化）────────────────────────────
  let timer = null;
  const observer = new MutationObserver((mutations) => {
    if (mutations.some(m =>
      Array.from(m.addedNodes).some(n =>
        n.nodeType === 1 && !n.classList?.contains('cssci-badge')
      )
    )) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { injectBadges(); timer = null; }, 400);
    }
  });

  // ── 启动 ─────────────────────────────────────────────────────────
  chrome.storage.local.get(['enabledCats'], (data) => {
    enabledCats = data.enabledCats || {};
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.enabledCats) {
      enabledCats = changes.enabledCats.newValue || {};
      clearAndReinject();
    }
  });

  loadData().then(() => {
    injectBadges();
    observer.observe(document.body, { childList: true, subtree: true });

    // 统计各库期刊数量
    let nCssci = 0, nPku = 0, nAmi = 0, nNssf = 0;
    Object.values(INDEX).forEach(v => {
      const t = v.t || v.type || v.c || v.cat || '';
      if (t.includes('CSSCI'))        nCssci++;
      if (t.includes('北大核心') ||
          t.includes('中文核心'))      nPku++;
      if (t.includes('AMI'))          nAmi++;
      if (t.includes('国家社科基金')) nNssf++;
    });
    try {
      chrome.storage.local.set({ cssciReady: true, nCssci, nPku, nAmi, nNssf });
    } catch (_) {}
  });
})();