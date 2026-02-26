"use strict";
// ==UserScript==
// @name         Obsidian Omnisearch in Google
// @namespace    https://github.com/scambier/userscripts
// @downloadURL  https://github.com/anweshgangula/userscripts/raw/refactor/dist/obsidian-omnisearch-google.user.js
// @updateURL    https://github.com/anweshgangula/userscripts/raw/refactor/dist/obsidian-omnisearch-google.user.js
// @version      0.3.5
// @description  Injects Obsidian notes in Google search results
// @author       Simon Cambier
// @match        https://google.com/*
// @match        https://www.google.com/*
// @icon         https://obsidian.md/favicon.ico
// @require      https://code.jquery.com/jquery-3.7.1.min.js
// @require      https://raw.githubusercontent.com/sizzlemctwizzle/GM_config/master/gm_config.js
// @require      https://gist.githubusercontent.com/scambier/109932d45b7592d3decf24194008be4d/raw/9c97aa67ff9c5d56be34a55ad6c18a314e5eb548/waitForKeyElements.js
// @grant        GM.xmlHttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM.getValue
// @grant        GM.setValue
// ==/UserScript==
/* globals GM_config, jQuery, $, waitForKeyElements */
(function () {
    "use strict";

    /** Centralized Constants & Selectors (Single Source of Truth) */
    const APP_CONFIG = {
        prefix: "omni",
        ids: {
            details: "ObsidianSearchDetailsS",
            container: "OmnisearchObsidianResults",
            header: "OmnisearchHeader",
            trigger: "OmnisearchSettingsTrigger"
        },
        selectors: {
            sidebar: "#rhs",
            mainContent: "#rcnt"
        },
        styling: {
            "spacing": "1em",
            "border-color": "var(--gS5jXb, rgb(0,0,0,0.5))",
            "bg-opacity": "0.1",
            "accent-color": "#9974F8",
            "mark-bg": "#ffd70066",
            "border-radius": "1em"
        }
    };

    /**
     * Handles the injection and management of CSS custom properties.
     * Follows SOLID by separating style concerns from logic.
     */
    class StyleManager {
        constructor(config) {
            this.config = config;
        }

        /**
         * Generates a CSS string and injects it into the document head
         */
        inject() {
            const cssVars = Object.entries(this.config.styling)
                .map(([k, v]) => `--${this.config.prefix}-${k}: ${v};`).join("\n");

            const css = `
                :root { ${cssVars} }

                div#rhs > * {
                    background: var(--EpFNW); /* add background to all sidebar elements */
                    z-index: 10;
                    position: relative;
                }

                .omni-no-results{
                    color: var(--ONhrGd, rgb(0,0,0,0.5));
                }
                
                #${this.config.ids.container}{
                    margin-top: var(--omni-spacing);
                    display: flex;
                    flex-direction: column;
                    gap: var(--omni-spacing)
                    color: var(--omni-border-color);
                }
                
                details#${this.config.ids.details} {
                    margin-bottom: 2em;
                    border: 1px solid var(--${this.config.prefix}-border-color);
                    border-radius: var(--${this.config.prefix}-border-radius);
                    padding: 0.5em 1em;
                }

                details#${this.config.ids.details}.omni-sticky {
                    position: sticky;
                    top: 5rem;
                }

                details#${this.config.ids.details} summary {
                    cursor: pointer;
                    outline: none;
                    padding-bottom: 4px;
                }

                details#${this.config.ids.details}[open] summary {
                    border-bottom: 1px solid var(--omni-border-color);
                }
                #${this.config.ids.details} {
                    margin-bottom: 2em;
                    border: 1px solid var(--${this.prefix}-border-color);
                    border-radius: var(--${this.prefix}-border-radius);
                    padding: 0.5em 1em;
                }
                
                #${this.config.ids.header} {
                    display: inline-flex;
                    align-items: center;
                    flex-wrap: wrap;
                    gap: 0.5em;
                }
                .omnisearch-mark {
                    background-color: var(--${this.config.prefix}-mark-bg);
                    color: inherit;
                    padding: 0 2px;
                    border-radius: 2px;
                }
                .omnisearch-excerpt-container {
                    -webkit-line-clamp: 3;
                    height: 100px;
                    overflow: auto;
                }
                /* Flexible H3 with small logo */
                .omni-h3-title {
                    display: flex;
                    align-items: center;
                    gap: 0.6em;
                }
                .omni-logo-small {
                    width: fit-content;
                    background: var(--omni-border-color);
                    border-radius: 100%;
                    padding: 2px;
                }
                .omni-logo-small svg {
                    height: 0.9em !important;
                    width: auto;
                }
                /* Metadata styling */
                .omni-metadata-row {
                    margin: 4px 0;
                    display: flex;
                    gap: 4px;
                    font-size: 0.85em;
                    color: #70757a;
                    flex-direction: column;
                }
                .omni-metrics{
                    margin-left: 8px;
                    opacity: 0.8;
                }
            `;
            $("<style>").text(css).appendTo("head");
        }
    }

    /**
     * Handles HTML decoding and sanitization.
     */
    class SecurityService {
        constructor() {
            this.allowedTags = ['BR', 'MARK', 'B', 'I', 'U', 'EM', 'STRONG', 'CODE'];
        }

        /**
         * Decodes HTML entities and Unicode escape sequences into raw characters.
         * * This utility uses the browser's native textarea parsing to convert
         * strings like "&lt;br&gt;" or "\u003C" back into their literal
         * representations (e.g., "<br>" or "<").
         * * @param {string} html - The encoded HTML string from the API.
         * @returns {string} The decoded string containing literal HTML tags and symbols.
         */
        decode(html) {
            // 1. Create a dummy element in memory (not added to the page)
            const txt = document.createElement("textarea");
            // 2. Put the encoded string into the innerHTML
            // The browser automatically translates entities here
            txt.innerHTML = html;
            // 3. Retrieve the "value," which is now the decoded plain text
            return txt.value;
        }


        /**
         * Sanitizes HTML string by removing any tags not in the whitelist
         * and stripping all event handlers/attributes.
         */
        sanitize(html) {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const cleanContainer = document.createElement('div');
            this._processNode(doc.body, cleanContainer);

            return cleanContainer.innerHTML;
        }

        _processNode(source, destination) {
            source.childNodes.forEach(node => {
                if (node.nodeType === Node.TEXT_NODE) {
                    destination.appendChild(document.createTextNode(node.textContent || ''));
                } else if (node.nodeType === Node.ELEMENT_NODE) {
                    const tagName = node.tagName.toUpperCase();
                    if (this.allowedTags.includes(tagName)) {
                        const newEl = document.createElement(tagName);
                        // Copy text content but NOT attributes like 'onerror' or 'onclick'
                        // We only allow specific safe styles if needed
                        if (tagName === 'MARK') newEl.className = 'omnisearch-mark';
                        this._processNode(node, newEl);
                        destination.appendChild(newEl);
                    }
                    // // commenting the else block below, as we don't need really need any more elements
                    // else {
                    //     // If tag is forbidden (like <script>), just process its children as text
                    //     this._processNode(node, destination);
                    // }
                }
            });
        }
    }

    /**
     * Manages API communication.
     */
    class OmnisearchService {
        constructor(config) {
            this.config = config;
        }

        async fetchResults(query) {
            const port = this.config.get("port");
            return new Promise((resolve, reject) => {
                GM.xmlHttpRequest({
                    method: "GET",
                    url: `http://localhost:${port}/search?q=${encodeURIComponent(query)}`,
                    headers: { "Content-Type": "application/json" },
                    onload: (res) => {
                        const data = JSON.parse(res.response);
                        // console.log(`Omnisearch: Received ${data.length} raw results`);
                        resolve(data);
                    },
                    onerror: (err) => reject(err)
                });
            });
        }

        process(data) {
            let results = [...data];
            if (this.config.get("sortScore")) results.sort((a, b) => b.score - a.score);
            if (this.config.get("filterZeros")) results = results.filter(item => item.score > 0);
            return results.slice(0, this.config.get("nbResults"));
        }
    }

    /**
     * Handles DOM manipulation and rendering.
     */
    class UIManager {
        constructor(security, logo, appConfig) {
            this.security = security;
            this.logo = logo;
            this.cfg = appConfig;
        }

        injectSkeleton() {
            if (!$(this.cfg.selectors.sidebar).length) {
                // console.log("UIManager: RHS sidebar not found, creating a new container...");
                $(this.cfg.selectors.mainContent).append('<div id="rhs" class="TQc1id k5T88b vVVcqf e0KErc"></div>');
            }
            const html = `
                <details id="${this.cfg.ids.details}" class="omni-sticky" open>
                    <summary><span id="${this.cfg.ids.header}"></span></summary>
                    <div id="${this.cfg.ids.container}"></div>
                </details>`;
            $(this.cfg.selectors.sidebar).prepend(html);
        }

        /**
         * Highlights keywords within a text string using the <mark> tag.
         * Follows SOLID by separating the formatting logic.
         */
        highlight(text, words = []) {
            if (!words.length) return text;
            const pattern = [...new Set(words)]
                .sort((a, b) => b.length - a.length)
                .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
                .join('|');
            return text.replace(new RegExp(`\\b(${pattern})\\b`, 'gi'), `<mark class="omnisearch-mark">$1</mark>`);
        }

        renderResult(item) {
            const url = `obsidian://open?vault=${encodeURIComponent(item.vault)}&file=${encodeURIComponent(item.path)}`;
            const safeExcerpt = this.security.sanitize(this.security.decode(item.excerpt));
            const finalExcerptHtml = this.highlight(safeExcerpt, item.foundWords);

            return `
                <div class="MjjYud">
                    <div class="g Ww4FFb tF2Cxc">
                        <div class="yuRUbf">
                            <a href="${url}">
                                <h3 class="LC20lb MBeuO DKV0Md omni-h3-title">
                                    <span class="omni-logo-small">${this.logo}</span>
                                    <span>${item.basename}</span>
                                </h3>
                            </a>
                            <div class="omni-metadata-row notranslate TbwUpd NJjxre iUh30 ojE3Fb">
                                <cite class="qLRx3b tjvcx GvPZzd cHaqb"  title="${item.path}">
                                    ${item.path}
                                </cite>
                                <span class="omni-metrics">(${item.matches?.length || 0} matches, score ${item.score.toFixed(2)})</span>
                            </div>
                        </div>
                        <div class="kb0PBd cvP2Ce">
                            <div class="omnisearch-excerpt-container VwiC3b">${finalExcerptHtml}</div>
                        </div>
                    </div>
                </div>`;
        }
    }

    /**
     * Orchestrator
     */
    class OmnisearchApp {
        constructor() {
            this.logo = `<svg height="1.2em" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 256 256"><style>.purple { fill: #9974F8; } @media (prefers-color-scheme: dark) { .purple { fill: #A88BFA; } }</style><path class="purple" d="M94.82 149.44c6.53-1.94 17.13-4.9 29.26-5.71a102.97 102.97 0 0 1-7.64-48.84c1.63-16.51 7.54-30.38 13.25-42.1l3.47-7.14 4.48-9.18c2.35-5 4.08-9.38 4.9-13.56.81-4.07.81-7.64-.2-11.11-1.03-3.47-3.07-7.14-7.15-11.21a17.02 17.02 0 0 0-15.8 3.77l-52.81 47.5a17.12 17.12 0 0 0-5.5 10.2l-4.5 30.18a149.26 149.26 0 0 1 38.24 57.2ZM54.45 106l-1.02 3.06-27.94 62.2a17.33 17.33 0 0 0 3.27 18.96l43.94 45.16a88.7 88.7 0 0 0 8.97-88.5A139.47 139.47 0 0 0 54.45 106Z"/><path class="purple" d="m82.9 240.79 2.34.2c8.26.2 22.33 1.02 33.64 3.06 9.28 1.73 27.73 6.83 42.82 11.21 11.52 3.47 23.45-5.8 25.08-17.73 1.23-8.67 3.57-18.46 7.75-27.53a94.81 94.81 0 0 0-25.9-40.99 56.48 56.48 0 0 0-29.56-13.35 96.55 96.55 0 0 0-40.99 4.79 98.89 98.89 0 0 1-15.29 80.34h.1Z"/><path class="purple" d="M201.87 197.76a574.87 574.87 0 0 0 19.78-31.6 8.67 8.67 0 0 0-.61-9.48 185.58 185.58 0 0 1-21.82-35.9c-5.91-14.16-6.73-36.08-6.83-46.69 0-4.07-1.22-8.05-3.77-11.21l-34.16-43.33c0 1.94-.4 3.87-.81 5.81a76.42 76.42 0 0 1-5.71 15.9l-4.7 9.8-3.36 6.72a111.95 111.95 0 0 0-12.03 38.23 93.9 93.9 0 0 0 8.67 47.92 67.9 67.9 0 0 1 39.56 16.52 99.4 99.4 0 0 1 25.8 37.31Z"/></svg>`;
            this.config = this._setupConfig();
            this.security = new SecurityService();
            this.ui = new UIManager(this.security, this.logo, APP_CONFIG);
            this.api = new OmnisearchService(this.config);
        }

        _setupConfig() {
            const config = new GM_config({
                id: "ObsidianOmnisearchGoogle",
                title: "Omnisearch Configuration",
                fields: {
                    port: {
                        label: "HTTP Port",
                        type: "text",
                        default: "51361",
                    },
                    nbResults: {
                        label: "Number of results to display",
                        type: "int",
                        default: 3,
                    },
                    sortScore: {
                        label: "Sort by score (descending)",
                        type: "checkbox",
                        default: true,
                    },
                    filterZeros: {
                        label: "Filter zero-score results",
                        type: "checkbox",
                        default: true,
                    }
                },
                events: {
                    save: () => location.reload(),
                    init: () => {},
                    open: (doc) => {
                        const iframe = document.getElementById(config.id);
                        if (!iframe || document.getElementById("omni-config-backdrop")) return;

                        // 1. Create the backdrop as a sibling, not a parent
                        const backdrop = document.createElement('div');
                        backdrop.id = "omni-config-backdrop";

                        // Match the Z-index to be exactly one less than the iframe
                        const iframeZ = parseInt(window.getComputedStyle(iframe).zIndex) || 9999;

                        Object.assign(backdrop.style, {
                            position: 'fixed',
                            top: 0,
                            left: 0,
                            width: '100vw',
                            height: '100vh',
                            backgroundColor: 'rgba(0, 0, 0, 0.6)',
                            backdropFilter: 'blur(2px)',
                            zIndex: iframeZ - 1
                        });

                        document.body.insertBefore(backdrop, iframe);

                        // 2. Simple Close Logic
                        backdrop.addEventListener('click', () => config.close());
                    },
                    close: () => {
                        const backdrop = document.getElementById("omni-config-backdrop");
                        if (backdrop) backdrop.remove();
                    }
                }
            });
            return config;
        }

        async init() {
            console.log("Loading Omnisearch injector");
            await this._waitForConfig();
            new StyleManager(APP_CONFIG).inject();
            this.ui.injectSkeleton();
            this._renderHeader();

            const query = new URLSearchParams(window.location.search).get("q");
            if (query) this.runSearch(query);

            console.log("Omnisearch injector loaded successfully");

            // Maintain positioning via waitForKeyElements
            waitForKeyElements(APP_CONFIG.selectors.sidebar, () => {
                const container = $(`#${APP_CONFIG.ids.details}`);
                if (container.length) {
                    container.prependTo(APP_CONFIG.selectors.sidebar);
                }
            });
        }

        _renderHeader() {
            const header = $(`
                ${this.logo} <h1 style="font-size: 18px">Omnisearch results</h1>
                <i style="font-size: 12px">(<a id="${APP_CONFIG.ids.trigger}" href="#">settings</a>)</i>
            `);
            $(`#${APP_CONFIG.ids.header}`).append(header);
            $(document).on("click", `#${APP_CONFIG.ids.trigger}`, (e) => {
                e.preventDefault();
                this.config.open();
            });
        }

        async runSearch(query) {
            const container = $(`#${APP_CONFIG.ids.container}`).html("Loading...");
            try {
                const rawData = await this.api.fetchResults(query);
                const results = this.api.process(rawData);
                container.empty();
                if (!results.length) return container.html("<div class='omni-no-results'>No results found</div>");
                results.forEach(res => container.append(this.ui.renderResult(res)));
            } catch (err) {
                console.error("Omnisearch error", err);
                container.html(`Error: Obsidian is not running or the Omnisearch server is not enabled.
                    <br /><a href="obsidian://open">Open Obsidian</a>.`);
            }
        }

        _waitForConfig() {
            return new Promise(res => {
                const check = () => this.config.isInit ? res() : setTimeout(check, 50);
                check();
            });
        }
    }

    const app = new OmnisearchApp();
    app.init();

})();
