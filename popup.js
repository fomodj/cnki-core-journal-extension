/**
 * 核心期刊多库标注插件 — popup.js v2.0
 * 动态生成数据集筛选面板，支持单选 / 组全选 / 全部开启
 */
(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════════
  //  数据集定义：分组 → 分类（顺序与 content.js 保持一致）
  // ══════════════════════════════════════════════════════════════
  const GROUPS = [
    {
      id: 'cssci',
      name: 'CSSCI 系列',
      color: '#e05d5d',
      cats: [
        { id: 'cssci-source',  label: 'CSSCI来源', bg: '#fdecea', color: '#b91c1c', border: '#f5a8a8' },
        { id: 'cssci-extend',  label: 'CSSCI扩展', bg: '#e8f0fe', color: '#1a56c4', border: '#a8c4f5' },
        { id: 'cssci-collect', label: 'CSSCI集刊', bg: '#f3e8fd', color: '#6b21a8', border: '#d4a8f5' },
      ],
    },
    {
      id: 'pku',
      name: '北大核心',
      color: '#fb923c',
      cats: [
        { id: 'pku', label: '北大核心（2023）', bg: '#fff7ed', color: '#c2410c', border: '#fdba74' },
      ],
    },
    {
      id: 'ami',
      name: 'AMI 系列',
      color: '#34d399',
      cats: [
        { id: 'ami-top',           label: 'AMI顶级',     bg: '#ecfdf5', color: '#047857', border: '#6ee7b7' },
        { id: 'ami-auth',          label: 'AMI权威',     bg: '#d1fae5', color: '#065f46', border: '#34d399' },
        { id: 'ami-core',          label: 'AMI核心',     bg: '#f0fdfa', color: '#0f766e', border: '#5eead4' },
        { id: 'ami-extend',        label: 'AMI扩展',     bg: '#e0f2fe', color: '#0369a1', border: '#7dd3fc' },
        { id: 'ami-enter',         label: 'AMI入库',     bg: '#f0f9ff', color: '#0284c7', border: '#bae6fd' },
        { id: 'ami-core-journal',  label: 'AMI核心集刊', bg: '#eff6ff', color: '#1d4ed8', border: '#93c5fd' },
        { id: 'ami-enter-journal', label: 'AMI入库集刊', bg: '#eef2ff', color: '#4338ca', border: '#a5b4fc' },
        { id: 'ami-core-intl',     label: 'AMI核心国际', bg: '#faf5ff', color: '#7c3aed', border: '#c4b5fd' },
        { id: 'ami-enter-intl',    label: 'AMI入库国际', bg: '#fdf4ff', color: '#a21caf', border: '#e879f9' },
      ],
    },
    {
      id: 'nssf',
      name: '国家社科基金',
      color: '#fbbf24',
      cats: [
        { id: 'nssf', label: '国家社科基金（2025）', bg: '#fffbeb', color: '#b45309', border: '#fcd34d' },
      ],
    },
  ];

  // ── 当前启用状态（true = 显示，false = 隐藏）─────────────────────
  let enabledCats = {}; // 空对象 = 全部启用

  function isEnabled(catId) {
    return enabledCats[catId] !== false;
  }

  // ── DOM refs ────────────────────────────────────────────────────
  const dotEl    = document.getElementById('status-dot');
  const textEl   = document.getElementById('status-text');
  const nCssciEl = document.getElementById('n-cssci');
  const nPkuEl   = document.getElementById('n-pku');
  const nAmiEl   = document.getElementById('n-ami');
  const nNssfEl  = document.getElementById('n-nssf');
  const filterBody = document.getElementById('filter-body');
  const btnAll   = document.getElementById('btn-enable-all');

  // ── 保存到 storage ───────────────────────────────────────────────
  function save() {
    chrome.storage.local.set({ enabledCats });
  }

  // ── 更新单个药丸的外观 ──────────────────────────────────────────
  function syncPill(catId) {
    const pill = document.querySelector(`.pill-toggle[data-cat="${catId}"]`);
    if (!pill) return;
    if (isEnabled(catId)) {
      pill.classList.remove('disabled');
    } else {
      pill.classList.add('disabled');
    }
  }

  // ── 构建筛选面板 UI ─────────────────────────────────────────────
  function buildFilterUI() {
    filterBody.innerHTML = '';

    GROUPS.forEach(grp => {
      const grpEl = document.createElement('div');
      grpEl.className = 'cat-group';

      // 组标题
      const header = document.createElement('div');
      header.className = 'cat-group-header';

      const nameEl = document.createElement('span');
      nameEl.className = 'cat-group-name';
      nameEl.style.setProperty('--grp-color', grp.color);
      nameEl.textContent = grp.name;

      const toggleAllBtn = document.createElement('button');
      toggleAllBtn.className = 'grp-toggle-all';
      toggleAllBtn.setAttribute('data-grp', grp.id);
      toggleAllBtn.textContent = '全选/全消';
      toggleAllBtn.addEventListener('click', () => {
        const allOn = grp.cats.every(c => isEnabled(c.id));
        grp.cats.forEach(c => {
          enabledCats[c.id] = allOn ? false : true;
          syncPill(c.id);
        });
        save();
      });

      header.appendChild(nameEl);
      if (grp.cats.length > 1) header.appendChild(toggleAllBtn);

      // 药丸区
      const grid = document.createElement('div');
      grid.className = 'pill-grid';

      grp.cats.forEach(cat => {
        const pill = document.createElement('label');
        pill.className = 'pill-toggle' + (isEnabled(cat.id) ? '' : ' disabled');
        pill.setAttribute('data-cat', cat.id);
        pill.style.cssText = `background:${cat.bg};color:${cat.color};border-color:${cat.border};`;

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = isEnabled(cat.id);

        pill.appendChild(cb);
        pill.appendChild(document.createTextNode(cat.label));

        pill.addEventListener('click', (e) => {
          e.preventDefault();
          const nowOn = isEnabled(cat.id);
          enabledCats[cat.id] = !nowOn;
          syncPill(cat.id);
          save();
        });

        grid.appendChild(pill);
      });

      grpEl.appendChild(header);
      grpEl.appendChild(grid);
      filterBody.appendChild(grpEl);
    });
  }

  // ── "全部开启" 按钮 ─────────────────────────────────────────────
  btnAll.addEventListener('click', () => {
    GROUPS.forEach(grp => grp.cats.forEach(cat => {
      enabledCats[cat.id] = true;
      syncPill(cat.id);
    }));
    save();
  });

  // ── 更新统计数字 ────────────────────────────────────────────────
  function updateStats(data) {
    if (data.nCssci != null && nCssciEl) nCssciEl.textContent = data.nCssci;
    if (data.nPku   != null && nPkuEl)   nPkuEl.textContent   = data.nPku;
    if (data.nAmi   != null && nAmiEl)   nAmiEl.textContent   = data.nAmi;
    if (data.nNssf  != null && nNssfEl)  nNssfEl.textContent  = data.nNssf;

    if (data.cssciReady) {
      if (dotEl) dotEl.classList.remove('off');
      if (textEl) {
        const cnt = data.injectedCount;
        textEl.textContent = cnt != null
          ? `✅ 本页已注入 ${cnt} 枚徽章`
          : '字典引擎正常运行中…';
      }
    }
  }

  // ── 初始化 ───────────────────────────────────────────────────────
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab) return;

    const onCnki = tab.url &&
      (tab.url.includes('kns.cnki.net') || tab.url.includes('cnki.net'));

    if (!onCnki) {
      if (dotEl)  dotEl.classList.add('off');
      if (textEl) textEl.textContent = '请在知网文献检索页使用';
    }

    // 读取 storage，构建 UI
    const keys = ['cssciReady', 'nCssci', 'nPku', 'nAmi', 'nNssf', 'injectedCount', 'enabledCats'];
    chrome.storage.local.get(keys, (data) => {
      enabledCats = data.enabledCats || {};
      buildFilterUI();
      updateStats(data);

      if (onCnki && !data.cssciReady && textEl) {
        textEl.textContent = '等待页面加载字典…';
      }
    });
  });
})();
