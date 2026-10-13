// SPDX-License-Identifier: MIT
// The on-screen keyboard: how much of the window it covers, as --uif-kb on <html> (0px without one), so a field
// docked to the bottom can sit above it. Returns the function that stops following it.
export function trackKeyboard(): () => void {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  if (!vv) return () => {};
  const on = () => {
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--uif-kb', `${Math.round(kb)}px`);
  };
  vv.addEventListener('resize', on);
  vv.addEventListener('scroll', on);
  on();
  return () => {
    vv.removeEventListener('resize', on);
    vv.removeEventListener('scroll', on);
  };
}
