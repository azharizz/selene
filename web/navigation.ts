export function focusPanel(element: HTMLElement | null) {
  (element?.querySelector<HTMLElement>('[data-initial]:not(:disabled)') ?? element?.querySelector<HTMLElement>('button:not(:disabled)'))?.focus();
}

export function moveFocus(event: KeyboardEvent, root: HTMLElement | null) {
  const target = event.target instanceof HTMLElement ? event.target : root;
  if (!root || !target || !event.key.startsWith('Arrow') || target.matches('textarea,input,select')) return;
  event.preventDefault();
  const area = root.querySelector<HTMLElement>('[data-panel]') ?? root;
  const items = Array.from(area.querySelectorAll<HTMLElement>('button:not(:disabled),textarea:not(:disabled),select:not(:disabled)')).filter(element => element.getClientRects().length);
  const current = target.getBoundingClientRect();
  const horizontal = ['ArrowLeft', 'ArrowRight'].includes(event.key);
  const sign = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1;
  const next = items.filter(element => element !== target).map(element => {
    const rect = element.getBoundingClientRect();
    const dx = rect.x + rect.width / 2 - current.x - current.width / 2;
    const dy = rect.y + rect.height / 2 - current.y - current.height / 2;
    const forward = (horizontal ? dx : dy) * sign;
    return {element, forward, score: forward + Math.abs(horizontal ? dy : dx) * 3};
  }).filter(item => item.forward > 4).sort((a, b) => a.score - b.score)[0]?.element;
  next?.focus(); next?.scrollIntoView({block: 'nearest', inline: 'nearest'});
}
