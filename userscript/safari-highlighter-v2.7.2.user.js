// ==UserScript==
// @name         Safari Highlighter v2.7.2.
// @version      2.7.2.
// @description  Clipboard fix, smarter undo, no auto-capitalisation
// @match        *://*/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
    if (document.getElementById('hl-palette')) return;

    const colors = [
        { name: 'Yellow', value: '#FFF382' },
        { name: 'Green', value: '#01DAC3' },
        { name: 'Red',   value: '#FF859E' },
        { name: 'Blue',  value: '#A0E8FF' }
    ];

    let colorIndex    = 0;
    let currentColor  = colors[0].value;
    let history       = [];
    let holdTimer     = null;
    let cycleInterval = null;
    let isCycling     = false;
    let hKeyDown      = false;

    // ---- helpers ----

    const isTyping = (el) => {
        if (!el) return false;
        const tag  = el.tagName.toLowerCase();
        const role = el.getAttribute('role');
        return ['input', 'textarea'].includes(tag) ||
               el.isContentEditable ||
               ['textbox', 'searchbox'].includes(role) ||
               (tag === 'div' && el.classList.contains('CodeMirror'));
    };

    const unwrapSpan = (span) => {
        const parent = span.parentNode;
        if (!parent) return;
        while (span.firstChild) parent.insertBefore(span.firstChild, span);
        span.remove();
        parent.normalize();
    };

    const removeHighlightBatch = (span) => {
        const batchId = span.dataset.batchId;
        document.querySelectorAll(`.safari-hl[data-batch-id="${batchId}"]`).forEach(unwrapSpan);
        history = history.filter(batch => !batch.includes(span));
    };

    const showToast = (message) => {
        let toast = document.querySelector('.hl-toast') || document.createElement('div');
        toast.className = 'hl-toast';
        if (!toast.parentNode) document.body.appendChild(toast);
        toast.textContent = message;
        toast.style.opacity = '1';
        setTimeout(() => { toast.style.opacity = '0'; }, 2000);
    };

    // ---- styles ----

    const styleId = 'safari-highlighter-styles';
    if (!document.getElementById(styleId)) {
        const css = `
            .safari-hl {
                color: #000 !important;
                background-color: var(--hl-color) !important;
                display: inline !important;
                padding: 0 !important;
                margin: 0 !important;
                font: inherit !important;
                line-height: inherit !important;
                vertical-align: baseline !important;
                position: relative;
                z-index: 10;
                cursor: pointer;
            }
            .hl-toast {
                position: fixed;
                top: 40px;
                left: 50%;
                transform: translateX(-50%);
                background: #1d1d1f;
                color: white;
                padding: 10px 20px;
                border-radius: 25px;
                font-family: -apple-system, system-ui, sans-serif;
                font-size: 14px;
                z-index: 9999999;
                opacity: 0;
                transition: opacity 0.3s ease;
                pointer-events: none;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            }
            #hl-palette {
                position: fixed;
                top: 80px;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(30, 30, 30, 0.95);
                backdrop-filter: blur(20px);
                -webkit-backdrop-filter: blur(20px);
                padding: 15px 25px;
                border-radius: 50px;
                display: flex;
                gap: 20px;
                z-index: 9999999;
                box-shadow: 0 10px 40px rgba(0,0,0,0.5);
                border: 1px solid rgba(255,255,255,0.2);
                opacity: 0;
                visibility: hidden;
                transition: opacity 0.2s ease;
            }
            .hl-dot {
                width: 24px;
                height: 24px;
                border-radius: 50%;
                border: 2px solid transparent;
                transition: all 0.2s ease;
            }
            .hl-dot.active {
                transform: scale(1.4);
                border-color: #fff;
                box-shadow: 0 0 15px var(--dot-color);
            }
        `;
        const styleSheet = document.createElement('style');
        styleSheet.id = styleId;
        styleSheet.innerText = css;
        document.head.appendChild(styleSheet);
    }

    // ---- palette ----

    const palette = document.createElement('div');
    palette.id = 'hl-palette';
    colors.forEach((c) => {
        const dot = document.createElement('div');
        dot.className = 'hl-dot';
        dot.style.background = c.value;
        dot.style.setProperty('--dot-color', c.value);
        palette.appendChild(dot);
    });
    document.body.appendChild(palette);

    const updatePaletteUI = () => {
        palette.querySelectorAll('.hl-dot').forEach((dot, i) => {
            dot.classList.toggle('active', i === colorIndex);
        });
    };

    // ---- core actions ----

    const highlight = () => {
        const sel = window.getSelection();
        if (!sel.rangeCount || !sel.toString().trim()) return;

        const range = sel.getRangeAt(0);
        const container = range.commonAncestorContainer;
        const root = container.nodeType === Node.TEXT_NODE ? container.parentNode : container;

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode: (node) => range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
        });

        const nodes = [];
        let node = walker.nextNode();
        while (node) { nodes.push(node); node = walker.nextNode(); }
        if (nodes.length === 0 && container.nodeType === Node.TEXT_NODE) nodes.push(container);

        const batchId      = Date.now().toString() + Math.random().toString().slice(2, 8);
        const currentBatch = [];

        nodes.forEach(n => {
            const start = (n === range.startContainer) ? range.startOffset : 0;
            const end   = (n === range.endContainer)   ? range.endOffset   : n.textContent.length;
            if (!n.textContent.slice(start, end).trim()) return;

            try {
                const hlNode = n.splitText(start);
                hlNode.splitText(end - start);

                const span = document.createElement('span');
                span.className = 'safari-hl';
                span.dataset.batchId = batchId;
                span.style.setProperty('--hl-color', currentColor);
                span.addEventListener('dblclick', (e) => { e.stopPropagation(); removeHighlightBatch(span); });

                hlNode.parentNode.insertBefore(span, hlNode);
                span.appendChild(hlNode);
                currentBatch.push(span);
            } catch (_) {}
        });

        if (currentBatch.length > 0) {
            history.push(currentBatch);
            sel.removeAllRanges();
        }
    };

    const reverseHighlight = () => {
        while (history.length > 0) {
            const lastBatch = history.pop();
            const batchId = lastBatch[0]?.dataset.batchId;
            const live = batchId
                ? document.querySelectorAll(`.safari-hl[data-batch-id="${batchId}"]`)
                : [];
            if (live.length > 0) {
                live.forEach(unwrapSpan);
                return;
            }
        }
    };

    const copyHighlights = () => {
        const allSpans = Array.from(document.querySelectorAll('.safari-hl'));
        if (allSpans.length === 0) return;

        const batches = [];
        let lastId = null;
        allSpans.forEach(span => {
            if (span.dataset.batchId !== lastId) { batches.push([]); lastId = span.dataset.batchId; }
            batches[batches.length - 1].push(span);
        });

        const fullText = batches
            .map(batch => batch.map(s => s.textContent).join('').trim())
            .filter(Boolean)
            .join('\n');

        if (!fullText) return;

        navigator.clipboard.writeText(fullText)
            .then(() => { showToast('Copied to Clipboard'); })
            .catch(() => { showToast('Copy failed'); });
    };

    // ---- keyboard handling ----

    window.addEventListener('keydown', e => {
        const key           = e.key.toLowerCase();
        const hasSelection  = window.getSelection().toString().trim().length > 0;
        const hasHighlights = !!document.querySelector('.safari-hl');
        const typing        = isTyping(document.activeElement) || isTyping(e.target);

        if (typing && !hasSelection) return;

        if (key === 'h' && !e.metaKey && !e.ctrlKey && hasSelection) {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (!hKeyDown) {
                hKeyDown = true;
                holdTimer = setTimeout(() => {
                    isCycling    = true;
                    colorIndex   = 0;
                    currentColor = colors[0].value;
                    palette.style.visibility = 'visible';
                    palette.style.opacity    = '1';
                    updatePaletteUI();
                    cycleInterval = setInterval(() => {
                        colorIndex = (colorIndex + 1) % colors.length;
                        updatePaletteUI();
                    }, 300);
                }, 450);
            }
        }

        if (key === 'r' && !e.metaKey && !e.ctrlKey && !hasSelection && hasHighlights) {
            e.preventDefault();
            e.stopImmediatePropagation();
            reverseHighlight();
        }

        if (key === 'c' && !e.metaKey && !e.ctrlKey && !hasSelection && hasHighlights) {
            e.preventDefault();
            e.stopImmediatePropagation();
            copyHighlights();
        }
    }, true);

    window.addEventListener('keyup', e => {
        if (e.key.toLowerCase() !== 'h') return;

        const hasSelection = window.getSelection().toString().trim().length > 0;
        const typing       = isTyping(document.activeElement) || isTyping(e.target);
        if (typing && !hasSelection) return;

        if (hKeyDown || isCycling) {
            e.preventDefault();
            e.stopImmediatePropagation();
            hKeyDown = false;
            clearTimeout(holdTimer);
            if (cycleInterval) clearInterval(cycleInterval);

            if (isCycling) {
                currentColor = colors[colorIndex].value;
                palette.style.opacity = '0';
                setTimeout(() => { palette.style.visibility = 'hidden'; }, 200);
                highlight();
                isCycling = false;
            } else if (hasSelection) {
                highlight();
            }

            colorIndex   = 0;
            currentColor = colors[0].value;
        }
    }, true);

})();
