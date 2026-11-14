/** Title page entry point. Phase 6 adds the three.js scene, search and Randomize. */
import '../styles/fonts.css';
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/title.css';
import { renderFooter, showHealth } from '../shared/ui.js';

renderFooter(document.querySelector('[data-footer]'));
showHealth(document.querySelector('[data-health]'));
