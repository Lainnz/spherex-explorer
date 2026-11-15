/**
 * The right drawer's tabs (Layers, Info, Flags, Spectrum, Light curve), with arrow-key
 * movement between tabs as screen readers expect.
 */
export function setupTabs(root, { onShow } = {}) {
  const tabs = [...root.querySelectorAll('[role="tab"]')];

  function show(tab, { focus = false } = {}) {
    for (const other of tabs) {
      const selected = other === tab;
      other.setAttribute('aria-selected', String(selected));
      other.tabIndex = selected ? 0 : -1;
      document.getElementById(other.getAttribute('aria-controls')).hidden = !selected;
    }
    if (focus) tab.focus();
    onShow?.(tab.getAttribute('aria-controls'));
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => show(tab));
    tab.addEventListener('keydown', (event) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
      if (!step) return;
      event.preventDefault();
      show(tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length], { focus: true });
    });
  }
  show(tabs.find((t) => t.getAttribute('aria-selected') === 'true') ?? tabs[0]);
  return {
    /** Open a tab by its panel id, e.g. "tab-spectrum". */
    open(panelId) {
      const tab = tabs.find((t) => t.getAttribute('aria-controls') === panelId);
      if (tab) show(tab);
    },
  };
}
