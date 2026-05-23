/**
 * 核心期刊多库标注插件 — content.js v2.3 (详情页全适配高稳版)
 * 支持 CSSCI / 北大核心 / AMI 全系列 / 国家社科基金
 * 支持通过 popup 动态筛选显示的数据集
 *
 * v2.3 升级：
 * 1. 完美适配网络首发版详情页结构，新增 .top-tip a 选择器优先级
 * 2. 引入多候选路径贪婪匹配，自动过滤“查看该刊”等辅助节点
 * 3. 增强过滤算法，自动裁剪期刊名末尾由知网改版引入的句号点（.）与杂质符号
 * 4. 独家支持详情页下方“参考文献/引文网络”列表中的期刊核心级别同步标注
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

  // ── 多级标准化查找 ────────────────────────────────────────────────
  let normIdx  = {};   
  let shortIdx = {};   
  let aliasIdx = {};   
  let INDEX    = {};   
  let ALIAS    = {};   

  function normStr(s) {
    return s
      .replace(/（/g, '(').replace(/）/g, ')')
      .replace(/：/g, ':')
      .replace(/《/g, '').replace(/》/g, '')
      .replace(/\s+/g, '')
      .trim();
  }

  function balanceParens(s) {
    const diff = (s.match(/\(/g) || []).length - (s.match(/\)/g) || []).length;
    return diff > 0 ? s + ')'.repeat(diff) : s;
  }

  const META_RE = /原[名]?:|^中英文$|合并|更名|优稿不收|不收版面费/;

  function stripMetaSuffixes(s) {
    let changed = true;
    while (changed) {
      changed = false;
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

    for (const rawKey of Object.keys(INDEX)) {
      const nk = normStr(rawKey);
      if (!(nk in normIdx)) normIdx[nk] = rawKey;
    }

    for (const rawKey of Object.keys(INDEX)) {
      const nk      = balanceParens(normStr(rawKey));
      const short   = stripMetaSuffixes(nk);
      const origNk  = normStr(rawKey);           
      if (short !== origNk && !(short in normIdx) && !(short in shortIdx)) {
        shortIdx[short] = rawKey;
      }
    }

    for (const [aliasKey, canonical] of Object.entries(ALIAS)) {
      const nk = normStr(aliasKey);
      if (!(nk in aliasIdx)) aliasIdx[nk] = canonical;
    }
  }

  function normalize(name) {
    return name
      .replace(/\s+/g, '')
      .replace(/[（(](?:不收|OA期|官网|Email|email|纸质|打印|国际刊号|有稿酬|双月刊|季刊|月刊)[^）)]*[）)]/g, '')
      .trim();
  }

  function lookup(rawName) {
    if (!rawName) return null;
    const name = rawName.trim();

    const nk = normStr(name);
    let rawKey = normIdx[nk];
    if (!rawKey) rawKey = shortIdx[nk];
    if (!rawKey) {
      const canonical = aliasIdx[nk];
      if (canonical) rawKey = canonical;
    }
    if (!rawKey) {
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

  let enabledCats = {};

  function isCatEnabled(catId) {
    if (Object.keys(enabledCats).length === 0) return true;
    return enabledCats[catId] !== false;
  }

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

    const typeStr  = info.cat || info.type || '';
    const badges   = getBadges(typeStr);
    const impact   = parseFloat(info.impact) > 0
      ? parseFloat(info.impact).toFixed(3)
      : null;

    if (badges.length === 0) return null;

    const displayTypeStr = typeStr.split(/[,，]/).map(seg => {
      const s = seg.trim();
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

  // 🌟 核心适配重写：详情页（知网节）自适应居中换行方案
  function processDetailPage() {
    // 1. 广谱候选选择器组合（优先匹配新版 .top-tip a，兼容老版选择器）
    const candidateEls = document.querySelectorAll('.top-tip a, .breadcrumb a, .academic-source a, .source-navigator a, .journal-title a, #sourcelink');
    
    let info = null;

    // 2. 迭代寻找第一个有效命中的期刊节点
    for (const el of candidateEls) {
      const txt = el.innerText.trim();
      // 过滤掉“查看该刊数据收录来源”等无关辅助文字
      if (!txt || txt.includes('查看该刊')) continue;

      // 清洗：去除逗号分流、并利用正则强制裁剪掉尾部的英文点（.）、空格、顿号等杂质
      const journalName = txt.split(/[,，]/)[0].replace(/[.\s、，。]+$/, '').replace(/\s+/g, '').trim();
      if (!journalName) continue;

      const res = lookup(journalName);
      if (res) {
        info = res;
        break; // 匹配成功，跳出循环
      }
    }

    if (!info) return;

    // 3. 广谱匹配详情页大标题节点
    const titleEl = document.querySelector('#chTitle, .wx-tit h1, .title .main-title, .doc-title h1, .article-title h1');
    if (!titleEl) return;

    // 4. 防抖与防重复注入检查
    if (titleEl.nextElementSibling && titleEl.nextElementSibling.hasAttribute('data-cssci-detail-container')) {
      return;
    }

    const group = makeBadgeGroup(info);
    if (group) {
      group.style.marginLeft = '0'; // 清除列表页非对称左边距

      // 5. 组装独立成行的 Flex 容器线（实现完美对称居中、且支持多级徽章自动换行不重叠）
      const container = document.createElement('div');
      container.setAttribute('data-cssci-detail-container', '1');
      container.style.cssText = 'display: flex; justify-content: center; flex-wrap: wrap; gap: 6px; margin: 12px 0 6px 0; width: 100%;';
      container.appendChild(group);

      // 6. 核心锚定动作：安全插入至大标题正下方
      titleEl.parentNode.insertBefore(container, titleEl.nextSibling);
      
      injectedCount++;
      try { chrome.storage.local.set({ injectedCount }); } catch (_) {}
    }
  }

  // 🌟 独家追加：详情页下方“引文网络（参考文献等）”列表期刊评级实时同步标注
  function processDetailReferences() {
    document.querySelectorAll('.essayBox .ebBd li, .mianbaoxian .ebBd li').forEach(li => {
      const titleLink = li.querySelector('.document-title');
      if (!titleLink || li.hasAttribute('data-cssci-checked')) return;

      const allLinks = li.querySelectorAll('a');
      let journalLink = null;
      for (const a of allLinks) {
        // 排除掉文章题目本身的链接和年期的链接，剩下的即为引用的期刊链接
        if (!a.classList.contains('document-title') && !a.classList.contains('year-issue') && a.innerText.trim()) {
          journalLink = a;
          break;
        }
      }
      if (journalLink) {
        tryInject(journalLink, titleLink);
      }
    });
  }

  function injectBadges() {
    processTableRows();
    processCardItems();
    processDetailPage();
    processDetailReferences(); // 执行引文网络列表注入
    try { chrome.storage.local.set({ injectedCount }); } catch (_) {}
  }

  // ── 清除并重新注入（当筛选条件变更时调用）──────────────────────
  function clearAndReinject() {
    document.querySelectorAll('.badge-group[data-cssci-injected]').forEach(el => el.remove());
    document.querySelectorAll('[data-cssci-detail-container]').forEach(el => el.remove()); 
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