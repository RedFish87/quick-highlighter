 (function() {
     'use strict';
     if (document.getElementById('hl-palette')) return;

     const colors = [
         { name: 'Yellow', value: '#FFF382' },
         { name: 'Green', value: '#01DAC3' },
         { name: 'Red',   value: '#FF859E' },
         { name: 'Blue',  value: '#A0E8FF' }
     ];

     let colorIndex   = 0;
     let currentColor = colors[0].value;
     let history      = [];
     let holdTimer    = null;
     let cycleInterval = null;
     let isCycling    = false;
     let hKeyDown     = false;

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
             .map(batch => {
                 const text = batch.map(s => s.textContent).join('').trim();
                 return text;
             })
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
