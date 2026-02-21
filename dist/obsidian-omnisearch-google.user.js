"use strict";
// ==UserScript==
// @name         Obsidian Omnisearch in Google
// @namespace    https://github.com/scambier/userscripts
// @downloadURL  https://github.com/scambier/userscripts/raw/master/dist/obsidian-omnisearch-google.user.js
// @updateURL    https://github.com/scambier/userscripts/raw/master/dist/obsidian-omnisearch-google.user.js
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

    // --- CSS Variables ---
    const STYLING_CONFIG = {
        prefix: "omni", // Your custom prefix
        variables: {
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
        prefix;
        vars;

        constructor(prefix, variables) {
            this.prefix = prefix;
            this.vars = variables;
        }

        /**
         * Generates a CSS string and injects it into the document head
         */
        inject() {
            const cssVariables = Object.entries(this.vars)
                .map(([key, value]) => `--${this.prefix}-${key}: ${value};`)
                .join("\n");

            const styleBlock = `
                :root {
                    ${cssVariables}
                }
                #ObsidianSearchDetailsS {
                    margin-bottom: 2em;
                    border: 1px solid var(--${this.prefix}-border-color);
                    border-radius: var(--${this.prefix}-border-radius);
                    padding: 0.5em 1em;
                }
                .omnisearch-mark {
                    background-color: var(--${this.prefix}-mark-bg);
                    color: inherit;
                    padding: 0 2px;
                    border-radius: 2px;
                }
                .omnisearch-excerpt-container {
                    height: 100px;
                    overflow: auto;
                }
            `;

            $("<style>").text(styleBlock).appendTo("head");
        }

        /**
         * Returns the CSS variable string for use in inline styles if needed
         */
        getVar(name) {
            return `var(--${this.prefix}-${name})`;
        }
    }

    /**
     * Decodes HTML entities and Unicode escape sequences into raw characters.
     * * This utility uses the browser's native textarea parsing to convert 
     * strings like "&lt;br&gt;" or "\u003C" back into their literal 
     * representations (e.g., "<br>" or "<").
     * * @param {string} html - The encoded HTML string from the API.
     * @returns {string} The decoded string containing literal HTML tags and symbols.
     */
    function decodeHtml(html) {
        // 1. Create a dummy element in memory (not added to the page)
        const txt = document.createElement("textarea");
        // 2. Put the encoded string into the innerHTML
        // The browser automatically translates entities here
        txt.innerHTML = html;
        // 3. Retrieve the "value," which is now the decoded plain text
        return txt.value;
    }

    /**
     * A security utility for sanitizing HTML strings using a whitelist-based DOM traversal.
     * * This class parses HTML into an inert document fragment and reconstructs it, 
     * stripping all event handlers (onclick, etc.), unauthorized attributes, 
     * and dangerous tags (script, object, etc.).
     */
    class SecurityScanner {
        // Only allow these tags
        allowedTags = ['BR', 'MARK', 'B', 'I', 'U', 'EM', 'STRONG', 'CODE'];

        /**
         * Sanitizes HTML string by removing any tags not in the whitelist 
         * and stripping all event handlers/attributes.
         */
        sanitize(html) {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const cleanContainer = document.createElement('div');

            // Recursively process nodes
            this.processNode(doc.body, cleanContainer);

            return cleanContainer.innerHTML;
        }

        processNode(source, destination) {
            source.childNodes.forEach(node => {
                if (node.nodeType === Node.TEXT_NODE) {
                    destination.appendChild(document.createTextNode(node.textContent || ''));
                } else if (node.nodeType === Node.ELEMENT_NODE) {
                    const el = node;
                    const tagName = el.tagName.toUpperCase();

                    if (this.allowedTags.includes(tagName)) {
                        const newEl = document.createElement(tagName);
                        // Copy text content but NOT attributes like 'onerror' or 'onclick'
                        // We only allow specific safe styles if needed
                        if (tagName === 'MARK') {
                            newEl.className = 'omnisearch-mark';
                        }
                        this.processNode(el, newEl);
                        destination.appendChild(newEl);
                    } else {
                        // If tag is forbidden (like <script>), just process its children as text
                        this.processNode(el, destination);
                    }
                }
            });
        }
    }

    const styleManager = new StyleManager(STYLING_CONFIG.prefix, STYLING_CONFIG.variables);
    styleManager.inject();

    // Google's right "sidebar" that will contain the results div
    const sidebarSelector = "#rhs";
    // The results div
    const resultsDivId = "OmnisearchObsidianResults";
    // The "loading"/"no results" label
    const loadingSpanId = "OmnisearchObsidianLoading";
    // The `new GM_config()` syntax is not recognized by the TS compiler
    // @ts-ignore
    const gmc = new GM_config({
        id: "ObsidianOmnisearchGoogle",
        title: "Omnisearch in Google - Configuration",
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
            save: () => {
                location.reload();
            },
            init: () => { },
        },
    });
    // Promise resolves when initialization completes
    const onInit = (config) => new Promise((resolve) => {
        let isInit = () => setTimeout(() => (config.isInit ? resolve() : isInit()), 0);
        isInit();
    });
    // Obsidian logo
    const logo = `<svg height="1.2em" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 256 256">
<style>
.purple { fill: #9974F8; }
@media (prefers-color-scheme: dark) { .purple { fill: #A88BFA; } }
</style>
<path class="purple" d="M94.82 149.44c6.53-1.94 17.13-4.9 29.26-5.71a102.97 102.97 0 0 1-7.64-48.84c1.63-16.51 7.54-30.38 13.25-42.1l3.47-7.14 4.48-9.18c2.35-5 4.08-9.38 4.9-13.56.81-4.07.81-7.64-.2-11.11-1.03-3.47-3.07-7.14-7.15-11.21a17.02 17.02 0 0 0-15.8 3.77l-52.81 47.5a17.12 17.12 0 0 0-5.5 10.2l-4.5 30.18a149.26 149.26 0 0 1 38.24 57.2ZM54.45 106l-1.02 3.06-27.94 62.2a17.33 17.33 0 0 0 3.27 18.96l43.94 45.16a88.7 88.7 0 0 0 8.97-88.5A139.47 139.47 0 0 0 54.45 106Z"/><path class="purple" d="m82.9 240.79 2.34.2c8.26.2 22.33 1.02 33.64 3.06 9.28 1.73 27.73 6.83 42.82 11.21 11.52 3.47 23.45-5.8 25.08-17.73 1.23-8.67 3.57-18.46 7.75-27.53a94.81 94.81 0 0 0-25.9-40.99 56.48 56.48 0 0 0-29.56-13.35 96.55 96.55 0 0 0-40.99 4.79 98.89 98.89 0 0 1-15.29 80.34h.1Z"/><path class="purple" d="M201.87 197.76a574.87 574.87 0 0 0 19.78-31.6 8.67 8.67 0 0 0-.61-9.48 185.58 185.58 0 0 1-21.82-35.9c-5.91-14.16-6.73-36.08-6.83-46.69 0-4.07-1.22-8.05-3.77-11.21l-34.16-43.33c0 1.94-.4 3.87-.81 5.81a76.42 76.42 0 0 1-5.71 15.9l-4.7 9.8-3.36 6.72a111.95 111.95 0 0 0-12.03 38.23 93.9 93.9 0 0 0 8.67 47.92 67.9 67.9 0 0 1 39.56 16.52 99.4 99.4 0 0 1 25.8 37.31Z"/></svg>
`;


    /**
     * Highlights keywords within a text string using the <mark> tag.
     * Follows SOLID by separating the formatting logic.
     */
    function highlightText(text, words) {
        if (!words || words.length === 0) return text;

        // We no longer "clean" the excerpt by replacing <br> with spaces
        // unless you explicitly want to remove line breaks.
        let highlighted = text;

        const sortedWords = [...new Set(words)].sort((a, b) => b.length - a.length);

        for (const word of sortedWords) {
            const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // The regex remains the same, but it will now execute against the raw HTML string
            const regex = new RegExp(`\\b(${escapedWord})\\b`, 'gi');
            highlighted = highlighted.replace(regex, `<mark class="omnisearch-mark">$1</mark>`);
        }
        return highlighted;
    }

    function omnisearch() {
        const port = gmc.get("port");
        const nbResults = gmc.get("nbResults");
        // Extract the ?q= part of the URL with URLSearchParams
        const params = new URLSearchParams(window.location.search);
        const query = params.get("q");
        if (!query){
            return;
        }
        injectLoadingLabel();
        GM.xmlHttpRequest({
            method: "GET",
            url: `http://localhost:${port}/search?q=${query}`,
            headers: {
                "Content-Type": "application/json",
            },
            onload: function (res) {
                let data = JSON.parse(res.response);
                if (gmc.get("sortScore")) {
                    data.sort((a, b) => b.score - a.score);
                }
                if (gmc.get("filterZeros")) {
                    data = data.filter(item => item.score > 0);
                }
                const resultsDiv = $(`#${resultsDivId}`);
                // Delete all existing data-omnisearch-result
                resultsDiv.empty();
                $("[data-omnisearch-result]").remove();

                // 2. Decide if we show "No results" or the actual data
                if (data.length === 0) {
                    removeLoadingLabel(false);
                } else {
                    removeLoadingLabel(true);
                    data.splice(nbResults);
                // Inject results
                for (const item of data) {
                    const url = `obsidian://open?vault=${encodeURIComponent(item.vault)}&file=${encodeURIComponent(item.path)}`;

                    const scanner = new SecurityScanner();
                    // Inside the loop:
                    const rawHtml = decodeHtml(item.excerpt);
                    const safeHtml = scanner.sanitize(rawHtml); // <--- Scripts are killed here
                    const finalHtml = highlightText(safeHtml, item.foundWords);

                    const element = $(`
          <div class="MjjYud" data-omnisearch-result>
            <div class="g Ww4FFb tF2Cxc" style="width: 100%">
              <div class="N54PNb BToiNc cvP2Ce">
                <div class="kb0PBd cvP2Ce jGGQ5e">
                  <div class="yuRUbf">
                    <div>
                      <span>
                        <a href="${url}">
                          <h3 class="LC20lb MBeuO DKV0Md">${item.basename}</h3>
                          <div class="notranslate TbwUpd NJjxre iUh30 ojE3Fb">
                            <span style="margin-left: 8px; opacity: 0.6; font-size: 0.85em;">
                              (${item.matches?.length || 0} matches, ${item.foundWords.length} terms, ${item.score.toFixed(2)} score)
                            </span>
                            <div class="q0vns">
                              <span class="H9lube">
                                <div class="eqA2re NjwKYd Vwoesf" aria-hidden="true">
                                    ${logo}
                                </div>
                              </span>
                              <div>
                                <span class="VuuXrf">Obsidian</span>
                                <div class="byrV5b">
                                  <cite class="qLRx3b tjvcx GvPZzd cHaqb" role="text">
                                    <span class="dyjrff ob9lvb" role="text" title="${item.path}">
                                        ${item.path}
                                    </span>
                                  </cite>
                                </div>
                              </div>
                            </div>
                          </div>
                        </a>
                      </span>
                    </div>
                  </div>
                </div>
                <div class="kb0PBd cvP2Ce">
                <div class="omnisearch-excerpt-container VwiC3b yXK7lf lyLwlc yDYNvb W8l4ac lEBKkf" style="-webkit-line-clamp: 3">
                </div>
                </div>
              </div>
            </div>
          </div>
          `);
                    element.find(".omnisearch-excerpt-container").html(finalHtml);
                    resultsDiv.append(element);
                }
            }
            },
            onerror: function (res) {
                console.log("Omnisearch error", res);
                const span = $("#" + loadingSpanId)[0];
                if (span) {
                    span.innerHTML = `Error: Obsidian is not running or the Omnisearch server is not enabled.
                    <br />
                    <a href="Obsidian://open">Open Obsidian</a>.`;
                }
            },
        });
    }
    function injectTitle() {
        const id = "OmnisearchObsidianConfig";
        if (!$("#" + id)[0]) {
            const btn = $(`${logo}
          <span style="font-size: 18px">Omnisearch results</span>
          <span style="font-size: 12px">(<a id=${id} class="feedback-link-btn" title="Settings" href="#">settings</a>)</span>
        `);
            $(`#OmnisearchHeader`).append(btn);
            $(document).on("click", "#" + id, function (e) {
                e.preventDefault(); // Prevent collapse when clicking settings
                gmc.open();
            });
        }
    }
    function injectResultsContainer() {
        const resultsDetailsSummary = $(`
        <details id="ObsidianSearchDetailsS" open>
            <summary style="cursor: pointer; outline: none; border-bottom: 1px solid var(--${STYLING_CONFIG.prefix}-border-color); padding-bottom: 4px;">
                <span id="OmnisearchHeader" style="display: inline-flex; align-items: center; gap: 0.5em;"></span>
            </summary>
            <div id="${resultsDivId}" style="margin-top: var(--${STYLING_CONFIG.prefix}-spacing); display: flex; flex-direction: column; gap: var(--${STYLING_CONFIG.prefix}-spacing)"></div>
        </details>
    `);
        $(sidebarSelector).prepend(resultsDetailsSummary);
    }
    function injectLoadingLabel() {
        if (!$("#" + loadingSpanId)[0]) {
            const label = $(`<span id=${loadingSpanId}>Loading...</span>`);
            $(`#${resultsDivId}`).append(label);
        }
    }
    function removeLoadingLabel(foundResults = true) {
        const resultsDiv = $(`#${resultsDivId}`);
        let span = $("#" + loadingSpanId);

        if (foundResults) {
            span.remove();
        } else {
            // If the span was deleted by .empty(), recreate it
            if (span.length === 0) {
                resultsDiv.append(`<span id="${loadingSpanId}" style="color: #70757a;">No results found</span>`);
            } else {
                span.text("No results found").show();
            }
        }
    }
    console.log("Loading Omnisearch injector");
    let init = onInit(gmc);
    init.then(() => {
        // Make sure the results container is there
        if (!$(sidebarSelector)[0]) {
            $("#rcnt").append('<div id="rhs" class="TQc1id k5T88b vVVcqf e0KErc"></div>');
        }
        injectResultsContainer();
        injectTitle();
        omnisearch(); // Make an initial call, just to avoid an improbable race condition
        console.log("Loaded Omnisearch injector");
        // Keep the results on top
        waitForKeyElements(sidebarSelector, () => {
            $(resultsDivId).prependTo(sidebarSelector);
        });
    });
})();
