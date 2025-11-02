/**
 * Collapsible panel controller
 * ---------------------------------------
 * Turns a static panel markup into a reusable
 * four-mode (wide/narrow × collapsed/expanded)
 * interactive component.
 */
export function createCollapsiblePanel(panel, options = {}) {
  if (!(panel instanceof HTMLElement)) {
    throw new TypeError('createCollapsiblePanel: panel must be an HTMLElement');
  }

  const {
    defaultState = 'collapsed',
    defaultMode = 'wide',
    label = null,
    collapsedLabel = null,
    expandedLabel = null,
    iconCollapsed = '\u25B8',
    iconExpanded = '\u25BE',
    breakpoint = null,
    onStateChange = null,
    onModeChange = null,
  } = options;

  const toggle = panel.querySelector('[data-panel-toggle]');
  if (!toggle) {
    throw new Error('createCollapsiblePanel: missing element with [data-panel-toggle]');
  }

  const iconEl = toggle.querySelector('[data-icon]') || null;
  const labelEl = toggle.querySelector('[data-label]') || null;
  const collapsedSlot = panel.querySelector('[data-panel-collapsed]') || null;
  const expandedSlot = panel.querySelector('[data-panel-expanded]') || null;

  const state = {
    expanded: defaultState === 'expanded',
    mode: defaultMode === 'narrow' ? 'narrow' : 'wide',
  };

  const labels = {
    collapsed: collapsedLabel ?? label ?? (labelEl ? labelEl.textContent.trim() : ''),
    expanded: expandedLabel ?? label ?? (labelEl ? labelEl.textContent.trim() : ''),
  };

  function applyState(notify = false) {
    const attrState = state.expanded ? 'expanded' : 'collapsed';
    panel.dataset.panelState = attrState;
    toggle.setAttribute('aria-expanded', String(state.expanded));
    toggle.setAttribute('aria-label', state.expanded ? `Collapse ${labels.expanded || 'panel'}` : `Expand ${labels.collapsed || 'panel'}`);
    toggle.dataset.panelState = attrState;

    if (iconEl) {
      iconEl.textContent = state.expanded ? iconExpanded : iconCollapsed;
    }
    if (labelEl) {
      labelEl.textContent = state.expanded ? labels.expanded : labels.collapsed;
      labelEl.dataset.labelState = attrState;
    }

    if (collapsedSlot) {
      collapsedSlot.hidden = state.expanded;
    }
    if (expandedSlot) {
      expandedSlot.hidden = !state.expanded;
    }

    if (notify && typeof onStateChange === 'function') {
      onStateChange(state.expanded ? 'expanded' : 'collapsed');
    }
  }

  function applyMode(notify = false) {
    const nextMode = state.mode === 'narrow' ? 'narrow' : 'wide';
    panel.dataset.panelMode = nextMode;

    if (notify && typeof onModeChange === 'function') {
      onModeChange(nextMode);
    }
  }

  function setExpanded(next, notify = true) {
    const shouldExpand = Boolean(next);
    if (shouldExpand === state.expanded) return;
    state.expanded = shouldExpand;
    applyState(notify);
  }

  function toggleState() {
    setExpanded(!state.expanded);
  }

  function changeMode(nextMode, notify = true) {
    const normalized = nextMode === 'narrow' ? 'narrow' : 'wide';
    if (normalized === state.mode) return;
    state.mode = normalized;
    applyMode(notify);
  }

  function handleToggle(event) {
    if (event) {
      event.preventDefault();
    }
    toggleState();
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleState();
    }
  }

  toggle.type = toggle.type || 'button';
  toggle.addEventListener('click', handleToggle);
  toggle.addEventListener('keydown', handleKeyDown);

  let resizeObserver = null;
  if (typeof ResizeObserver !== 'undefined' && Number.isFinite(breakpoint)) {
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const contentWidth = entry.contentRect?.width ?? panel.clientWidth;
        const nextMode = contentWidth <= breakpoint ? 'narrow' : 'wide';
        if (nextMode !== state.mode) {
          state.mode = nextMode;
          applyMode(true);
        }
      }
    });
    resizeObserver.observe(panel);
  }

  applyMode(false);
  applyState(false);

  return {
    expand() { setExpanded(true); },
    collapse() { setExpanded(false); },
    toggle: toggleState,
    get mode() { return state.mode; },
    get expanded() { return state.expanded; },
    setMode(mode) {
      changeMode(mode);
    },
    destroy() {
      toggle.removeEventListener('click', handleToggle);
      toggle.removeEventListener('keydown', handleKeyDown);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    },
  };
}
