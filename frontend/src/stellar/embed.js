/**
 * Sharing (PLAN.md §8.4–8.5): "Copy link", "Embed" (an <iframe> snippet), and embed mode,
 * where only the sky, the time bar, a target label, the Live/Demo badge and an
 * "Open in SPHEREx Xplorer" link are shown.
 */

/** The <iframe> code for embedding the current view on another website. */
export function embedSnippet(url) {
  const embedUrl = new URL(url);
  embedUrl.searchParams.set('embed', '1');
  return `<iframe src="${embedUrl.href}" width="800" height="500" style="border:0" ` +
    `title="SPHEREx Xplorer" allowfullscreen></iframe>`;
}

/** The full site's address for an embedded view (embed=1 removed). */
export function fullSiteUrl(url) {
  const full = new URL(url);
  full.searchParams.delete('embed');
  return full.href;
}

async function copy(text, button, done) {
  try {
    await navigator.clipboard.writeText(text);
    done('Copied to the clipboard.');
  } catch {
    window.prompt('Copy this:', text); // clipboard blocked (e.g. inside some iframes)
  }
  button.blur();
}

/**
 * @param {{embed: boolean, copyButton: HTMLElement, embedButton: HTMLElement,
 *          openLink: HTMLAnchorElement, toast: (text: string) => void}} options
 */
export function setupSharing({ embed, copyButton, embedButton, openLink, toast }) {
  document.body.classList.toggle('is-embed', embed);
  copyButton?.addEventListener('click', () => copy(fullSiteUrl(window.location.href), copyButton, toast));
  embedButton?.addEventListener('click', () => copy(embedSnippet(window.location.href), embedButton, toast));
  const refreshOpenLink = () => {
    if (openLink) openLink.href = fullSiteUrl(window.location.href);
  };
  refreshOpenLink();
  return { refreshOpenLink };
}
