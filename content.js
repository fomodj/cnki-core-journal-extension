/**
 * 核心期刊多库标注插件 — content.js v2.9.1 (原刊名多格式强化版)
 * 重点支持：（原：XXX;YYY）多旧刊名 + 知网简化名称
 */
(function () {
  'use strict';
  if (window.__cssciLoaded) return;
  window.__cssciLoaded = true;

  // ── 分类定义表 ──────────────────────────────────────────────────
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

  function classifySegment(seg) {
    if (seg.includes('CSSCI来源'))       return 'cssci-source';
    if (seg.includes('CSSCI扩展'))       return 'cssci-extend';
    if (seg.includes('CSSCI收录'))       return 'cssci-collect';
    if (seg.includes('北大核心') || seg.includes('中文核心')) return 'pku';
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

  // ── 超级标准化函数 ───────────────────────────────────────────────
  function aggressiveNorm(s) {
    return s
      .replace(/《|》/g, '')
      .replace(/\s+/g, '')
      .replace(/（上海）|（北京）|（广东）|（江苏）|（浙江）|（山东）|（全国）|（天津）|（重庆）|（四川）/g, '')
      .replace(/（[^）]*上海社会科学院[^）]*）/g, '')
      .replace(/[（(][^）)]*[）)]/g, '')           // 移除所有括号内容
      .toLowerCase()
      .trim();
  }

  function normStr(s) {
    return aggressiveNorm(s)
      .replace(/（/g, '(').replace(/）/g, ')')
      .replace(/：/g, ':')
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

  // ── 索引构建（重点强化原刊名解析） ───────────────────────────────
  let normIdx      = {};   
  let shortIdx     = {};   
  let pureShortIdx = {};   
  let aliasIdx     = {};   
  let oldNameMap   = {};   // 原刊名 → 正式刊名
  let INDEX        = {};   
  let ALIAS        = {};   

  async function loadData() {
    const url  = chrome.runtime.getURL('data/core_plugin_data.json');
    const res  = await fetch(url);
    const data = await res.json();
    INDEX = data.index || {};
    ALIAS = data.alias || {};

    const rawKeys = Object.keys(INDEX);
    for (let rawKey of rawKeys) {
      const nk = normStr(rawKey);
      if (!(nk in normIdx)) normIdx[nk] = rawKey;

      const balanced = balanceParens(nk);
      const short = stripMetaSuffixes(balanced);
      if (short !== nk && !(short in normIdx) && !(short in shortIdx)) {
        shortIdx[short] = rawKey;
      }

      const pure = balanced.replace(/\([^()]*\)$/, '');
      if (pure !== balanced && !(pure in normIdx) && !(pure in shortIdx) && !(pure in pureShortIdx)) {
        pureShortIdx[pure] = rawKey;
      }

      // 强化：解析多种“原：”格式（支持分号分隔）
      const oldMatch = rawKey.match(/（原[：:]\s*([^）]+)）/);
      if (oldMatch && oldMatch[1]) {
        const oldParts = oldMatch[1].split(/[;；,、]/);
        oldParts.forEach(part => {
          const cleanOld = aggressiveNorm(part.trim());
          if (cleanOld && cleanOld.length > 1) {
            oldNameMap[cleanOld] = rawKey;
          }
        });
      }
    }

    Object.entries(ALIAS).forEach(([aliasKey, canonical]) => {
      const nk = normStr(aliasKey);
      aliasIdx[nk] = canonical;
    });
  }

  const LOOKUP_CACHE = new Map();

  function lookup(rawName) {
    if (!rawName) return null;
    const name = rawName.trim();
    if (LOOKUP_CACHE.has(name)) return LOOKUP_CACHE.get(name);

    const nk = normStr(name);
    let rawKey = normIdx[nk] || shortIdx[nk] || pureShortIdx[nk] || aliasIdx[nk];

    // 原刊名优先匹配
    if (!rawKey) {
      const cleanName = aggressiveNorm(name);
      rawKey = oldNameMap[cleanName];
    }

    // 超级模糊匹配（兜底）
    if (!rawKey) {
      const cleanName = aggressiveNorm(name);
      for (let key of Object.keys(INDEX)) {
        const cleanKey = aggressiveNorm(key);
        if (cleanKey.startsWith(cleanName) || cleanName.startsWith(cleanKey) ||
            cleanKey.includes(cleanName) || cleanName.includes(cleanKey)) {
          rawKey = key;
          break;
        }
      }
    }

    // 最终兜底
    if (!rawKey) {
      if (INDEX[name]) rawKey = name;
      else if (ALIAS[name]) rawKey = ALIAS[name];
    }

    if (!rawKey || !INDEX[rawKey]) {
      LOOKUP_CACHE.set(name, null);
      return null;
    }

    const info = INDEX[rawKey];
    const result = {
      name:   info.name   || rawKey,
      type:   info.t      || info.type || '',
      cat:    info.c      || info.cat  || '',
      impact: info.i      || info.impact || '0',
    };

    LOOKUP_CACHE.set(name, result);
    return result;
  }

  // 以下部分保持不变（getBadges、tooltip、注入逻辑等）
  let enabledCats = {};
  function isCatEnabled(catId) {
    if (Object.keys(enabledCats).length === 0) return true;
    return enabledCats[catId] !== false;
  }

  function getBadges(typeStr) {
    if (!typeStr) return [];
    const seen = new Set();
    const result = [];
    const segs = typeStr.split(',');
    for (let seg of segs) {
      const s = seg.trim();
      if (!s) continue;
      const catId = classifySegment(s);
      if (!catId || seen.has(catId)) continue;
      seen.add(catId);
      if (!isCatEnabled(catId)) continue;
      const def = CAT_DEFS[catId];
      if (def) result.push({ catId, ...def });
    }
    return result;
  }

  function getGlobalTooltip() {
    let tooltip = document.getElementById('cssci-global-tooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = 'cssci-global-tooltip';
      document.body.appendChild(tooltip);
    }
    return tooltip;
  }

  function makeBadgeGroup(info) {
    const container = document.createElement('span');
    container.className = 'badge-group';
    container.setAttribute('data-cssci-injected', '1');

    const typeStr = info.cat || info.type || '';
    const badges = getBadges(typeStr);
    const impact = parseFloat(info.impact) > 0 ? parseFloat(info.impact).toFixed(3) : null;

    if (badges.length === 0) return null;

    const displayTypeStr = typeStr.split(/[,，]/).map(seg => {
      const s = seg.trim();
      if (s.includes('CSSCI') && !s.includes('(2025-2026)')) return s + '(2025-2026)';
      return s;
    }).join(',');

    badges.forEach(({ cls, label }) => {
      const badge = document.createElement('span');
      badge.className = `cssci-badge ${cls}`;
      badge.innerText = label;

      badge.addEventListener('mouseenter', () => {
        const tooltip = getGlobalTooltip();
        tooltip.innerHTML =
          `<div class="cssci-tooltip-row"><span class="cssci-tooltip-label">期刊</span><span class="cssci-tooltip-value">${info.name}</span></div>` +
          `<div class="cssci-tooltip-row"><span class="cssci-tooltip-label">收录</span><span class="cssci-tooltip-value" style="white-space:normal;max-width:230px;line-height:1.4">${displayTypeStr}</span></div>` +
          (impact ? `<div class="cssci-tooltip-row"><span class="cssci-tooltip-label">影响因子</span><span class="cssci-tooltip-value">${impact}</span></div>` : '');

        const rect = badge.getBoundingClientRect();
        tooltip.style.left = `${rect.left + window.scrollX + rect.width / 2}px`;
        tooltip.style.top = `${rect.top + window.scrollY - 8}px`;
        tooltip.classList.add('active');
      });

      badge.addEventListener('mouseleave', () => {
        getGlobalTooltip().classList.remove('active');
      });

      container.appendChild(badge);
    });
    return container;
  }

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

  // 注入函数（processTableRows 等）保持不变...
  function processTableRows() {
    const rows = document.querySelectorAll('.result-table tr, .result-table-list tr');
    for (let i = 0; i < rows.length; i++) {
      tryInject(
        rows[i].querySelector('.source a, td:nth-child(4) a'),
        rows[i].querySelector('.name a, .fz14')
      );
    }
  }

  function processCardItems() {
    const items = document.querySelectorAll('.scjg-list li, .result-list li');
    for (let i = 0; i < items.length; i++) {
      tryInject(
        items[i].querySelector('.left-name a, .source a'),
        items[i].querySelector('.title a') || items[i].querySelector('h3 a')
      );
    }
  }

  function processDetailPage() {
    const titleEl = document.querySelector('#chTitle, .wx-tit h1, .title .main-title, .doc-title h1, .article-title h1');
    if (!titleEl) return;
    if (titleEl.nextElementSibling && titleEl.nextElementSibling.hasAttribute('data-cssci-detail-container')) return;

    const candidateEls = document.querySelectorAll('.top-tip a, .breadcrumb a, .academic-source a, .source-navigator a, .journal-title a, #sourcelink');
    let info = null;

    for (let i = 0; i < candidateEls.length; i++) {
      const txt = candidateEls[i].innerText.trim();
      if (!txt || txt.includes('查看该刊')) continue;
      const journalName = txt.split(/[,，]/)[0].replace(/[.\s、，。]+$/, '').replace(/\s+/g, '').trim();
      if (!journalName) continue;
      const res = lookup(journalName);
      if (res) { info = res; break; }
    }

    if (!info) return;

    const group = makeBadgeGroup(info);
    if (group) {
      group.style.marginLeft = '0';
      const container = document.createElement('div');
      container.setAttribute('data-cssci-detail-container', '1');
      container.style.cssText = 'display: flex; justify-content: center; flex-wrap: wrap; gap: 6px; margin: 12px 0 6px 0; width: 100%;';
      container.appendChild(group);
      titleEl.parentNode.insertBefore(container, titleEl.nextSibling);
      injectedCount++;
    }
  }

  function processDetailReferences() {
    const items = document.querySelectorAll('.essayBox .ebBd li, .mianbaoxian .ebBd li');
    for (let i = 0; i < items.length; i++) {
      const li = items[i];
      const titleLink = li.querySelector('.document-title');
      if (!titleLink || li.hasAttribute('data-cssci-checked')) continue;

      const allLinks = li.querySelectorAll('a');
      let journalLink = null;
      for (let j = 0; j < allLinks.length; j++) {
        const a = allLinks[j];
        if (!a.classList.contains('document-title') && !a.classList.contains('year-issue') && a.innerText.trim()) {
          journalLink = a;
          break;
        }
      }
      if (journalLink) tryInject(journalLink, titleLink);
    }
  }

  function processPlainReferences() {
    const items = document.querySelectorAll('.essayBox .ebBd li');
    for (let i = 0; i < items.length; i++) {
      const li = items[i];
      const titleLink = li.querySelector('.document-title');
      if (!titleLink || li.hasAttribute('data-cssci-plain-checked') || titleLink.querySelector('[data-cssci-injected]')) continue;
      
      li.setAttribute('data-cssci-plain-checked', '1');

      const nextNode = titleLink.nextSibling;
      if (!nextNode || (nextNode.nodeType === 1 && nextNode.tagName === 'A')) continue; 

      const textContent = nextNode.textContent || '';
      const parts = textContent.split('.');
      if (parts.length < 2) continue;
      
      let journalName = parts[parts.length - 1].split(/[,，]/)[0].trim();
      journalName = journalName.replace(/[.\s、，。]+$/, '').replace(/\s+/g, '').trim();
      if (!journalName) continue;

      const info = lookup(journalName);
      if (info) {
        const group = makeBadgeGroup(info);
        if (group) { titleLink.appendChild(group); injectedCount++; }
      }
    }
  }

  function injectBadges() {
    processTableRows();
    processCardItems();
    processDetailPage();
    processDetailReferences();
    processPlainReferences();
    try { chrome.storage.local.set({ injectedCount }); } catch (_) {}
  }

  function clearAndReinject() {
    document.querySelectorAll('.badge-group[data-cssci-injected]').forEach(el => el.remove());
    document.querySelectorAll('[data-cssci-detail-container]').forEach(el => el.remove()); 
    document.querySelectorAll('[data-cssci-checked]').forEach(el => el.removeAttribute('data-cssci-checked'));
    document.querySelectorAll('[data-cssci-plain-checked]').forEach(el => el.removeAttribute('data-cssci-plain-checked'));
    injectedCount = 0;
    injectBadges();
  }

  let timer = null;
  const observer = new MutationObserver((mutations) => {
    let hasValidMutation = false;
    for (let mutation of mutations) {
      for (let node of mutation.addedNodes) {
        if (node.nodeType === 1 && 
            !node.classList?.contains('cssci-badge') && 
            !node.classList?.contains('badge-group') &&
            node.id !== 'cssci-global-tooltip' &&
            !node.hasAttribute('data-cssci-detail-container')) {
          hasValidMutation = true;
          break;
        }
      }
      if (hasValidMutation) break;
    }

    if (hasValidMutation) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(injectBadges, 400);
    }
  });

  // ── 启动 ──────────────────────────────────────────────────────
  chrome.storage.local.get(['cnki_marker_enabled_cats'], (data) => {
    enabledCats = data.cnki_marker_enabled_cats || {};
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.cnki_marker_enabled_cats) {
      enabledCats = changes.cnki_marker_enabled_cats.newValue || {};
      clearAndReinject();
    }
  });

  loadData().then(() => {
    injectBadges();
    observer.observe(document.body, { childList: true, subtree: true });

    let nCssci = 0, nPku = 0, nAmi = 0, nNssf = 0;
    const values = Object.values(INDEX);
    for (let v of values) {
      const t = v.t || v.type || v.c || v.cat || '';
      if (t.includes('CSSCI')) nCssci++;
      if (t.includes('北大核心') || t.includes('中文核心')) nPku++;
      if (t.includes('AMI')) nAmi++;
      if (t.includes('国家社科基金')) nNssf++;
    }
    try { chrome.storage.local.set({ cssciReady: true, nCssci, nPku, nAmi, nNssf }); } catch (_) {}
  });
})();