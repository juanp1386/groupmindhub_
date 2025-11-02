(() => {
  try { console.log('[GMH] Entry script boot at', new Date().toISOString()); } catch(e) {}
  const entryJsonEl = document.getElementById('__entry_json');
  let parsedEntry = {};
  try {
    parsedEntry = entryJsonEl ? JSON.parse(entryJsonEl.textContent || '{}') : {};
  } catch (error) {
    parsedEntry = {};
  }
  const makeId = () => (window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : `tmp_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`);
  const users = [
    { id: 'ana', name: 'Ana' },
    { id: 'ben', name: 'Ben' },
    { id: 'chen', name: 'Chen' },
    { id: 'devi', name: 'Devi' },
    { id: 'eli', name: 'Eli' },
    { id: 'demo', name: 'Demo' },
  ];
  let storedSimUser = null;
  try {
    storedSimUser = window.localStorage ? localStorage.getItem('gmh_sim_user') : null;
  } catch (error) {
    storedSimUser = null;
  }
  let currentUserId = users[0].id;
  if (storedSimUser) {
    for (let i = 0; i < users.length; i += 1) {
      if (users[i].id === storedSimUser) {
        currentUserId = users[i].id;
        break;
      }
    }
  }

  const deepClone = (obj) => JSON.parse(JSON.stringify(obj || {}));
  const escapeHtml = (str) => (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function normalizeSection(raw, parentId) {
    const safeRaw = raw || {};
    const rawChildren = Array.isArray(safeRaw.children) ? safeRaw.children : [];
    const children = rawChildren.map((child) => normalizeSection(child, safeRaw.id));
    const headingSource = safeRaw.heading !== undefined && safeRaw.heading !== null && safeRaw.heading !== ''
      ? safeRaw.heading
      : (safeRaw.heading_text || '');
    const heading = String(headingSource || '');
    const headingBlockId = safeRaw.heading_block_id || (safeRaw.id ? `h_${safeRaw.id}` : makeId());
    let body = safeRaw.body !== undefined && safeRaw.body !== null ? String(safeRaw.body) : '';
    let bodyBlockId = safeRaw.body_block_id || null;
    const rawBodyBlocks = Array.isArray(safeRaw.body_blocks) ? safeRaw.body_blocks : [];
    if (!body && rawBodyBlocks.length) {
      body = String(rawBodyBlocks[0].text || '');
      bodyBlockId = rawBodyBlocks[0].id || bodyBlockId;
    }
    if (body && !bodyBlockId) {
      bodyBlockId = safeRaw.id ? `p_${safeRaw.id}` : `p_${makeId()}`;
    }
    return {
      id: safeRaw.id || makeId(),
      heading: heading,
      heading_block_id: headingBlockId,
      body: body,
      body_block_id: bodyBlockId,
      children: children,
      parent_section_id: parentId || null,
      numbering: safeRaw.numbering || '',
      depth: safeRaw.depth || (parentId ? 2 : 1),
      isNew: false,
    };
  }

  const ROOT_SECTION_ID = '__root__';
  const isVirtualSectionId = (sectionId) => sectionId === ROOT_SECTION_ID;

  const entryState = {
    id: parsedEntry && parsedEntry.id ? parsedEntry.id : null,
    projectId: parsedEntry && parsedEntry.project_id ? parsedEntry.project_id : null,
    title: parsedEntry && parsedEntry.title ? parsedEntry.title : '',
    version: parsedEntry && parsedEntry.version ? parsedEntry.version : 1,
    votes: parsedEntry && parsedEntry.votes ? parsedEntry.votes : 0,
    blocks: deepClone((parsedEntry && parsedEntry.blocks) || []),
    sectionsTree: ((parsedEntry && parsedEntry.sections_tree) || []).map((section) => normalizeSection(section)),
  };
  try { console.log('[GMH] sectionsTree size:', (entryState.sectionsTree||[]).length); } catch(e) {}

  const entryContainer = document.getElementById('entrySections');
  const composerArea = document.getElementById('composerArea');
  const workspaceShell = document.getElementById('workspaceShell');
  const candidateListEl = document.getElementById('candidatePoolList');
  const candidateEmptyEl = document.getElementById('candidatePoolEmpty');
  const queueListEl = document.getElementById('waitingQueueList');
  const queueEmptyEl = document.getElementById('waitingQueueEmpty');
  const changeHelpEl = document.getElementById('changeHelp');
  const liveChecksChip = document.getElementById('liveChecksChip');
  const paneMaxButtons = Array.from(document.querySelectorAll('[data-pane-max]'));
  const layoutResetBtn = document.querySelector('[data-pane-layout-reset]');
  const anchorRow = document.getElementById('anchorRow');
  const anchorScope = document.getElementById('anchorScope');
  const anchorUpBtn = document.querySelector('[data-anchor-shift="up"]');
  const anchorDownBtn = document.querySelector('[data-anchor-shift="down"]');
  const urlParams = new URLSearchParams(window.location.search || '');

  const WORKSPACE_LAYOUT_KEY = 'gmh_workspace_layout_v1';
  const WORKSPACE_FOCUS_KEY = 'gmh_workspace_focus_section';
  const WORKSPACE_TIMER_KEY = 'gmh_workspace_timer_map';
  const DRAFT_STORAGE_KEY = 'gmh_saved_draft';
  const workspaceState = {
    focusedSectionId: null,
    paneWidths: { doc: 0.38, candidates: 0.32, editor: 0.3 },
    maximized: '',
    timers: new Map(),
    pendingProposalFocus: null,
    openDiffOnFocus: false,
  };
  let timerInterval = null;

  function loadWorkspaceLayout() {
    try {
      const stored = JSON.parse(localStorage.getItem(WORKSPACE_LAYOUT_KEY) || '{}');
      if (stored && typeof stored === 'object') {
        if (stored.paneWidths) {
          const { doc, candidates, editor } = stored.paneWidths;
          if (typeof doc === 'number' && typeof candidates === 'number' && typeof editor === 'number') {
            workspaceState.paneWidths = { doc, candidates, editor };
          }
        }
        if (typeof stored.maximized === 'string') {
          workspaceState.maximized = stored.maximized;
        }
      }
      const savedTimers = JSON.parse(localStorage.getItem(WORKSPACE_TIMER_KEY) || '{}');
      if (savedTimers && typeof savedTimers === 'object') {
        Object.keys(savedTimers).forEach((key) => {
          const value = savedTimers[key];
          if (typeof value === 'number' && Number.isFinite(value)) {
            workspaceState.timers.set(key, value);
          }
        });
      }
      const savedFocus = localStorage.getItem(WORKSPACE_FOCUS_KEY);
      if (savedFocus) {
        workspaceState.focusedSectionId = savedFocus;
      }
    } catch (error) {
      console.warn('[GMH] Failed to load workspace layout', error);
    }
  }

  function persistWorkspaceLayout() {
    try {
      const payload = {
        paneWidths: workspaceState.paneWidths,
        maximized: workspaceState.maximized || '',
      };
      localStorage.setItem(WORKSPACE_LAYOUT_KEY, JSON.stringify(payload));
      const timersObj = {};
      workspaceState.timers.forEach((value, key) => {
        timersObj[key] = value;
      });
      localStorage.setItem(WORKSPACE_TIMER_KEY, JSON.stringify(timersObj));
      if (workspaceState.focusedSectionId) {
        localStorage.setItem(WORKSPACE_FOCUS_KEY, workspaceState.focusedSectionId);
      }
    } catch (error) {
      console.warn('[GMH] Failed to persist workspace layout', error);
    }
  }

  function applyPaneLayout() {
    if (!workspaceShell) return;
    const panes = workspaceShell.querySelectorAll('[data-pane]');
    const total = workspaceState.paneWidths.doc + workspaceState.paneWidths.candidates + workspaceState.paneWidths.editor;
    panes.forEach((pane) => {
      const key = pane.getAttribute('data-pane-key');
      if (!key || !workspaceState.paneWidths[key]) return;
      const ratio = workspaceState.paneWidths[key] / (total || 1);
      pane.style.flex = `${ratio} 1 0`;
    });
    if (workspaceState.maximized) {
      workspaceShell.setAttribute('data-max', workspaceState.maximized);
    } else {
      workspaceShell.removeAttribute('data-max');
    }
    paneMaxButtons.forEach((btn) => {
      const target = btn.getAttribute('data-pane-max');
      const isActive = !!workspaceState.maximized && target === workspaceState.maximized;
      if (btn.tagName === 'BUTTON') {
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      }
      btn.classList.toggle('is-active', isActive);
    });
  }

  function setMaximized(target) {
    if (workspaceState.maximized === target) {
      workspaceState.maximized = '';
    } else {
      workspaceState.maximized = target;
    }
    applyPaneLayout();
    persistWorkspaceLayout();
  }

  function resetWorkspaceLayout() {
    workspaceState.paneWidths = { doc: 0.38, candidates: 0.32, editor: 0.3 };
    workspaceState.maximized = '';
    applyPaneLayout();
    persistWorkspaceLayout();
  }

  function saveTimerSeed(changeId) {
    if (!workspaceState.timers.has(changeId)) {
      // Use a 24h countdown window for proposal decisions
      const base = Date.now() + 24 * 60 * 60 * 1000;
      workspaceState.timers.set(changeId, base);
    }
  }

  loadWorkspaceLayout();
  const focusFromUrl = urlParams.get('focus');
  if (focusFromUrl) {
    workspaceState.focusedSectionId = focusFromUrl;
  }
  const proposalFromUrl = urlParams.get('proposal');
  if (proposalFromUrl) {
    workspaceState.pendingProposalFocus = proposalFromUrl;
  }
  if ((urlParams.get('view') || '') === 'diff') {
    workspaceState.openDiffOnFocus = true;
  }
  applyPaneLayout();
  attachGutterHandlers();
  paneMaxButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-pane-max');
      if (target === 'doc' || target === 'candidates' || target === 'editor') {
        setMaximized(target);
      } else {
        setMaximized('');
      }
    });
  });
  if (layoutResetBtn) {
    layoutResetBtn.addEventListener('click', () => {
      resetWorkspaceLayout();
    });
  }

  if (anchorUpBtn) {
    anchorUpBtn.addEventListener('click', (event) => {
      event.preventDefault();
      shiftAnchor(-1);
    });
  }
  if (anchorDownBtn) {
    anchorDownBtn.addEventListener('click', (event) => {
      event.preventDefault();
      shiftAnchor(1);
    });
  }

  const sectionLookup = new Map();
  const sectionPathLookup = new Map();
  const sectionParentHeadingLookup = new Map();
  const blockToSectionId = new Map();

  function getVirtualSectionMeta() {
    const nextNumber = String((entryState.sectionsTree ? entryState.sectionsTree.length : 0) + 1);
    return {
      id: ROOT_SECTION_ID,
      heading: 'New section proposals',
      numbering: nextNumber,
      depth: 1,
      virtual: true,
    };
  }

  function registerVirtualSections() {
    sectionLookup.set(ROOT_SECTION_ID, getVirtualSectionMeta());
  }

  function getTopLevelOrder() {
    return (entryState.sectionsTree || []).map((section) => section.id);
  }

  function defaultAnchorSectionId() {
    const order = getTopLevelOrder();
    return order.length ? order[order.length - 1] : null;
  }

  function resolveHeadingBlockId(sectionId) {
    if (!sectionId) return null;
    const meta = sectionLookup.get(sectionId);
    return meta ? meta.heading_block_id : null;
  }

  function computeInsertionNumber(afterSectionId) {
    const order = getTopLevelOrder();
    if (!order.length) return 1;
    if (!afterSectionId) return 1;
    const idx = order.indexOf(afterSectionId);
    return idx >= 0 ? idx + 2 : order.length + 1;
  }

  function formatSectionLabel(sectionId) {
    const meta = sectionLookup.get(sectionId);
    if (!meta) return 'Section';
    const heading = (meta.heading || '').trim() || '(untitled section)';
    const numbering = meta.numbering ? `${meta.numbering} ` : '';
    return `${numbering}${heading}`.trim();
  }

  function setAnchorAfterSection(sectionId, options = {}) {
    draft.anchorAfterSectionId = sectionId || null;
    draft.anchorAfterBlockId = resolveHeadingBlockId(sectionId);
    if (draft.sectionId === ROOT_SECTION_ID) {
      draft.baseNumbering = String(computeInsertionNumber(sectionId));
    }
    if (!options.silent) {
      updateAnchorControls();
      updateComposerPreview();
    }
  }

  function updateAnchorControls() {
    if (!anchorRow || !anchorScope) return;
    if (!draft.active || draft.sectionId !== ROOT_SECTION_ID) {
      anchorRow.style.display = 'none';
      anchorScope.textContent = 'Document start';
      clearAnchorHighlight();
      return;
    }
    anchorRow.style.display = '';
    const order = getTopLevelOrder();
    const anchorId = draft.anchorAfterSectionId;
    let idx = anchorId ? order.indexOf(anchorId) : -1;
    if (idx < -1) idx = -1;
    const label = idx >= 0 ? formatSectionLabel(anchorId) : 'Document start';
    anchorScope.textContent = label;
    if (anchorUpBtn) {
      anchorUpBtn.disabled = idx < 0;
    }
    if (anchorDownBtn) {
      let canDown = false;
      if (order.length) {
        if (idx === -1) {
          canDown = true;
        } else if (idx < order.length - 1) {
          canDown = true;
        }
      }
      anchorDownBtn.disabled = !canDown;
    }
    updateAnchorHighlight();
  }

  function updateAnchorHighlight() {
    if (!entryContainer) return;
    entryContainer.classList.remove('anchor-top');
    entryContainer.querySelectorAll('.section-node-anchor').forEach((node) => node.classList.remove('section-node-anchor'));
    if (!draft.active || draft.sectionId !== ROOT_SECTION_ID) {
      return;
    }
    const anchorId = draft.anchorAfterSectionId;
    if (!anchorId) {
      entryContainer.classList.add('anchor-top');
      return;
    }
    const node = entryContainer.querySelector(`.section-node[data-section-id="${anchorId}"]`);
    if (node) {
      node.classList.add('section-node-anchor');
    }
  }

  function clearAnchorHighlight() {
    if (!entryContainer) return;
    entryContainer.classList.remove('anchor-top');
    entryContainer.querySelectorAll('.section-node-anchor').forEach((node) => node.classList.remove('section-node-anchor'));
  }

  function shiftAnchor(delta) {
    if (!draft.active || draft.sectionId !== ROOT_SECTION_ID) return;
    const order = getTopLevelOrder();
    if (!order.length) return;
    let idx = draft.anchorAfterSectionId ? order.indexOf(draft.anchorAfterSectionId) : -1;
    if (idx === -1 && delta < 0) {
      return;
    }
    let nextIdx = idx + delta;
    if (idx === -1 && delta > 0) {
      nextIdx = 0;
    }
    if (nextIdx < -1) {
      nextIdx = -1;
    }
    if (nextIdx >= order.length) {
      return;
    }
    const nextSectionId = nextIdx >= 0 ? order[nextIdx] : null;
    setAnchorAfterSection(nextSectionId);
  }
  let currentHighlightId = null;

  window.__gmhStartDraft = function(sectionId) {
    try { console.log('[GMH] __gmhStartDraft invoked with', sectionId); } catch(e) {}
    if (!sectionId) return false;
    startDraft(sectionId);
    if (composerArea && composerArea.scrollIntoView) {
      composerArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    return false;
  };
  try { console.log('[GMH] __gmhStartDraft is ready'); } catch(e) {}

  if (entryContainer) {
    entryContainer.addEventListener('click', (event) => {
      const editBtn = event.target.closest('.section-edit');
      if (editBtn) {
        const sectionId = editBtn.getAttribute('data-section-id');
        try { console.log('[GMH] container click; resolved sectionId =', sectionId); } catch(e) {}
        if (!sectionId) return;
        event.preventDefault();
        window.__gmhStartDraft(sectionId);
        setFocusedSection(sectionId);
        return;
      }
      const addBtn = event.target.closest('.section-add');
      if (addBtn) {
        const sectionId = addBtn.getAttribute('data-section-id');
        if (!sectionId) return;
        event.preventDefault();
        startNewSectionDraft({ afterSectionId: sectionId });
        return;
      }
      const rootBtn = event.target.closest('[data-root-focus]');
      if (rootBtn) {
        event.preventDefault();
        setFocusedSection(ROOT_SECTION_ID);
        renderCandidatePane();
        return;
      }
      const sectionNode = event.target.closest('.section-node');
      if (sectionNode) {
        const sectionId = sectionNode.getAttribute('data-section-id');
        setFocusedSection(sectionId);
      }
    });
  }

  function recomputeNumbering(nodes, prefix = '', depth = 1, parentId = null, parentHeadingId = null, pathPrefix = []) {
    nodes.forEach((node, idx) => {
      const numbering = prefix ? `${prefix}.${idx + 1}` : `${idx + 1}`;
      const path = pathPrefix.concat(idx);
      node.numbering = numbering;
      node.depth = depth;
      node.parent_section_id = parentId;
      sectionLookup.set(node.id, node);
      sectionPathLookup.set(node.id, path);
      sectionParentHeadingLookup.set(node.id, parentHeadingId);
      if (node.heading_block_id) {
        blockToSectionId.set(String(node.heading_block_id), node.id);
      }
      if (node.body_block_id) {
        blockToSectionId.set(String(node.body_block_id), node.id);
      }
      recomputeNumbering(node.children, numbering, depth + 1, node.id, node.heading_block_id, path);
    });
  }

  recomputeNumbering(entryState.sectionsTree);

  const changeState = { list: [] };

  const draft = {
    active: false,
    sectionId: null,
    originalNodes: [],
    workingNodes: [],
    parentHeadingId: null,
    baseNumbering: '',
    baseDepth: 1,
    anchorAfterSectionId: null,
    anchorAfterBlockId: null,
  };

  window.__gmhDebug = Object.assign(window.__gmhDebug || {}, { entryState, changeState, draft });

  const cloneSection = (node) => ({
    id: node.id,
    heading: node.heading,
    heading_block_id: node.heading_block_id,
    body: node.body,
    body_block_id: node.body_block_id,
    children: node.children.map((child) => cloneSection(child)),
    parent_section_id: node.parent_section_id,
    numbering: node.numbering,
    depth: node.depth,
    isNew: node.isNew || false,
  });

  function findSectionPath(nodes, targetId, path = []) {
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      if (node.id === targetId) {
        return path.concat(i);
      }
      const childPath = findSectionPath(node.children, targetId, path.concat(i));
      if (childPath) {
        return childPath;
      }
    }
    return null;
  }

  function getContextForPath(nodes, path) {
    let list = nodes;
    let node = null;
    for (let i = 0; i < path.length; i += 1) {
      const index = path[i];
      node = list[index];
      if (i === path.length - 1) {
        return { list, index, node };
      }
      list = node.children;
    }
    return null;
  }

  function getParentContext(nodes, path) {
    if (path.length <= 1) {
      return null;
    }
    return getContextForPath(nodes, path.slice(0, -1));
  }

  function assignDraftNumbering(node, prefix, depth) {
    if (!node) return;
    node.numbering = prefix;
    node.depth = depth;
    node.children.forEach((child, idx) => {
      child.parent_section_id = node.id;
      assignDraftNumbering(child, `${prefix}.${idx + 1}`, depth + 1);
    });
  }

  function ensureFocusedSection() {
    if (workspaceState.focusedSectionId && (sectionLookup.has(workspaceState.focusedSectionId) || isVirtualSectionId(workspaceState.focusedSectionId))) {
      return;
    }
    const firstSection = entryState.sectionsTree[0];
    workspaceState.focusedSectionId = firstSection ? firstSection.id : ROOT_SECTION_ID;
    persistWorkspaceLayout();
  }

  function setFocusedSection(sectionId) {
    if (!sectionId) return;
    const virtual = isVirtualSectionId(sectionId);
    if (!virtual && !sectionLookup.has(sectionId)) return;
    if (workspaceState.focusedSectionId === sectionId) {
      highlightFocusedSection();
      renderCandidatePane();
      return;
    }
    workspaceState.focusedSectionId = sectionId;
    persistWorkspaceLayout();
    highlightFocusedSection();
    renderCandidatePane();
  }

  function highlightFocusedSection() {
    if (!entryContainer) return;
    entryContainer.querySelectorAll('.section-node-focused').forEach((node) => node.classList.remove('section-node-focused'));
    if (!workspaceState.focusedSectionId) return;
    if (isVirtualSectionId(workspaceState.focusedSectionId)) return;
    const target = entryContainer.querySelector(`.section-node[data-section-id="${workspaceState.focusedSectionId}"]`);
    if (target) {
      target.classList.add('section-node-focused');
      target.scrollIntoView({ block: 'nearest' });
    }
  }

  function updateSectionStatusChips() {
    document.querySelectorAll('.section-node .section-status-chip').forEach((chip) => {
      const node = chip.closest('.section-node');
      if (!node) return;
      const sectionId = node.getAttribute('data-section-id');
      const bucket = changeState.buckets ? changeState.buckets.get(sectionId) : null;
      const isVoting = bucket && Array.isArray(bucket.pool) && bucket.pool.length > 0;
      const rootAnchorList = changeState.rootAnchors ? changeState.rootAnchors.get(sectionId) : null;
      if (isVoting) {
        chip.textContent = '🗳 Voting';
        chip.dataset.sectionStatus = 'voting';
        chip.setAttribute('aria-label', 'Section status: voting');
      } else if (rootAnchorList && rootAnchorList.length) {
        const countLabel = rootAnchorList.length === 1 ? '1 new section waiting below' : `${rootAnchorList.length} new sections waiting below`;
        chip.textContent = `🆕 ${countLabel}`;
        chip.dataset.sectionStatus = 'voting';
        chip.setAttribute('aria-label', 'Section status: new top-level section voting');
      } else {
        chip.textContent = '• Idle';
        chip.dataset.sectionStatus = 'idle';
        chip.setAttribute('aria-label', 'Section status: idle');
      }
    });
  }

  function resolveRootAnchor(change) {
    const anchors = Array.isArray(change && change.anchors) ? change.anchors : [];
    for (let i = 0; i < anchors.length; i += 1) {
      const raw = anchors[i];
      if (typeof raw !== 'string') continue;
      const parts = raw.split(':');
      if (parts.length < 2) continue;
      const ref = parts[1];
      if (!ref) continue;
      const candidates = new Set();
      candidates.add(ref);
      if (!ref.startsWith('h_') && !ref.startsWith('p_')) {
        candidates.add(`h_${ref}`);
        candidates.add(`p_${ref}`);
      }
      const trimmed = ref.replace(/^h_/, '').replace(/^p_/, '');
      candidates.add(`h_${trimmed}`);
      candidates.add(`p_${trimmed}`);
      for (const candidate of candidates) {
        if (blockToSectionId.has(candidate)) {
          return {
            sectionId: blockToSectionId.get(candidate),
            position: parts[0] || 'after',
          };
        }
      }
    }
    return { sectionId: null, position: 'start' };
  }

  function buildRootProposalNode(title, changes, extraClass) {
    const node = document.createElement('div');
    node.className = `section-node root-proposal depth-1${extraClass ? ` ${extraClass}` : ''}`;
    const header = document.createElement('div');
    header.className = 'section-header';
    const row = document.createElement('div');
    row.className = 'section-row';
    const heading = document.createElement('div');
    heading.className = 'section-heading';
    const headingSpan = document.createElement('span');
    headingSpan.className = 'section-heading-text';
    headingSpan.textContent = title;
    heading.appendChild(headingSpan);
    row.appendChild(heading);
    const chip = document.createElement('span');
    chip.className = 'section-status-chip';
    chip.dataset.sectionStatus = 'voting';
    chip.textContent = '🆕 Voting';
    chip.setAttribute('aria-label', 'Section status: new top-level section voting');
    row.appendChild(chip);
    header.appendChild(row);
    node.appendChild(header);
    const list = document.createElement('ul');
    list.className = 'root-proposal-list';
    const display = changes.slice(0, 3);
    display.forEach((change) => {
      const li = document.createElement('li');
      li.innerHTML = `<strong>${escapeHtml(change.summary || 'New section proposal')}</strong>`;
      list.appendChild(li);
    });
    if (changes.length > 3) {
      const remainder = document.createElement('li');
      remainder.textContent = `+${changes.length - 3} more proposals`;
      list.appendChild(remainder);
    }
    node.appendChild(list);
    const actions = document.createElement('div');
    actions.className = 'root-proposal-actions';
    const focusBtn = document.createElement('button');
    focusBtn.type = 'button';
    focusBtn.className = 'ghost';
    focusBtn.setAttribute('data-root-focus', 'true');
    focusBtn.textContent = 'Review proposals';
    actions.appendChild(focusBtn);
    node.appendChild(actions);
    return node;
  }

  function updateRootStartIndicator() {
    if (!entryContainer) return;
    entryContainer.querySelectorAll('.root-proposal-banner').forEach((el) => el.remove());
    const startProposals = changeState.rootStartProposals || [];
    if (!startProposals.length) return;
    const banner = buildRootProposalNode('New section proposals at document start', startProposals, 'root-proposal-banner');
    entryContainer.insertBefore(banner, entryContainer.firstChild || null);
  }

  function updateRootAnchorIndicators() {
    if (!entryContainer) return;
    entryContainer.querySelectorAll('.root-proposal-inline').forEach((el) => el.remove());
    if (!changeState.rootAnchors) return;
    changeState.rootAnchors.forEach((list, sectionId) => {
      if (!Array.isArray(list) || !list.length) return;
      const target = entryContainer.querySelector(`.section-node[data-section-id="${sectionId}"]`);
      if (!target) return;
      const label = `New section proposals after ${formatSectionLabel(sectionId)}`;
      const node = buildRootProposalNode(label, list, 'root-proposal-inline');
      node.classList.add(`depth-${Math.max(1, (sectionLookup.get(sectionId) || {}).depth || 1)}`);
      target.insertAdjacentElement('afterend', node);
    });
  }

  function refreshRootIndicators() {
    updateRootStartIndicator();
    updateRootAnchorIndicators();
  }

  const MAX_POOL_ITEMS = 3;

  function prepareChangeBuckets() {
    const buckets = new Map();
    const history = [];
    const rootAnchors = new Map();
    const rootStartProposals = [];
    (changeState.list || []).forEach((change) => {
      if (!change || typeof change !== 'object') return;
      if (change.status === 'merged') {
        history.push(change);
        return;
      }
      const targetSectionId = change.target_section_id || (change.target_section_block_id ? String(change.target_section_block_id).replace(/^h_/, '') : null);
      if (!targetSectionId) return;
      if (!buckets.has(targetSectionId)) {
        buckets.set(targetSectionId, { pool: [], queue: [] });
      }
      const bucket = buckets.get(targetSectionId);
      if (change.status === 'needs_update' || change.status === 'draft') {
        bucket.queue.push(change);
      } else {
        const targetList = bucket.pool.length < MAX_POOL_ITEMS ? bucket.pool : bucket.queue;
        targetList.push(change);
      }
      if (targetSectionId === ROOT_SECTION_ID) {
        const anchorMeta = resolveRootAnchor(change);
        if (anchorMeta.sectionId) {
          const key = anchorMeta.sectionId;
          if (!rootAnchors.has(key)) {
            rootAnchors.set(key, []);
          }
          rootAnchors.get(key).push(change);
        } else {
          rootStartProposals.push(change);
        }
      }
      saveTimerSeed(String(change.id));
    });
    changeState.buckets = buckets;
    changeState.history = history;
    changeState.rootAnchors = rootAnchors;
    changeState.rootStartProposals = rootStartProposals;
  }

  function buildKeepCard(sectionId) {
    if (isVirtualSectionId(sectionId) || !sectionLookup.has(sectionId) || sectionLookup.get(sectionId)?.virtual) {
      return null;
    }
    const card = document.createElement('div');
    card.className = 'candidate-card';
    card.setAttribute('role', 'listitem');
    card.innerHTML = `
      <div class="candidate-head">
        <div>
          <div class="candidate-title">Keep as-is</div>
          <div class="candidate-meta">Current document · Section ${escapeHtml(sectionLookup.get(sectionId)?.numbering || '')}</div>
        </div>
        <div class="candidate-score">Support <strong>100%</strong></div>
      </div>
      <div class="candidate-actions" style="justify-content:flex-end;">
        <button class="ghost" data-action="diff-keep">View context</button>
      </div>
    `;
    card.querySelector('[data-action="diff-keep"]').addEventListener('click', () => {
      alert('Keep-as-is uses the current published section. Detailed diff coming soon.');
    });
    return card;
  }

  function formatTimer(delta) {
    if (delta <= 0) return 'decision due';
    const seconds = Math.floor(delta / 1000);
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) {
      return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function buildDiffPanel(change) {
    const beforeLines = extractDiffLines(change.before_outline, 'before');
    const afterLines = extractDiffLines(change.after_outline, 'after');
    if (!beforeLines.length && !afterLines.length) return '';
    return `<div class="diff-grid" data-diff-body hidden>${renderDiffBlock(beforeLines, 'Before')} ${renderDiffBlock(afterLines, 'After')}</div>`;
  }

  function buildCandidateCard(change, placement) {
    const yes = change.yes || 0;
    const no = change.no || 0;
    const score = yes - no;
    const requiredYes = change.required_yes_votes || 0;
    const totalVotes = yes + no;
    const approvalPct = totalVotes ? Math.round((yes / totalVotes) * 100) : 0;
    const timerId = `change-${change.id}`;
    const expiresAt = workspaceState.timers.get(String(change.id));
    const timeLeft = expiresAt ? expiresAt - Date.now() : 0;
    const diffMarkup = buildDiffPanel(change);
    const card = document.createElement('div');
    card.className = 'candidate-card';
    card.setAttribute('role', 'listitem');
    card.innerHTML = `
      <div class="candidate-head">
        <div>
          <div class="candidate-title">${escapeHtml(change.summary || 'Proposal')}</div>
          <div class="candidate-meta">#${change.id} · ${escapeHtml(change.author_name || 'Anonymous')} · base v${change.base_entry_version_int || entryState.version}</div>
          <div class="candidate-badges">${change.bundle ? '<span class="badge">Bundle</span>' : ''}</div>
        </div>
        <div class="candidate-score">
          <span class="candidate-timer" data-countdown-id="${timerId}">${formatTimer(timeLeft)}</span>
          <span>${yes}/${requiredYes || '—'} needed</span>
          <span>Score ${score >= 0 ? '+' : ''}${score}</span>
        </div>
      </div>
      <div class="candidate-actions">
        <button data-act="vote-up" data-id="${change.id}">Upvote</button>
        <button data-act="vote-down" data-id="${change.id}">Downvote</button>
        <button data-act="diff" data-id="${change.id}">Diff</button>
        <button data-act="max" data-id="${change.id}">Maximize</button>
        <span class="mini muted">${approvalPct}% support</span>
      </div>
      ${diffMarkup}
    `;

    card.querySelector('[data-act="vote-up"]').addEventListener('click', () => vote(change, 1));
    card.querySelector('[data-act="vote-down"]').addEventListener('click', () => vote(change, -1));
    const diffButton = card.querySelector('[data-act="diff"]');
    if (diffButton) {
      diffButton.addEventListener('click', () => {
        const panel = card.querySelector('[data-diff-body]');
        if (!panel) return;
        const hidden = panel.hasAttribute('hidden');
        if (hidden) {
          panel.removeAttribute('hidden');
        } else {
          panel.setAttribute('hidden', 'hidden');
        }
      });
    }
    const maxButton = card.querySelector('[data-act="max"]');
    if (maxButton) {
      maxButton.addEventListener('click', () => setMaximized('candidates'));
    }
    card.dataset.placement = placement;
    return card;
  }

  function buildQueueItem(change, index) {
    const card = document.createElement('div');
    card.className = 'queue-item';
    card.setAttribute('role', 'listitem');
    const flags = Array.isArray(change.flags) ? change.flags : [];
    const flagMarkup = flags.length ? flags.map((flag) => `<span class="badge">⚑ ${escapeHtml(flag)}</span>`).join('') : '';
    const autoRemove = change.auto_remove_threshold ? `<span class="mini muted">Will auto-remove at −${escapeHtml(String(change.auto_remove_threshold))}</span>` : '';
    card.innerHTML = `
      <div class="queue-top">
        <div>
          <div class="candidate-title">${escapeHtml(change.summary || 'Proposal')}</div>
          <div class="candidate-meta">#${change.id} · ${escapeHtml(change.author_name || 'Anonymous')}</div>
        </div>
        <div class="queue-pos">#${index + 1}</div>
      </div>
      <div class="queue-flags">${flagMarkup || '<span class="mini muted">No flags</span>'}</div>
      <div class="candidate-actions" style="justify-content:space-between;">
        <div class="stack" style="gap:4px;">
          <span class="mini muted">Downvotes: ${change.downvotes || change.no || 0}</span>
          ${autoRemove}
        </div>
        <div class="row" style="gap:8px;">
          <button data-act="queue-down" data-id="${change.id}">Downvote</button>
        </div>
      </div>
    `;
    card.querySelector('[data-act="queue-down"]').addEventListener('click', () => vote(change, -1));
    return card;
  }

  function renderCandidatePane() {
    if (!candidateListEl || !queueListEl) return;
    const sectionId = workspaceState.focusedSectionId;
    if (!sectionId) {
      candidateListEl.innerHTML = '';
      queueListEl.innerHTML = '';
      if (candidateEmptyEl) candidateEmptyEl.textContent = 'Select a section to view candidate pool.';
      if (queueEmptyEl) queueEmptyEl.textContent = 'Select a section to view the queue.';
      renderHistoryPane(null);
      return;
    }
    const virtualSection = isVirtualSectionId(sectionId);
    candidateListEl.innerHTML = '';
    queueListEl.innerHTML = '';
    const bucket = changeState.buckets ? changeState.buckets.get(sectionId) : null;
    if (bucket && Array.isArray(bucket.queue) && bucket.queue.length && !Array.isArray(bucket.pool)) {
      bucket.pool = [];
    }
    const keepCard = buildKeepCard(sectionId);
    if (keepCard) {
      candidateListEl.appendChild(keepCard);
    }
    const hasPool = bucket && bucket.pool.length;
    if (hasPool) {
      bucket.pool.forEach((change) => {
        const card = buildCandidateCard(change, 'pool');
        if (workspaceState.pendingProposalFocus && String(change.id) === String(workspaceState.pendingProposalFocus)) {
          card.classList.add('candidate-card-focus');
          setTimeout(() => {
            card.scrollIntoView({ block: 'center', behavior: 'smooth' });
          }, 100);
          workspaceState.pendingProposalFocus = null;
          if (workspaceState.openDiffOnFocus) {
            const diffPanel = card.querySelector('[data-diff-body]');
            if (diffPanel) {
              diffPanel.removeAttribute('hidden');
            }
            workspaceState.openDiffOnFocus = false;
          }
        }
        candidateListEl.appendChild(card);
      });
    }
    if (candidateEmptyEl) {
      candidateEmptyEl.textContent = virtualSection
        ? 'No new section proposals yet.'
        : 'No candidates yet. Keep current text or add a proposal.';
      candidateEmptyEl.style.display = hasPool ? 'none' : '';
    }
    const hasQueue = bucket && bucket.queue.length;
    if (hasQueue) {
      bucket.queue.forEach((change, idx) => {
        const item = buildQueueItem(change, idx);
        if (workspaceState.pendingProposalFocus && String(change.id) === String(workspaceState.pendingProposalFocus)) {
          item.classList.add('candidate-card-focus');
          setTimeout(() => {
            item.scrollIntoView({ block: 'center', behavior: 'smooth' });
          }, 100);
          workspaceState.pendingProposalFocus = null;
          workspaceState.openDiffOnFocus = false;
        }
        queueListEl.appendChild(item);
      });
    }
    if (queueEmptyEl) {
      queueEmptyEl.textContent = virtualSection
        ? 'Queue is empty for new section proposals.'
        : 'Queue is empty for this section.';
      queueEmptyEl.style.display = hasQueue ? 'none' : '';
    }
    if (changeHelpEl) {
      if (virtualSection) {
        changeHelpEl.textContent = hasPool ? 'Review and vote on proposed top-level sections.' : 'Propose a new section to kick things off.';
      } else {
        changeHelpEl.textContent = hasPool ? '' : 'No candidates yet.';
      }
    }
    ensureTimerLoop();
    renderHistoryPane(sectionId);
  }

  function renderHistoryPane(sectionId) {
    const list = document.getElementById('historyList');
    const empty = document.getElementById('historyEmpty');
    if (!list || !empty) return;
    list.innerHTML = '';
    let items = [];
    if (sectionId && changeState.history && Array.isArray(changeState.history)) {
      items = changeState.history.filter((chg) => {
        const id = chg.target_section_id || (chg.target_section_block_id ? String(chg.target_section_block_id).replace(/^h_/, '') : null);
        return id === sectionId;
      });
    }
    if (!items.length) {
      empty.style.display = '';
      return;
    }
    empty.style.display = 'none';
    items.slice(0, 10).forEach((chg) => {
      const row = document.createElement('div');
      row.className = 'update-card';
      row.setAttribute('role', 'listitem');
      row.innerHTML = `
        <h3>${escapeHtml(chg.summary || 'Change')}</h3>
        <div class="update-meta"><span>#${chg.id}</span><span>Merged</span></div>
        <div class="update-actions"><a href="/entries/${entryState.id}/?focus=${encodeURIComponent(sectionId||'')}&proposal=${chg.id}">Open</a></div>
      `;
      list.appendChild(row);
    });
  }

  function ensureTimerLoop() {
    if (timerInterval) return;
    timerInterval = window.setInterval(updateCountdownDisplays, 1000);
  }

  function updateCountdownDisplays() {
    const now = Date.now();
    document.querySelectorAll('[data-countdown-id]').forEach((node) => {
      const id = node.getAttribute('data-countdown-id');
      if (!id) return;
      const changeId = id.replace('change-', '');
      const expires = workspaceState.timers.get(changeId);
      if (!expires) return;
      const delta = expires - now;
      node.textContent = formatTimer(delta);
    });
  }

  function findAdjacentPanes(gutter) {
    if (!gutter) return null;
    let prev = gutter.previousElementSibling;
    while (prev && !prev.hasAttribute('data-pane')) {
      prev = prev.previousElementSibling;
    }
    let next = gutter.nextElementSibling;
    while (next && !next.hasAttribute('data-pane')) {
      next = next.nextElementSibling;
    }
    if (!prev || !next) return null;
    return { prev, next, prevKey: prev.getAttribute('data-pane-key'), nextKey: next.getAttribute('data-pane-key') };
  }

  function attachGutterHandlers() {
    if (!workspaceShell) return;
    const gutters = workspaceShell.querySelectorAll('.workspace-gutter');
    gutters.forEach((gutter) => {
      const adjacent = findAdjacentPanes(gutter);
      if (!adjacent || !adjacent.prevKey || !adjacent.nextKey) return;
      const onPointerDown = (event) => {
        if (event.type === 'mousedown' && event.button !== 0) return;
        event.preventDefault();
        workspaceState.maximized = '';
        applyPaneLayout();
        const initial = {};
        const panes = workspaceShell.querySelectorAll('[data-pane]');
        let shellWidth = 0;
        panes.forEach((pane) => {
          const rect = pane.getBoundingClientRect();
          shellWidth += rect.width;
          initial[pane.getAttribute('data-pane-key')] = rect.width;
        });
        const minWidthPx = 220;
        const pairTotal = initial[adjacent.prevKey] + initial[adjacent.nextKey];
        const startX = event.touches ? event.touches[0].clientX : event.clientX;

        const onMove = (moveEvent) => {
          const clientX = moveEvent.touches ? moveEvent.touches[0].clientX : moveEvent.clientX;
          const delta = clientX - startX;
          let newPrevPx = initial[adjacent.prevKey] + delta;
          newPrevPx = Math.max(minWidthPx, Math.min(pairTotal - minWidthPx, newPrevPx));
          const newNextPx = pairTotal - newPrevPx;
          workspaceState.paneWidths[adjacent.prevKey] = newPrevPx / shellWidth;
          workspaceState.paneWidths[adjacent.nextKey] = newNextPx / shellWidth;
          panes.forEach((pane) => {
            const key = pane.getAttribute('data-pane-key');
            if (key !== adjacent.prevKey && key !== adjacent.nextKey) {
              workspaceState.paneWidths[key] = initial[key] / shellWidth;
            }
          });
          applyPaneLayout();
        };

        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('touchmove', onMove);
          document.removeEventListener('mouseup', onUp);
          document.removeEventListener('touchend', onUp);
          gutter.dataset.active = 'false';
          persistWorkspaceLayout();
        };

        gutter.dataset.active = 'true';
        document.addEventListener('mousemove', onMove);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('mouseup', onUp);
        document.addEventListener('touchend', onUp);
      };

      gutter.addEventListener('mousedown', onPointerDown);
      gutter.addEventListener('touchstart', onPointerDown, { passive: false });
      gutter.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        const deltaRatio = event.key === 'ArrowLeft' ? -0.02 : 0.02;
        workspaceState.maximized = '';
        const changeRatio = deltaRatio;
        workspaceState.paneWidths[adjacent.prevKey] = Math.max(0.15, workspaceState.paneWidths[adjacent.prevKey] + changeRatio);
        workspaceState.paneWidths[adjacent.nextKey] = Math.max(0.15, workspaceState.paneWidths[adjacent.nextKey] - changeRatio);
        const total = workspaceState.paneWidths.doc + workspaceState.paneWidths.candidates + workspaceState.paneWidths.editor;
        workspaceState.paneWidths.doc /= total;
        workspaceState.paneWidths.candidates /= total;
        workspaceState.paneWidths.editor /= total;
        applyPaneLayout();
        persistWorkspaceLayout();
      });
    });
  }

  function makeNewSection() {
    const id = `ns_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36)}`;
    return {
      id,
      heading: '',
      heading_block_id: `h_${id}`,
      body: '',
      body_block_id: null,
      children: [],
      parent_section_id: null,
      numbering: '',
      depth: draft.baseDepth,
      isNew: true,
    };
  }

  function makeTopLevelSectionTemplate(insertionNumber) {
    const id = `ns_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36)}`;
    return {
      id,
      heading: '',
      heading_block_id: `h_${id}`,
      body: '',
      body_block_id: `p_${id}`,
      children: [],
      parent_section_id: null,
      numbering: String(insertionNumber || (entryState.sectionsTree ? entryState.sectionsTree.length + 1 : 1)),
      depth: 1,
      isNew: true,
    };
  }

  const helpMessage = (text) => {
    const node = document.createElement('div');
    node.className = 'help';
    node.textContent = text;
    return node;
  };

  function clearHighlight() {
    document.querySelectorAll('.section-node-active').forEach((n) => n.classList.remove('section-node-active'));
    currentHighlightId = null;
  }

  function highlightSection(sectionId) {
    if (currentHighlightId === sectionId) return;
    clearHighlight();
    const node = document.querySelector(`.section-node[data-section-id="${sectionId}"]`);
    if (node) {
      node.classList.add('section-node-active');
      currentHighlightId = sectionId;
      if (workspaceState.focusedSectionId !== sectionId) {
        workspaceState.focusedSectionId = sectionId;
        highlightFocusedSection();
        renderCandidatePane();
        persistWorkspaceLayout();
      }
    }
  }

  function renderEntry() {
    sectionLookup.clear();
    sectionPathLookup.clear();
    sectionParentHeadingLookup.clear();
    blockToSectionId.clear();
    recomputeNumbering(entryState.sectionsTree);
    registerVirtualSections();
    const container = document.getElementById('entrySections');
    container.innerHTML = '';
    const fragment = document.createDocumentFragment();
    const activeId = draft.active ? draft.sectionId : null;
    if (!entryState.sectionsTree.length) {
      fragment.appendChild(helpMessage('This entry has no sections yet. Use "Add section" to propose the first one.'));
    } else {
      const renderNodes = (nodes) => {
        nodes.forEach((section) => {
          const nodeEl = document.createElement('div');
          nodeEl.className = `section-node depth-${section.depth || 1}`;
          nodeEl.dataset.sectionId = section.id;
          if (section.id === activeId) {
            nodeEl.classList.add('section-node-active');
          }

          const header = document.createElement('div');
          header.className = 'section-header';

          const headerRow = document.createElement('div');
          headerRow.className = 'section-row';
          const heading = document.createElement('div');
          heading.className = 'section-heading';
          const numberingPrefix = section.numbering ? `${section.numbering} ` : '';
          const headingSpan = document.createElement('span');
          headingSpan.className = 'section-heading-text';
          headingSpan.textContent = `${numberingPrefix}${section.heading || '(untitled section)'}`;
          heading.appendChild(headingSpan);
          headerRow.appendChild(heading);
          const statusChip = document.createElement('span');
          statusChip.className = 'section-status-chip';
          statusChip.dataset.sectionStatus = 'idle';
          statusChip.textContent = '• Idle';
          statusChip.setAttribute('aria-label', 'Section status: idle');
          headerRow.appendChild(statusChip);

          const actions = document.createElement('div');
          actions.className = 'section-actions';
          const editBtn = document.createElement('button');
          editBtn.type = 'button';
          editBtn.className = 'section-edit';
          editBtn.dataset.sectionId = section.id;
          editBtn.innerHTML = '<span>Edit</span>';
          // Direct listener to avoid relying solely on event delegation
          editBtn.addEventListener('click', function(ev){
            ev.stopPropagation();
            window.__gmhStartDraft && window.__gmhStartDraft(section.id);
          });
          actions.appendChild(editBtn);
          if ((section.depth || 1) === 1) {
            const addBtn = document.createElement('button');
            addBtn.type = 'button';
            addBtn.className = 'section-add';
            addBtn.dataset.sectionId = section.id;
            addBtn.innerHTML = '<span>Add section below</span>';
            actions.appendChild(addBtn);
          }

          header.appendChild(headerRow);
          header.appendChild(actions);
          nodeEl.appendChild(header);

          if (section.body) {
            const body = document.createElement('div');
            body.className = 'section-body';
            body.textContent = section.body;
            nodeEl.appendChild(body);
          }

          fragment.appendChild(nodeEl);
          if (section.children.length) {
            renderNodes(section.children);
          }
        });
      };
      renderNodes(entryState.sectionsTree);
    }
    container.appendChild(fragment);
    ensureFocusedSection();
    highlightFocusedSection();
    updateSectionStatusChips();
    refreshRootIndicators();
    renderCandidatePane();
    const titleEl = document.getElementById('entryTitle');
    if (titleEl) {
      const titleText = entryState.title && entryState.title.trim() ? entryState.title : 'Untitled entry';
      titleEl.textContent = titleText;
    }
    ['entryVersion2'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = entryState.version;
    });
    ['entryVotes2'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = entryState.votes;
    });
    updateAnchorControls();
    updateAnchorHighlight();
  }

  function startDraft(sectionId) {
    try { console.log('[GMH] startDraft called for', sectionId); } catch(e) {}
    if (!sectionLookup.has(sectionId)) {
      try { console.warn('[GMH] Section not found in lookup', sectionId, 'available ids:', Array.from(sectionLookup.keys())); } catch(e) {}
      alert('Section not found.');
      return;
    }
    draft.anchorAfterSectionId = null;
    draft.anchorAfterBlockId = null;
    updateAnchorControls();
    const path = sectionPathLookup.get(sectionId) || [];
    try { console.log('[GMH] Using path', path); } catch(e) {}
    const context = getContextForPath(entryState.sectionsTree, path);
    if (!context) return;
    const originalRoot = cloneSection(context.node);
    draft.active = true;
    draft.sectionId = originalRoot.id;
    draft.originalNodes = [cloneSection(originalRoot)];
    draft.workingNodes = [cloneSection(originalRoot)];
    draft.baseNumbering = originalRoot.numbering || '1';
    draft.baseDepth = originalRoot.depth || 1;
    const parentHeadingId = sectionParentHeadingLookup.get(sectionId) || null;
    draft.parentHeadingId = parentHeadingId;
    const scopeEl = document.getElementById('sectionScope');
    if (scopeEl) {
      const label = originalRoot.numbering ? `${originalRoot.numbering} · ${originalRoot.heading || '(untitled section)'}` : (originalRoot.heading || '(untitled section)');
      scopeEl.textContent = label;
      scopeEl.style.color = 'var(--accent)';
      scopeEl.style.borderStyle = 'solid';
      scopeEl.dataset.sectionId = sectionId;
    }
    const summaryInput = document.getElementById('changeSummary');
    if (summaryInput && !summaryInput.value.trim()) {
      summaryInput.value = (`Edit ${originalRoot.numbering || ''} ${originalRoot.heading || ''}`).trim();
    }
    highlightSection(sectionId);
    renderComposer();
    try { console.log('[GMH] draft initialized', { id: draft.sectionId, base: draft.baseNumbering, depth: draft.baseDepth, childCount: (draft.workingNodes[0] && draft.workingNodes[0].children || []).length}); } catch(e) {}
  }

  function startNewSectionDraft(options = {}) {
    try { console.log('[GMH] startNewSectionDraft invoked', options); } catch (e) {}
    clearHighlight();
    clearAnchorHighlight();
    const afterSectionId = Object.prototype.hasOwnProperty.call(options, 'afterSectionId')
      ? options.afterSectionId
      : defaultAnchorSectionId();
    const insertionNumber = computeInsertionNumber(afterSectionId);
    const template = makeTopLevelSectionTemplate(insertionNumber);
    draft.active = true;
    draft.sectionId = ROOT_SECTION_ID;
    draft.originalNodes = [];
    draft.workingNodes = [template];
    draft.parentHeadingId = null;
    draft.baseNumbering = template.numbering;
    draft.baseDepth = 1;
    setAnchorAfterSection(afterSectionId, { silent: true });
    setFocusedSection(ROOT_SECTION_ID);
    renderComposer();
    const summaryInput = document.getElementById('changeSummary');
    if (summaryInput && !summaryInput.value.trim()) {
      summaryInput.value = `Add section ${template.numbering}`;
    }
    updateAnchorControls();
    updateAnchorHighlight();
    updateComposerPreview();
  }

  function clearDraft() {
    draft.active = false;
    draft.sectionId = null;
    draft.originalNodes = [];
    draft.workingNodes = [];
    draft.parentHeadingId = null;
    draft.baseNumbering = '';
    draft.baseDepth = 1;
    draft.anchorAfterSectionId = null;
    draft.anchorAfterBlockId = null;
    document.getElementById('changeSummary').value = '';
    clearHighlight();
    renderComposer();
    try { localStorage.removeItem(DRAFT_STORAGE_KEY); } catch (error) { console.warn('[GMH] Failed to clear saved draft', error); }
    if (liveChecksChip) {
      liveChecksChip.textContent = 'Live checks: stable';
    }
    clearAnchorHighlight();
    updateAnchorControls();
  }

  function saveDraftSnapshot() {
    if (!draft.active || !draft.workingNodes.length) {
      if (liveChecksChip) {
        liveChecksChip.textContent = 'Live checks: select a section first';
      }
      return;
    }
    const summaryInput = document.getElementById('changeSummary');
    const payload = {
      sectionId: draft.sectionId,
      summary: summaryInput ? summaryInput.value : '',
      workingNodes: deepClone(draft.workingNodes),
      timestamp: Date.now(),
    };
    try {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(payload));
      if (liveChecksChip) {
        liveChecksChip.textContent = 'Live checks: draft saved';
        window.setTimeout(() => {
          if (liveChecksChip.textContent === 'Live checks: draft saved') {
            liveChecksChip.textContent = 'Live checks: stable';
          }
        }, 3000);
      }
    } catch (error) {
      console.warn('[GMH] Failed to persist draft', error);
    }
  }

  function renderComposerTree(list, pathPrefix, container) {
    list.forEach((node, index) => {
      const path = pathPrefix.concat(index);
      const wrapper = document.createElement('div');
      wrapper.className = 'composer-node';
      wrapper.style.marginLeft = `${Math.max(0, node.depth - draft.baseDepth) * 16}px`;

      const header = document.createElement('h3');
      const numbering = node.numbering ? `${node.numbering} ` : '';
      const headingTitle = node.heading || '(untitled section)';
      header.textContent = `${numbering}${headingTitle}`;
      wrapper.appendChild(header);

      const fieldsWrap = document.createElement('div');
      fieldsWrap.className = 'composer-fields';

      const headingField = document.createElement('div');
      headingField.className = 'composer-field composer-field-heading';
      const headingLabel = document.createElement('label');
      headingLabel.className = 'composer-label';
      headingLabel.textContent = 'Heading';
      const headingInput = document.createElement('input');
      headingInput.type = 'text';
      headingInput.className = 'composer-input';
      headingInput.value = node.heading;
      const headingInputId = `${node.id}_heading`;
      headingInput.id = headingInputId;
      headingLabel.setAttribute('for', headingInputId);
      headingField.appendChild(headingLabel);
      headingField.appendChild(headingInput);
      fieldsWrap.appendChild(headingField);

      const bodyField = document.createElement('div');
      bodyField.className = 'composer-field composer-field-body';
      const bodyLabel = document.createElement('label');
      bodyLabel.className = 'composer-label';
      bodyLabel.textContent = 'Body';
      const bodyTextarea = document.createElement('textarea');
      bodyTextarea.className = 'composer-textarea';
      bodyTextarea.value = node.body || '';
      bodyTextarea.rows = 8;
      const bodyTextareaId = `${node.id}_body`;
      bodyTextarea.id = bodyTextareaId;
      bodyLabel.setAttribute('for', bodyTextareaId);
      bodyField.appendChild(bodyLabel);
      bodyField.appendChild(bodyTextarea);
      fieldsWrap.appendChild(bodyField);

      wrapper.appendChild(fieldsWrap);

      const controls = document.createElement('div');
      controls.className = 'composer-controls';

      const addChildBtn = document.createElement('button');
      addChildBtn.type = 'button'; addChildBtn.dataset.act = 'add-child'; addChildBtn.textContent = 'Add subsection';
      controls.appendChild(addChildBtn);

      // Allow adding a sibling even at top-level
      const addSiblingBtn = document.createElement('button');
      addSiblingBtn.type = 'button'; addSiblingBtn.dataset.act = 'add-sibling'; addSiblingBtn.textContent = 'Add sibling';
      controls.appendChild(addSiblingBtn);

      const moveUpBtn = document.createElement('button');
      moveUpBtn.type = 'button'; moveUpBtn.dataset.act = 'move-up'; moveUpBtn.textContent = 'Move up';
      if (index === 0) moveUpBtn.disabled = true;
      controls.appendChild(moveUpBtn);

      const moveDownBtn = document.createElement('button');
      moveDownBtn.type = 'button'; moveDownBtn.dataset.act = 'move-down'; moveDownBtn.textContent = 'Move down';
      if (index === list.length - 1) moveDownBtn.disabled = true;
      controls.appendChild(moveDownBtn);

      if (index > 0) {
        const indentBtn = document.createElement('button');
        indentBtn.type = 'button'; indentBtn.dataset.act = 'indent'; indentBtn.textContent = 'Indent';
        controls.appendChild(indentBtn);
      }

      if (path.length > 2) {
        const outdentBtn = document.createElement('button');
        outdentBtn.type = 'button'; outdentBtn.dataset.act = 'outdent'; outdentBtn.textContent = 'Outdent';
        controls.appendChild(outdentBtn);
      }

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button'; deleteBtn.dataset.act = 'delete'; deleteBtn.textContent = 'Delete';
      if (path.length === 1) deleteBtn.style.color = '#ff9f9f';
      controls.appendChild(deleteBtn);

      wrapper.appendChild(controls);

      headingInput.addEventListener('input', (ev) => {
        node.heading = ev.target.value;
        updateComposerPreview();
      });

      bodyTextarea.addEventListener('input', (ev) => {
        node.body = ev.target.value;
        if (node.body && !node.body_block_id) {
          node.body_block_id = `p_${node.id}`;
        }
        updateComposerPreview();
      });

      controls.querySelectorAll('button').forEach((btn) => {
        btn.addEventListener('click', () => handleComposerAction(btn.dataset.act, path));
      });

      container.appendChild(wrapper);
      if (node.children.length) {
        renderComposerTree(node.children, path, container);
      }
    });
  }

  function handleComposerAction(action, path) {
    switch (action) {
      case 'add-child':
        addChildSection(path);
        break;
      case 'add-sibling':
        addSiblingSection(path);
        break;
      case 'move-up':
        moveSection(path, -1);
        break;
      case 'move-down':
        moveSection(path, 1);
        break;
      case 'indent':
        indentSection(path);
        break;
      case 'outdent':
        outdentSection(path);
        break;
      case 'delete':
        deleteSection(path);
        break;
      default:
        break;
    }
    renderComposer();
  }

  function addChildSection(path) {
    const ctx = getContextForPath(draft.workingNodes, path);
    if (!ctx) return;
    const newNode = makeNewSection();
    newNode.parent_section_id = ctx.node.id;
    ctx.node.children.push(newNode);
  }

  function addSiblingSection(path) {
    // Support both nested and top-level sibling insertion
    if (path.length <= 1) {
      const index = path[0] || 0;
      const newNode = makeNewSection();
      newNode.parent_section_id = null;
      draft.workingNodes.splice(index + 1, 0, newNode);
      return;
    }
    const parentCtx = getParentContext(draft.workingNodes, path);
    if (!parentCtx) return;
    const siblings = parentCtx.node.children;
    const index = path[path.length - 1];
    const newNode = makeNewSection();
    newNode.parent_section_id = parentCtx.node.id;
    siblings.splice(index + 1, 0, newNode);
  }

  function deleteSection(path) {
    if (path.length === 0) return;
    if (path.length === 1) {
      draft.workingNodes = [];
      return;
    }
    const parentCtx = getParentContext(draft.workingNodes, path);
    if (!parentCtx) return;
    parentCtx.node.children.splice(path[path.length - 1], 1);
  }

  function moveSection(path, delta) {
    const parentCtx = getParentContext(draft.workingNodes, path);
    if (!parentCtx) return;
    const siblings = parentCtx.node.children;
    const index = path[path.length - 1];
    const target = index + delta;
    if (target < 0 || target >= siblings.length) return;
    [siblings[index], siblings[target]] = [siblings[target], siblings[index]];
  }

  function indentSection(path) {
    if (path.length <= 1) return;
    const parentCtx = getParentContext(draft.workingNodes, path);
    if (!parentCtx) return;
    const siblings = parentCtx.node.children;
    const index = path[path.length - 1];
    if (index === 0) return;
    const newParent = siblings[index - 1];
    const [node] = siblings.splice(index, 1);
    node.parent_section_id = newParent.id;
    newParent.children.push(node);
  }

  function outdentSection(path) {
    if (path.length <= 2) return;
    const parentCtx = getParentContext(draft.workingNodes, path);
    const grandCtx = getParentContext(draft.workingNodes, path.slice(0, -1));
    if (!parentCtx || !grandCtx) return;
    const parentList = parentCtx.node.children;
    const index = path[path.length - 1];
    const [node] = parentList.splice(index, 1);
    const insertIndex = path[path.length - 2] + 1;
    node.parent_section_id = grandCtx.node.id;
    grandCtx.node.children.splice(insertIndex, 0, node);
  }

  function collectSections(node, map) {
    if (!node) return;
    map.set(node.id, node);
    node.children.forEach((child) => collectSections(child, map));
  }

  function flattenBlocks(node, parentHeadingId, acc = []) {
    if (!node) return acc;
    acc.push({
      blockId: node.heading_block_id,
      type: 'h2',
      text: node.heading,
      parent: parentHeadingId,
      sectionId: node.id,
      isHeading: true,
    });
    const bodyText = (node.body || '').trim();
    if (bodyText) {
      if (!node.body_block_id) {
        node.body_block_id = `p_${node.id}`;
      }
      acc.push({
        blockId: node.body_block_id,
        type: 'p',
        text: node.body,
        parent: node.heading_block_id,
        sectionId: node.id,
        isHeading: false,
      });
    }
    node.children.forEach((child) => flattenBlocks(child, node.heading_block_id, acc));
    return acc;
  }

  function computeOps(originalRoot, updatedRoot, context) {
    const parentHeadingId = context.parentHeadingId || null;
    const anchorAfterId = context.anchorAfterId || null;
    let anchorUsed = false;
    function flattenAny(node) {
      if (!node) return [];
      if (node.__list && Array.isArray(node.children)) {
        let acc = [];
        node.children.forEach((child) => { acc = acc.concat(flattenBlocks(cloneSection(child), parentHeadingId)); });
        return acc;
      }
      return flattenBlocks(cloneSection(node), parentHeadingId);
    }
    const originalBlocks = flattenAny(originalRoot);
    const finalBlocks = flattenAny(updatedRoot);
    const originalBlockIds = new Set(originalBlocks.map((b) => b.blockId));
    const finalBlockIds = new Set(finalBlocks.map((b) => b.blockId));
    const deletedIds = new Set([...originalBlockIds].filter((id) => !finalBlockIds.has(id)));
    const insertedIds = new Set([...finalBlockIds].filter((id) => !originalBlockIds.has(id)));
    const ops = [];
    const affected = new Set();
    const anchors = new Set();

    originalBlocks.filter((block) => deletedIds.has(block.blockId)).reverse().forEach((block) => {
      ops.push({ type: 'DELETE_BLOCK', block_id: block.blockId });
      affected.add(block.blockId);
    });

    const originalMap = new Map(originalBlocks.map((block) => [block.blockId, block]));
    const existingFinal = finalBlocks.filter((block) => originalBlockIds.has(block.blockId));
    const existingInitial = originalBlocks.filter((block) => finalBlockIds.has(block.blockId));
    const prevExistingFinal = new Map();
    existingFinal.forEach((block, idx) => {
      prevExistingFinal.set(block.blockId, idx === 0 ? null : existingFinal[idx - 1].blockId);
    });
    const prevExistingInitial = new Map();
    existingInitial.forEach((block, idx) => {
      prevExistingInitial.set(block.blockId, idx === 0 ? null : existingInitial[idx - 1].blockId);
    });

    const seen = new Set();
    const findPrevSeen = (list, index) => {
      for (let i = index - 1; i >= 0; i -= 1) {
        const candidate = list[i].blockId;
        if (seen.has(candidate)) return candidate;
      }
      return null;
    };

    finalBlocks.forEach((block, idx) => {
      const afterId = findPrevSeen(finalBlocks, idx);
      let effectiveAfterId = afterId;
      if (insertedIds.has(block.blockId) && !effectiveAfterId && anchorAfterId && block.isHeading && !anchorUsed) {
        effectiveAfterId = anchorAfterId;
        anchorUsed = true;
      }
      if (insertedIds.has(block.blockId)) {
        ops.push({
          type: 'INSERT_BLOCK',
          after_id: effectiveAfterId,
          new_block: {
            id: block.blockId,
            type: block.type,
            text: block.text,
            parent: block.parent || null,
          },
        });
        if (effectiveAfterId) anchors.add(`after:${effectiveAfterId}`);
        affected.add(block.blockId);
      } else {
        const original = originalMap.get(block.blockId);
        const originalParent = original ? original.parent : null;
        const prevFinal = prevExistingFinal.get(block.blockId);
        const prevInitial = prevExistingInitial.get(block.blockId);
        const parentChanged = (block.parent || null) !== (originalParent || null);
        if (parentChanged || prevFinal !== prevInitial) {
          ops.push({
            type: 'MOVE_BLOCK',
            block_id: block.blockId,
            after_id: effectiveAfterId,
            new_parent: block.parent || null,
          });
          if (effectiveAfterId) anchors.add(`after:${effectiveAfterId}`);
          affected.add(block.blockId);
        }
      }
      seen.add(block.blockId);
    });

    const originalSections = new Map();
    const updatedSections = new Map();
    function collectAny(node, map) {
      if (!node) return;
      if (node.__list && Array.isArray(node.children)) {
        node.children.forEach((child) => collectSections(child, map));
      } else {
        collectSections(node, map);
      }
    }
    collectAny(originalRoot, originalSections);
    collectAny(updatedRoot, updatedSections);

    originalSections.forEach((origSection, sectionId) => {
      if (!updatedSections.has(sectionId)) return;
      const updatedSection = updatedSections.get(sectionId);
      if ((origSection.heading || '') !== (updatedSection.heading || '')) {
        ops.push({ type: 'UPDATE_TEXT', block_id: updatedSection.heading_block_id, new_text: updatedSection.heading });
        affected.add(updatedSection.heading_block_id);
      }
      const origBody = (origSection.body || '').trim();
      const updatedBody = (updatedSection.body || '').trim();
      if (origBody && updatedBody && origBody !== updatedBody) {
        const bodyId = updatedSection.body_block_id || origSection.body_block_id;
        if (bodyId) {
          ops.push({ type: 'UPDATE_TEXT', block_id: bodyId, new_text: updatedSection.body });
          affected.add(bodyId);
        }
      }
    });

    return { ops, affectedBlocks: affected, anchors: Array.from(anchors) };
  }

  function buildChangePreview(includeOutline) {
    if (!draft.active) return null;
    const useList = (draft.workingNodes.length > 1) || (draft.originalNodes.length > 1);
    const originalRoot = useList ? { __list: true, children: draft.originalNodes.map(cloneSection) } : (draft.originalNodes[0] || null);
    const updatedRoot = useList ? { __list: true, children: draft.workingNodes.map(cloneSection) } : (draft.workingNodes[0] || null);
    const result = computeOps(originalRoot, updatedRoot, {
      parentHeadingId: draft.parentHeadingId,
      anchorAfterId: draft.anchorAfterBlockId,
    });
    if (!result) return null;
    const payload = {
      ops: result.ops,
      affectedBlocks: Array.from(result.affectedBlocks || []),
      anchors: result.anchors || [],
      before_outline: '',
      after_outline: '',
    };
    if (includeOutline && payload.ops.length) {
      const outlines = computeOutlines(payload.ops);
      payload.before_outline = outlines.before;
      payload.after_outline = outlines.after;
    }
    return payload;
  }

  const cloneBlocks = (blocks) => blocks.map((block) => ({ ...block }));

  function applyOps(baseBlocks, ops) {
    const blocks = cloneBlocks(baseBlocks);
    const byId = new Map(blocks.map((block) => [block.id, block]));
    const resolveIndex = (id) => blocks.findIndex((block) => block.id === id);
    const genId = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    ops.forEach((op) => {
      if (op.type === 'UPDATE_TEXT') {
        const block = byId.get(op.block_id);
        if (block) block.text = op.new_text;
      } else if (op.type === 'INSERT_BLOCK') {
        const afterIndex = op.after_id ? resolveIndex(op.after_id) : -1;
        const block = {
          id: op.new_block.id || genId(op.new_block.type === 'h2' ? 'h' : 'p'),
          type: op.new_block.type,
          text: op.new_block.text || '',
          parent: op.new_block.parent || null,
        };
        blocks.splice(afterIndex + 1, 0, block);
        byId.set(block.id, block);
      } else if (op.type === 'DELETE_BLOCK') {
        const index = resolveIndex(op.block_id);
        if (index !== -1) {
          blocks.splice(index, 1);
          byId.delete(op.block_id);
        }
      } else if (op.type === 'MOVE_BLOCK') {
        const index = resolveIndex(op.block_id);
        if (index !== -1) {
          const [block] = blocks.splice(index, 1);
          const afterIndex = op.after_id ? resolveIndex(op.after_id) : -1;
          block.parent = op.new_parent || null;
          blocks.splice(afterIndex + 1, 0, block);
        }
      }
    });
    return blocks;
  }

  function computeOutlineDiff(beforeBlocks, afterBlocks) {
    const before = beforeBlocks.map((b) => ({ id: b.id, type: b.type, text: b.text }));
    const after = afterBlocks.map((b) => ({ id: b.id, type: b.type, text: b.text }));
    const beforeIds = new Set(before.map((b) => b.id));
    const afterIds = new Set(after.map((b) => b.id));
    const moved = new Set();
    const updated = new Set();
    const idxBefore = new Map(before.map((b, i) => [b.id, i]));
    const idxAfter = new Map(after.map((b, i) => [b.id, i]));
    before.forEach((b) => {
      if (!afterIds.has(b.id)) return;
      const a = after[idxAfter.get(b.id)];
      if (a.text !== b.text) updated.add(b.id);
      if (idxBefore.get(b.id) !== idxAfter.get(b.id)) moved.add(b.id);
    });
    const linesBefore = before
      .map((b) => {
        if (!afterIds.has(b.id)) return `- ${b.type === 'h2' ? '##' : '‣'} ${b.text}`;
        if (updated.has(b.id)) return `~ ${b.type === 'h2' ? '##' : '‣'} ${b.text}`;
        if (moved.has(b.id)) return `↔ ${b.type === 'h2' ? '##' : '‣'} ${b.text}`;
        return `  ${b.type === 'h2' ? '##' : '‣'} ${b.text}`;
      })
      .join('\n');

    const linesAfter = after
      .map((b) => {
        if (!beforeIds.has(b.id)) return `+ ${b.type === 'h2' ? '##' : '‣'} ${b.text}`;
        if (updated.has(b.id)) return `~ ${b.type === 'h2' ? '##' : '‣'} ${b.text}`;
        if (moved.has(b.id)) return `↔ ${b.type === 'h2' ? '##' : '‣'} ${b.text}`;
        return `  ${b.type === 'h2' ? '##' : '‣'} ${b.text}`;
      })
      .join('\n');

    return { before: linesBefore, after: linesAfter };
  }

  function computeOutlines(ops) {
    const afterBlocks = applyOps(entryState.blocks, ops);
    return computeOutlineDiff(entryState.blocks, afterBlocks);
  }

  function extractDiffLines(text, mode) {
    const allowed = mode === 'before' ? new Set(['-', '~', '↔']) : new Set(['+', '~', '↔']);
    const lines = (text || '').split('\n');
    const results = [];
    lines.forEach((raw) => {
      if (!raw) return;
      const trimmed = raw.trimStart();
      if (!trimmed) return;
      const prefix = trimmed[0];
      if (!allowed.has(prefix)) return;
      let type = 'neutral';
      if (prefix === '-') type = 'del';
      if (prefix === '+') type = 'add';
      if (prefix === '↔') type = 'move';
      const content = trimmed.slice(1).trimStart();
      results.push({ type, text: content || '(empty)' });
    });
    return results;
  }

  function renderDiffBlock(lines, title) {
    if (!Array.isArray(lines) || lines.length === 0) {
      return `<div class="diff-block"><h4>${escapeHtml(title)}</h4><div class="diff-body"><span class="diff-line neutral">No changes</span></div></div>`;
    }
    const markup = lines
      .map((line) => `<span class="diff-line ${line.type}">${escapeHtml(line.text)}</span>`)
      .join('');
    return `<div class="diff-block"><h4>${escapeHtml(title)}</h4><div class="diff-body">${markup}</div></div>`;
  }

  function updateComposerPreview() {
    const scopeEl = document.getElementById('sectionScope');
    const affectsEl = document.getElementById('affectsTags');
    const publishBtn = document.getElementById('btnPublish');
    if (!scopeEl || !affectsEl || !publishBtn) return;

    affectsEl.innerHTML = '';
    updateAnchorControls();

    if (!draft.active) {
      scopeEl.textContent = 'No section selected';
      scopeEl.style.color = 'var(--muted)';
      scopeEl.style.borderStyle = 'dashed';
      publishBtn.disabled = true;
      return;
    }

    if (!draft.workingNodes.length) {
      scopeEl.textContent = 'Section will be removed';
      scopeEl.style.color = 'var(--text)';
      scopeEl.style.borderStyle = 'solid';
      const preview = buildChangePreview(false);
      if (preview && preview.affectedBlocks.length) {
        preview.affectedBlocks.forEach((blockId) => {
          const tag = document.createElement('span');
          tag.className = 'tag';
          tag.textContent = blockId;
          affectsEl.appendChild(tag);
        });
        publishBtn.disabled = false;
      } else {
        publishBtn.disabled = true;
        affectsEl.appendChild(helpMessage('No changes to publish.'));
      }
      return;
    }

    const root = draft.workingNodes[0];
    assignDraftNumbering(root, draft.baseNumbering || '1', draft.baseDepth || 1);
    if (draft.sectionId === ROOT_SECTION_ID) {
      const label = (root.heading && root.heading.trim()) ? root.heading.trim() : '(untitled section)';
      const numberLabel = root.numbering ? ` ${root.numbering}` : '';
      scopeEl.textContent = `New top-level section${numberLabel ? ` ${numberLabel}` : ''} · ${label}`;
      scopeEl.style.color = 'var(--accent)';
    } else {
      if (root.numbering) {
        scopeEl.textContent = `${root.numbering} · ${root.heading || '(untitled section)'}`;
      } else {
        scopeEl.textContent = root.heading || '(untitled section)';
      }
      scopeEl.style.color = 'var(--text)';
    }
    scopeEl.style.borderStyle = 'solid';

    const preview = buildChangePreview(false);
    let canPublish = !!(preview && preview.affectedBlocks.length);
    if (canPublish && draft.sectionId === ROOT_SECTION_ID) {
      const headingFilled = !!(root.heading && root.heading.trim().length);
      const bodyFilled = !!(root.body && root.body.trim().length);
      const childPresent = Array.isArray(root.children) && root.children.length > 0;
      canPublish = headingFilled || bodyFilled || childPresent;
    }
    if (canPublish) {
      preview.affectedBlocks.forEach((blockId) => {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = blockId;
        affectsEl.appendChild(tag);
      });
      publishBtn.disabled = false;
    } else {
      publishBtn.disabled = true;
      const helpText = draft.sectionId === ROOT_SECTION_ID
        ? 'Add a heading, body text, or subsections before publishing.'
        : 'No changes to publish.';
      affectsEl.appendChild(helpMessage(helpText));
    }
  }

  async function apiJson(url, opts = {}) {
    const options = { ...opts };
    options.headers = Object.assign({ 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }, options.headers || {});
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  function renderComposer() {
    const area = document.getElementById('composerArea');
    if (!area) return;
    area.innerHTML = '';

    if (!draft.active) {
      area.appendChild(helpMessage('Select a section in the entry to begin composing a change.'));
      updateComposerPreview();
      return;
    }

    if (!draft.workingNodes.length) {
      area.appendChild(helpMessage('This change removes the selected section and all of its subsections.'));
      updateComposerPreview();
      return;
    }

    const tree = document.createElement('div');
    tree.className = 'composer-tree';
    renderComposerTree(draft.workingNodes, [], tree);
    area.appendChild(tree);

    updateComposerPreview();
  }

  async function publishChange() {
    if (!draft.active) return;
    const summaryInput = document.getElementById('changeSummary');
    const summary = summaryInput.value.trim();
    if (!summary) {
      alert('Please provide a summary for this change.');
      return;
    }
    const payload = buildChangePreview(true);
    if (!payload || !payload.ops.length) {
      alert('No changes to publish.');
      return;
    }
    try {
      document.getElementById('btnPublish').disabled = true;
      await apiJson(`/api/projects/${entryState.projectId}/changes/create`, {
        method: 'POST',
        body: JSON.stringify({
          entry_id: entryState.id,
          section_id: draft.sectionId,
          summary,
          ops_json: payload.ops,
          affected_blocks: payload.affectedBlocks,
          anchors: payload.anchors,
          before_outline: payload.before_outline,
          after_outline: payload.after_outline,
          sim_user: currentUserId,
        }),
      });
      clearDraft();
      summaryInput.value = '';
      await loadChanges();
      await refreshEntry();
    } catch (error) {
      alert('Failed to publish change.');
      console.error(error);
    } finally {
      document.getElementById('btnPublish').disabled = false;
    }
  }

  async function loadChanges() {
    try {
      if (changeHelpEl) changeHelpEl.textContent = 'Loading changes…';
      const stored = localStorage.getItem('gmh_sim_user');
      const simUser = stored || currentUserId;
      const qs = simUser ? `?sim_user=${encodeURIComponent(simUser)}` : '';
      const data = await apiJson(`/api/projects/${entryState.projectId}/changes${qs}`);
      changeState.list = data.changes || [];
      if (changeHelpEl) changeHelpEl.textContent = changeState.list.length ? '' : 'No candidates yet.';
      renderChanges();
    } catch (error) {
      if (changeHelpEl) changeHelpEl.textContent = 'Failed to load changes.';
      console.error(error);
    }
  }

  function renderChanges() {
    prepareChangeBuckets();
    updateSectionStatusChips();
    refreshRootIndicators();
    renderCandidatePane();
    persistWorkspaceLayout();
  }

  async function vote(change, value) {
    try {
      const current = change.current_user_vote || 0;
      const next = current === value ? 0 : value;
      const simUser = localStorage.getItem('gmh_sim_user') || currentUserId;
      if (!simUser) {
        alert('Select a simulated user first.');
        return;
      }
      const resp = await apiJson(`/api/changes/${change.id}/votes`, {
        method: 'POST',
        body: JSON.stringify({ value: next, sim_user: simUser }),
      });
      Object.assign(change, resp.change);
      // If auto-merge fired, refresh entry + changes to avoid stale base
      await refreshEntry();
      await loadChanges();
      renderChanges();
    } catch (error) {
      alert('Vote failed.');
      console.error(error);
    }
  }

  async function manualMerge(change) {
    try {
      const simUser = localStorage.getItem('gmh_sim_user') || currentUserId;
      if (!simUser) {
        alert('Select a simulated user first.');
        return;
      }
      if (change && typeof change.is_passing === 'boolean' && !change.is_passing) {
        const requiredYes = change.required_yes_votes || 0;
        alert(requiredYes
          ? `Need at least ${requiredYes} yes vote${requiredYes === 1 ? '' : 's'} before merging.`
          : 'This change has not met the merge threshold yet.');
        return;
      }
      const resp = await apiJson(`/api/changes/${change.id}/merge?sim_user=${encodeURIComponent(simUser)}`, { method: 'POST' });
      Object.assign(change, resp.change);
      await refreshEntry();
      renderChanges();
    } catch (error) {
      alert('Merge failed. Make sure the change has enough yes votes.');
      console.error(error);
    }
  }

  async function refreshEntry() {
    try {
      const data = await apiJson(`/api/projects/${entryState.projectId}/entry`);
      if (data.entry) {
        entryState.title = data.entry.title || entryState.title;
        entryState.version = data.entry.version || entryState.version;
        entryState.votes = data.entry.votes || entryState.votes;
        entryState.blocks = deepClone(data.entry.blocks || []);
        entryState.sectionsTree = (data.entry.sections_tree || []).map((section) => normalizeSection(section));
        recomputeNumbering(entryState.sectionsTree);
        renderEntry();
        if (draft.active && draft.sectionId) {
          highlightSection(draft.sectionId);
        }
      }
    } catch (error) {
      console.error(error);
    }
  }

  function renderUsers() {
    const select = document.getElementById('userSelect');
    select.innerHTML = '';
    users.forEach((user) => {
      const option = document.createElement('option');
      option.value = user.id;
      option.textContent = user.name;
      if (user.id === currentUserId) option.selected = true;
      select.appendChild(option);
    });
    select.addEventListener('change', () => {
      currentUserId = select.value;
      localStorage.setItem('gmh_sim_user', currentUserId);
      loadChanges();
      updateUserDot();
    });
    localStorage.setItem('gmh_sim_user', currentUserId);
    updateUserDot();
  }

  function updateUserDot() {
    const user = users.find((u) => u.id === currentUserId);
    const dot = document.getElementById('userDot');
    if (user && dot) {
      dot.textContent = user.name[0];
      dot.title = `Current user: ${user.name}`;
    }
  }

  const addSectionBtn = document.getElementById('btnAddSection');
  if (addSectionBtn) {
    addSectionBtn.addEventListener('click', (event) => {
      event.preventDefault();
      startNewSectionDraft({ afterSectionId: defaultAnchorSectionId() });
    });
  }

  document.getElementById('btnClear').addEventListener('click', clearDraft);
  document.getElementById('btnPublish').addEventListener('click', publishChange);
  const saveDraftBtn = document.getElementById('btnSaveDraft');
  if (saveDraftBtn) saveDraftBtn.addEventListener('click', saveDraftSnapshot);

  (function initLiveChecks(){
    if (!liveChecksChip) return;
    try {
      const savedDraft = JSON.parse(localStorage.getItem(DRAFT_STORAGE_KEY) || 'null');
      if (savedDraft && savedDraft.sectionId) {
        liveChecksChip.textContent = 'Live checks: draft saved';
      } else {
        liveChecksChip.textContent = 'Live checks: stable';
      }
    } catch (error) {
      liveChecksChip.textContent = 'Live checks: stable';
    }
  })();

  renderUsers();
  renderEntry();
  renderComposer();
  loadChanges();
})();
  
