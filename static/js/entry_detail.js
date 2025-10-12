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

  const sectionLookup = new Map();
  const sectionPathLookup = new Map();
  const sectionParentHeadingLookup = new Map();
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
      if (!editBtn) return;
      const sectionId = editBtn.getAttribute('data-section-id');
      try { console.log('[GMH] container click; resolved sectionId =', sectionId); } catch(e) {}
      if (!sectionId) return;
      event.preventDefault();
      window.__gmhStartDraft(sectionId);
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
    }
  }

  function renderEntry() {
    sectionLookup.clear();
    sectionPathLookup.clear();
    sectionParentHeadingLookup.clear();
    recomputeNumbering(entryState.sectionsTree);
    const container = document.getElementById('entrySections');
    container.innerHTML = '';
    const fragment = document.createDocumentFragment();
    const activeId = draft.active ? draft.sectionId : null;
    if (!entryState.sectionsTree.length) {
      fragment.appendChild(helpMessage('This entry has no sections yet.'));
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

      const headerInfo = document.createElement('div');
      const heading = document.createElement('div');
      heading.className = 'section-heading';
      const numberingPrefix = section.numbering ? `${section.numbering} ` : '';
      heading.textContent = `${numberingPrefix}${section.heading || '(untitled section)'}`;
      headerInfo.appendChild(heading);

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

          header.appendChild(headerInfo);
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
  }

  function startDraft(sectionId) {
    try { console.log('[GMH] startDraft called for', sectionId); } catch(e) {}
    if (!sectionLookup.has(sectionId)) {
      try { console.warn('[GMH] Section not found in lookup', sectionId, 'available ids:', Array.from(sectionLookup.keys())); } catch(e) {}
      alert('Section not found.');
      return;
    }
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

  function clearDraft() {
    draft.active = false;
    draft.sectionId = null;
    draft.originalNodes = [];
    draft.workingNodes = [];
    draft.parentHeadingId = null;
    draft.baseNumbering = '';
    draft.baseDepth = 1;
    document.getElementById('changeSummary').value = '';
    clearHighlight();
    renderComposer();
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

      if (path.length > 1) {
        const addSiblingBtn = document.createElement('button');
        addSiblingBtn.type = 'button'; addSiblingBtn.dataset.act = 'add-sibling'; addSiblingBtn.textContent = 'Add sibling';
        controls.appendChild(addSiblingBtn);
      }

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
    const originalBlocks = originalRoot ? flattenBlocks(cloneSection(originalRoot), parentHeadingId) : [];
    const finalBlocks = updatedRoot ? flattenBlocks(cloneSection(updatedRoot), parentHeadingId) : [];
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
      if (insertedIds.has(block.blockId)) {
        ops.push({
          type: 'INSERT_BLOCK',
          after_id: afterId,
          new_block: {
            id: block.blockId,
            type: block.type,
            text: block.text,
            parent: block.parent || null,
          },
        });
        if (afterId) anchors.add(`after:${afterId}`);
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
            after_id: afterId,
            new_parent: block.parent || null,
          });
          if (afterId) anchors.add(`after:${afterId}`);
          affected.add(block.blockId);
        }
      }
      seen.add(block.blockId);
    });

    const originalSections = new Map();
    collectSections(originalRoot, originalSections);
    const updatedSections = new Map();
    collectSections(updatedRoot, updatedSections);

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
    const originalRoot = draft.originalNodes[0] || null;
    const updatedRoot = draft.workingNodes[0] || null;
    const result = computeOps(originalRoot, updatedRoot, { parentHeadingId: draft.parentHeadingId });
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
    if (root.numbering) {
      scopeEl.textContent = `${root.numbering} · ${root.heading || '(untitled section)'}`;
    } else {
      scopeEl.textContent = root.heading || '(untitled section)';
    }
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
      document.getElementById('changeHelp').textContent = 'Loading changes…';
      const stored = localStorage.getItem('gmh_sim_user');
      const simUser = stored || currentUserId;
      const qs = simUser ? `?sim_user=${encodeURIComponent(simUser)}` : '';
      const data = await apiJson(`/api/projects/${entryState.projectId}/changes${qs}`);
      changeState.list = data.changes || [];
      document.getElementById('changeHelp').textContent = changeState.list.length ? '' : 'No changes yet.';
      renderChanges();
    } catch (error) {
      document.getElementById('changeHelp').textContent = 'Failed to load changes.';
      console.error(error);
    }
  }

  function renderChanges() {
    const list = document.getElementById('changeList');
    const historyList = document.getElementById('historyList');
    list.innerHTML = '';
    if (historyList) historyList.innerHTML = '';
    if (!changeState.list.length) return;

    changeState.list.forEach((change) => {
      const yes = change.yes || 0;
      const no = change.no || 0;
      const requiredYes = change.required_yes_votes || 0;
      const totalVotes = yes + no;
      const approval = totalVotes ? yes / totalVotes : 0;
      const passing = (typeof change.is_passing === 'boolean')
        ? change.is_passing
        : (requiredYes ? yes >= requiredYes : approval >= 0.4);
      const voted = change.current_user_vote || 0;
      const sectionLabel = change.target_section_numbering
        ? `${change.target_section_numbering} ${change.target_section_heading || ''}`.trim()
        : change.target_section_heading || 'Section';
      const beforeLines = extractDiffLines(change.before_outline, 'before');
      const afterLines = extractDiffLines(change.after_outline, 'after');
      const diffPanel = (beforeLines.length || afterLines.length)
        ? `<div class="diff-grid">${renderDiffBlock(beforeLines, 'Before')} ${renderDiffBlock(afterLines, 'After')}</div>`
        : '';

      const card = document.createElement('div');
      card.className = 'change-card';
      card.innerHTML = `
        <div class="row" style="justify-content:space-between;">
          <div>
            <strong>${escapeHtml(change.summary || 'Change')}</strong>
            <div class="mini muted">${escapeHtml(sectionLabel)}</div>
            <div class="mini muted">${escapeHtml(change.author_name || 'Unknown author')}</div>
      </div>
      <div class="row">
        <span class="pill">${yes} yes / ${no} no</span>
        ${change.status === 'merged' ? '<span class="pill green">merged</span>' : (passing ? '<span class="pill">merge-ready</span>' : '<span class="pill">needs votes</span>')}
      </div>
    </div>
    ${diffPanel}
        ${(() => {
          const yesStatus = requiredYes ? `${yes}/${requiredYes} yes` : `${yes} yes`;
          if (change.status === 'merged') {
            return `<div class="footer"><div class="mini muted">Merged · ${escapeHtml(change.author_name || 'Unknown')}</div></div>`;
          }
          return `<div class="footer">
              <div class="vote">
                <button class="${voted === 1 ? 'good' : ''}" data-act="vote-up" data-id="${change.id}">▲</button>
                <span class="score">${yes - no}</span>
                <button class="${voted === -1 ? 'bad' : ''}" data-act="vote-down" data-id="${change.id}">▼</button>
                <span class="mini muted">${yesStatus} · ${Math.round(approval * 100)}% yes</span>
              </div>
              <div class="row">
                <button ${(!passing ? 'disabled ' : '')}data-act="merge" data-id="${change.id}">Merge</button>
              </div>
            </div>`;
        })()}
      `;
      card.querySelectorAll('button[data-act="vote-up"]').forEach((btn) => btn.addEventListener('click', () => vote(change, 1)));
      card.querySelectorAll('button[data-act="vote-down"]').forEach((btn) => btn.addEventListener('click', () => vote(change, -1)));
      card.querySelectorAll('button[data-act="merge"]').forEach((btn) => btn.addEventListener('click', () => manualMerge(change)));
      if (change.status === 'merged' && historyList) {
        historyList.appendChild(card);
      } else {
        list.appendChild(card);
      }
    });
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

  document.getElementById('btnClear').addEventListener('click', clearDraft);
  document.getElementById('btnPublish').addEventListener('click', publishChange);

  renderUsers();
  renderEntry();
  renderComposer();
  loadChanges();
})();
  
