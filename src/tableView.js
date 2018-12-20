import {
  addClass,
  empty,
  fastInnerHTML,
  fastInnerText,
  getScrollbarWidth,
  hasClass,
  isChildOf,
  isInput,
  isOutsideInput
} from './helpers/dom/element';
import EventManager from './eventManager';
import { stopPropagation, isImmediatePropagationStopped, isRightClick, isLeftClick } from './helpers/dom/event';
import { clearTextSelection } from './helpers/mixed';
import Walkontable from './3rdparty/walkontable/src';
import { handleMouseEvent } from './selection/mouseEventHandler';

const privatePool = new WeakMap();
class TableView {
  /**
   * @param {Hanstontable} instance Instance of {@link Handsontable}
   */
  constructor(instance) {
    /**
     * Instance of {@link Handsontable}
     *
     * @private
     * @type {Handsontable}
     */
    this.instance = instance;
    /**
     * Instance of {@link EventManager}
     *
     * @private
     * @type {EventManager}
     */
    this.eventManager = new EventManager(instance);
    /**
     * Current Handsontable's GridSettings object.
     *
     * @private
     * @type {GridSettings}
     */
    this.settings = instance.getSettings();

    privatePool.set(this, {
      /**
       * Defines if the text should be selected during mousemove.
       *
       * @private
       * @type {Boolean}
       */
      selectionMouseDown: false,
      /**
       * @private
       * @type {Boolean}
       */
      mouseDown: void 0,
      /**
       * Main <TABLE> element.
       *
       * @private
       * @type {HTMLTableElement}
       */
      table: void 0,
      /**
       * Main <THEAD> element.
       *
       * @private
       * @type {HTMLTableSectionElement}
       */
      THEAD: void 0,
      /**
       * Main <TBODY> element.
       *
       * @private
       * @type {HTMLTableSectionElement}
       */
      TBODY: void 0,
      /**
       * Main Walkontable instance.
       *
       * @private
       * @type {Walkontable}
       */
      activeWt: void 0,
      /**
       * Main Walkontable instance.
       *
       * @private
       * @type {Walkontable}
       */
      wt: void 0,
    });

    this.createElements();
    this.registerEvents();
    this.initializeWalkOnTable();
  }

  /**
   * Prepares DOMElements and adds correct className to the root element.
   *
   * @private
   */
  createElements() {
    const priv = privatePool.get(this);
    const originalStyle = this.instance.rootElement.getAttribute('style');

    if (originalStyle) {
      this.instance.rootElement.setAttribute('data-originalstyle', originalStyle); // needed to retrieve original style in jsFiddle link generator in HT examples. may be removed in future versions
    }

    addClass(this.instance.rootElement, 'handsontable');

    priv.table = document.createElement('TABLE');
    addClass(priv.table, 'htCore');

    if (this.instance.getSettings().tableClassName) {
      addClass(priv.table, this.instance.getSettings().tableClassName);
    }

    priv.THEAD = document.createElement('THEAD');
    priv.table.appendChild(priv.THEAD);
    priv.TBODY = document.createElement('TBODY');
    priv.table.appendChild(priv.TBODY);

    this.instance.table = priv.table;

    this.instance.container.insertBefore(priv.table, this.instance.container.firstChild);
  }

  /**
   * Attaches necessary listeners.
   *
   * @private
   */
  registerEvents() {
    const priv = privatePool.get(this);

    this.eventManager.addEventListener(this.instance.rootElement, 'mousedown', (event) => {
      priv.selectionMouseDown = true;

      if (!this.isTextSelectionAllowed(event.target)) {
        clearTextSelection();
        event.preventDefault();
        window.focus(); // make sure that window that contains HOT is active. Important when HOT is in iframe.
      }
    });

    this.eventManager.addEventListener(this.instance.rootElement, 'mouseup', () => {
      priv.selectionMouseDown = false;
    });
    this.eventManager.addEventListener(this.instance.rootElement, 'mousemove', (event) => {
      if (priv.selectionMouseDown && !this.isTextSelectionAllowed(event.target)) {
        // Clear selection only when fragmentSelection is enabled, otherwise clearing selection breakes the IME editor.
        if (this.settings.fragmentSelection) {
          clearTextSelection();
        }
        event.preventDefault();
      }
    });

    this.eventManager.addEventListener(document.documentElement, 'keyup', (event) => {
      if (this.instance.selection.isInProgress() && !event.shiftKey) {
        this.instance.selection.finish();
      }
    });

    this.eventManager.addEventListener(document.documentElement, 'mouseup', (event) => {
      if (this.instance.selection.isInProgress() && isLeftClick(event)) { // is left mouse button
        this.instance.selection.finish();
      }

      priv.mouseDown = false;

      if (isOutsideInput(document.activeElement) || (!this.instance.selection.isSelected() && !isRightClick(event))) {
        this.instance.unlisten();
      }
    });

    this.eventManager.addEventListener(document.documentElement, 'contextmenu', (event) => {
      if (this.instance.selection.isInProgress() && isRightClick(event)) {
        this.instance.selection.finish();

        priv.mouseDown = false;
      }
    });

    this.eventManager.addEventListener(document.documentElement, 'touchend', () => {
      if (this.instance.selection.isInProgress()) {
        this.instance.selection.finish();
      }

      priv.mouseDown = false;
    });

    this.eventManager.addEventListener(document.documentElement, 'mousedown', (event) => {
      const originalTarget = event.target;
      const eventX = event.x || event.clientX;
      const eventY = event.y || event.clientY;
      let next = event.target;

      if (priv.mouseDown || !this.instance.rootElement) {
        return; // it must have been started in a cell
      }

      // immediate click on "holder" means click on the right side of vertical scrollbar
      if (next === this.instance.view.wt.wtTable.holder) {
        const scrollbarWidth = getScrollbarWidth();

        if (document.elementFromPoint(eventX + scrollbarWidth, eventY) !== this.instance.view.wt.wtTable.holder ||
          document.elementFromPoint(eventX, eventY + scrollbarWidth) !== this.instance.view.wt.wtTable.holder) {
          return;
        }
      } else {
        while (next !== document.documentElement) {
          if (next === null) {
            if (event.isTargetWebComponent) {
              break;
            }
            // click on something that was a row but now is detached (possibly because your click triggered a rerender)
            return;
          }
          if (next === this.instance.rootElement) {
            // click inside container
            return;
          }
          next = next.parentNode;
        }
      }

      // function did not return until here, we have an outside click!
      const outsideClickDeselects = typeof this.settings.outsideClickDeselects === 'function' ?
        this.settings.outsideClickDeselects(originalTarget) :
        this.settings.outsideClickDeselects;

      if (outsideClickDeselects) {
        this.instance.deselectCell();
      } else {
        this.instance.destroyEditor(false, false);
      }
    });

    this.eventManager.addEventListener(priv.table, 'selectstart', (event) => {
      if (this.settings.fragmentSelection || isInput(event.target)) {
        return;
      }
      // https://github.com/handsontable/handsontable/issues/160
      // Prevent text from being selected when performing drag down.
      event.preventDefault();
    });
  }

  /**
   * Defines default configuration and initializes WalkOnTable intance.
   *
   * @private
   */
  initializeWalkOnTable() {
    const priv = privatePool.get(this);
    const walkontableConfig = {
      debug: () => this.settings.debug,
      externalRowCalculator: this.instance.getPlugin('autoRowSize') && this.instance.getPlugin('autoRowSize').isEnabled(),
      table: priv.table,
      preventOverflow: () => this.settings.preventOverflow,
      stretchH: () => this.settings.stretchH,
      data: this.instance.getDataAtCell,
      totalRows: () => this.instance.countRows(),
      totalColumns: () => this.instance.countCols(),
      fixedColumnsLeft: () => this.settings.fixedColumnsLeft,
      fixedRowsTop: () => this.settings.fixedRowsTop,
      fixedRowsBottom: () => this.settings.fixedRowsBottom,
      minSpareRows: () => this.settings.minSpareRows,
      renderAllRows: this.settings.renderAllRows,
      rowHeaders: () => {
        const headerRenderers = [];

        if (this.instance.hasRowHeaders()) {
          headerRenderers.push((row, TH) => this.appendRowHeader(row, TH));
        }

        this.instance.runHooks('afterGetRowHeaderRenderers', headerRenderers);

        return headerRenderers;
      },
      columnHeaders: () => {
        const headerRenderers = [];

        if (this.instance.hasColHeaders()) {
          headerRenderers.push((column, TH) => {
            this.appendColHeader(column, TH);
          });
        }

        this.instance.runHooks('afterGetColumnHeaderRenderers', headerRenderers);

        return headerRenderers;
      },
      columnWidth: this.instance.getColWidth,
      rowHeight: this.instance.getRowHeight,
      cellRenderer: (row, col, TD) => {
        const cellProperties = this.instance.getCellMeta(row, col);
        const prop = this.instance.colToProp(col);
        let value = this.instance.getDataAtRowProp(row, prop);

        if (this.instance.hasHook('beforeValueRender')) {
          value = this.instance.runHooks('beforeValueRender', value, cellProperties);
        }

        this.instance.runHooks('beforeRenderer', TD, row, col, prop, value, cellProperties);
        this.instance.getCellRenderer(cellProperties)(this.instance, TD, row, col, prop, value, cellProperties);
        this.instance.runHooks('afterRenderer', TD, row, col, prop, value, cellProperties);
      },
      selections: this.instance.selection.highlight,
      hideBorderOnMouseDownOver: () => this.settings.fragmentSelection,
      onCellMouseDown: (event, coords, TD, wt) => {
        const blockCalculations = {
          row: false,
          column: false,
          cell: false
        };

        this.instance.listen();

        priv.activeWt = wt;
        priv.mouseDown = true;

        this.instance.runHooks('beforeOnCellMouseDown', event, coords, TD, blockCalculations);

        if (isImmediatePropagationStopped(event)) {
          return;
        }

        handleMouseEvent(event, {
          coords,
          selection: this.instance.selection,
          controller: blockCalculations,
        });

        this.instance.runHooks('afterOnCellMouseDown', event, coords, TD);
        priv.activeWt = priv.wt;
      },
      onCellContextMenu: (event, coords, TD, wt) => {
        priv.activeWt = wt;
        priv.mouseDown = false;

        if (this.instance.selection.isInProgress()) {
          this.instance.selection.finish();
        }

        this.instance.runHooks('beforeOnCellContextMenu', event, coords, TD);

        if (isImmediatePropagationStopped(event)) {
          return;
        }

        this.instance.runHooks('afterOnCellContextMenu', event, coords, TD);

        priv.activeWt = priv.wt;
      },
      onCellMouseOut: (event, coords, TD, wt) => {
        priv.activeWt = wt;
        this.instance.runHooks('beforeOnCellMouseOut', event, coords, TD);

        if (isImmediatePropagationStopped(event)) {
          return;
        }

        this.instance.runHooks('afterOnCellMouseOut', event, coords, TD);
        priv.activeWt = priv.wt;
      },
      onCellMouseOver: (event, coords, TD, wt) => {
        const blockCalculations = {
          row: false,
          column: false,
          cell: false
        };

        priv.activeWt = wt;

        this.instance.runHooks('beforeOnCellMouseOver', event, coords, TD, blockCalculations);

        if (isImmediatePropagationStopped(event)) {
          return;
        }

        if (priv.mouseDown) {
          handleMouseEvent(event, {
            coords,
            selection: this.instance.selection,
            controller: blockCalculations,
          });
        }

        this.instance.runHooks('afterOnCellMouseOver', event, coords, TD);
        priv.activeWt = priv.wt;
      },
      onCellMouseUp: (event, coords, TD, wt) => {
        priv.activeWt = wt;
        this.instance.runHooks('beforeOnCellMouseUp', event, coords, TD);

        this.instance.runHooks('afterOnCellMouseUp', event, coords, TD);
        priv.activeWt = priv.wt;
      },
      onCellCornerMouseDown: (event) => {
        event.preventDefault();
        this.instance.runHooks('afterOnCellCornerMouseDown', event);
      },
      onCellCornerDblClick: (event) => {
        event.preventDefault();
        this.instance.runHooks('afterOnCellCornerDblClick', event);
      },
      beforeDraw: (force, skipRender) => this.beforeRender(force, skipRender),
      onDraw: force => this.onDraw(force),
      onScrollVertically: () => this.instance.runHooks('afterScrollVertically'),
      onScrollHorizontally: () => this.instance.runHooks('afterScrollHorizontally'),
      onBeforeRemoveCellClassNames: () => this.instance.runHooks('beforeRemoveCellClassNames'),
      onAfterDrawSelection: (currentRow, currentColumn, cornersOfSelection, layerLevel) => this.instance.runHooks('afterDrawSelection',
        currentRow, currentColumn, cornersOfSelection, layerLevel),
      onBeforeDrawBorders: (corners, borderClassName) => this.instance.runHooks('beforeDrawBorders', corners, borderClassName),
      onBeforeTouchScroll: () => this.instance.runHooks('beforeTouchScroll'),
      onAfterMomentumScroll: () => this.instance.runHooks('afterMomentumScroll'),
      onBeforeStretchingColumnWidth: (stretchedWidth, column) => this.instance.runHooks('beforeStretchingColumnWidth', stretchedWidth, column),
      onModifyRowHeaderWidth: rowHeaderWidth => this.instance.runHooks('modifyRowHeaderWidth', rowHeaderWidth),
      onModifyGetCellCoords: (row, column, topmost) => this.instance.runHooks('modifyGetCellCoords', row, column, topmost),
      viewportRowCalculatorOverride: (calc) => {
        const rows = this.instance.countRows();
        let viewportOffset = this.settings.viewportRowRenderingOffset;

        if (viewportOffset === 'auto' && this.settings.fixedRowsTop) {
          viewportOffset = 10;
        }
        if (typeof viewportOffset === 'number') {
          calc.startRow = Math.max(calc.startRow - viewportOffset, 0);
          calc.endRow = Math.min(calc.endRow + viewportOffset, rows - 1);
        }
        if (viewportOffset === 'auto') {
          const center = calc.startRow + calc.endRow - calc.startRow;
          const offset = Math.ceil(center / rows * 12);

          calc.startRow = Math.max(calc.startRow - offset, 0);
          calc.endRow = Math.min(calc.endRow + offset, rows - 1);
        }
        this.instance.runHooks('afterViewportRowCalculatorOverride', calc);
      },
      viewportColumnCalculatorOverride: (calc) => {
        const cols = this.instance.countCols();
        let viewportOffset = this.settings.viewportColumnRenderingOffset;

        if (viewportOffset === 'auto' && this.settings.fixedColumnsLeft) {
          viewportOffset = 10;
        }
        if (typeof viewportOffset === 'number') {
          calc.startColumn = Math.max(calc.startColumn - viewportOffset, 0);
          calc.endColumn = Math.min(calc.endColumn + viewportOffset, cols - 1);
        }
        if (viewportOffset === 'auto') {
          const center = calc.startColumn + calc.endColumn - calc.startColumn;
          const offset = Math.ceil(center / cols * 12);

          calc.startRow = Math.max(calc.startColumn - offset, 0);
          calc.endColumn = Math.min(calc.endColumn + offset, cols - 1);
        }
        this.instance.runHooks('afterViewportColumnCalculatorOverride', calc);
      },
      rowHeaderWidth: () => this.settings.rowHeaderWidth,
      columnHeaderHeight: () => {
        const columnHeaderHeight = this.instance.runHooks('modifyColumnHeaderHeight');
        return this.settings.columnHeaderHeight || columnHeaderHeight;
      }
    };

    this.instance.runHooks('beforeInitWalkontable', walkontableConfig);

    priv.wt = new Walkontable(walkontableConfig);
    priv.activeWt = priv.wt;

    this.eventManager.addEventListener(priv.wt.wtTable.spreader, 'mousedown', (event) => {
      // right mouse button exactly on spreader means right click on the right hand side of vertical scrollbar
      if (event.target === [priv].wt.wtTable.spreader && event.which === 3) {
        stopPropagation(event);
      }
    });

    this.eventManager.addEventListener(priv.wt.wtTable.spreader, 'contextmenu', (event) => {
      // right mouse button exactly on spreader means right click on the right hand side of vertical scrollbar
      if (event.target === priv.wt.wtTable.spreader && event.which === 3) {
        stopPropagation(event);
      }
    });

    this.eventManager.addEventListener(document.documentElement, 'click', () => {
      if (this.settings.observeDOMVisibility) {
        if (priv.wt.drawInterrupted) {
          this.instance.forceFullRender = true;
          this.render();
        }
      }
    });
  }

  /**
   * Checks if it's possible to create text selection in element.
   *
   * @private
   * @param {HTMLElement} el
   */
  isTextSelectionAllowed(el) {
    if (isInput(el)) {
      return true;
    }
    const isChildOfTableBody = isChildOf(el, this.instance.view.wt.wtTable.spreader);

    if (this.settings.fragmentSelection === true && isChildOfTableBody) {
      return true;
    }
    if (this.settings.fragmentSelection === 'cell' && this.isSelectedOnlyCell() && isChildOfTableBody) {
      return true;
    }
    if (!this.settings.fragmentSelection && this.isCellEdited() && this.isSelectedOnlyCell()) {
      return true;
    }

    return false;
  }

  /**
   * Checks if user's been called mousedown.
   *
   * @private
   * @returns {Boolean}
   */
  isMouseDown() {
    return privatePool.get(this).mouseDown;
  }

  /**
   * Check if selected only one cell.
   *
   * @returns {Boolean}
   */
  isSelectedOnlyCell() {
    const [row, col, rowEnd, colEnd] = this.instance.getSelectedLast() || [];

    return row !== void 0 && row === rowEnd && col === colEnd;
  }

  /**
   * Checks if active cell is editing.
   *
   * @returns {Boolean}
   */
  isCellEdited() {
    const activeEditor = this.instance.getActiveEditor();

    return activeEditor && activeEditor.isOpened();
  }

  /**
   * `beforeDraw` callback.
   *
   * @param {Boolean} force
   * @param {Boolean} skipRender
   */
  beforeRender(force, skipRender) {
    if (force) {
      // this.instance.forceFullRender = did Handsontable request full render?
      this.instance.runHooks('beforeRender', this.instance.forceFullRender, skipRender);
    }
  }

  /**
   * `onDraw` callback.
   *
   * @private
   * @param {Boolean} force
   */
  onDraw(force) {
    if (force) {
      // this.instance.forceFullRender = did Handsontable request full render?
      this.instance.runHooks('afterRender', this.instance.forceFullRender);
    }
  }

  /**
   * Renders WalkontableUI.
   */
  render() {
    privatePool.get(this).wt.draw(!this.instance.forceFullRender);
    this.instance.forceFullRender = false;
    this.instance.renderCall = false;
  }

  /**
   * Returns td object given coordinates
   *
   * @param {CellCoords} coords
   * @param {Boolean} topmost
   * @returns {HTMLTableCellElement|null}
   */
  getCellAtCoords(coords, topmost) {
    const td = privatePool.get(this).wt.getCell(coords, topmost);

    if (td < 0) { // there was an exit code (cell is out of bounds)
      return null;
    }

    return td;
  }

  /**
   * Scroll viewport to a cell.
   *
   * @param {CellCoords} coords
   * @param {Boolean} [snapToTop]
   * @param {Boolean} [snapToRight]
   * @param {Boolean} [snapToBottom]
   * @param {Boolean} [snapToLeft]
   * @returns {Boolean}
   */
  scrollViewport(coords, snapToTop, snapToRight, snapToBottom, snapToLeft) {
    return privatePool.get(this).wt.scrollViewport(coords, snapToTop, snapToRight, snapToBottom, snapToLeft);
  }

  /**
   * Scroll viewport to a column.
   *
   * @param {Number} column Visual column index.
   * @param {Boolean} [snapToLeft]
   * @param {Boolean} [snapToRight]
   * @returns {Boolean}
   */
  scrollViewportHorizontally(column, snapToRight, snapToLeft) {
    return privatePool.get(this).wt.scrollViewportHorizontally(column, snapToRight, snapToLeft);
  }

  /**
   * Scroll viewport to a row.
   *
   * @param {Number} row Visual row index.
   * @param {Boolean} [snapToTop]
   * @param {Boolean} [snapToBottom]
   * @returns {Boolean}
   */
  scrollViewportVertically(row, snapToTop, snapToBottom) {
    return privatePool.get(this).wt.scrollViewportVertically(row, snapToTop, snapToBottom);
  }

  /**
   * Append row header to a TH element
   *
   * @private
   * @param row
   * @param TH
   */
  appendRowHeader(row, TH) {
    if (TH.firstChild) {
      const container = TH.firstChild;

      if (!hasClass(container, 'relative')) {
        empty(TH);
        this.appendRowHeader(row, TH);

        return;
      }
      this.updateCellHeader(container.querySelector('.rowHeader'), row, this.instance.getRowHeader);

    } else {
      const div = document.createElement('div');
      const span = document.createElement('span');

      div.className = 'relative';
      span.className = 'rowHeader';
      this.updateCellHeader(span, row, this.instance.getRowHeader);

      div.appendChild(span);
      TH.appendChild(div);
    }

    this.instance.runHooks('afterGetRowHeader', row, TH);
  }

  /**
   * Append column header to a TH element
   *
   * @private
   * @param col
   * @param TH
   */
  appendColHeader(col, TH) {
    if (TH.firstChild) {
      const container = TH.firstChild;

      if (hasClass(container, 'relative')) {
        this.updateCellHeader(container.querySelector('.colHeader'), col, this.instance.getColHeader);
      } else {
        empty(TH);
        this.appendColHeader(col, TH);
      }

    } else {
      const div = document.createElement('div');
      const span = document.createElement('span');

      div.className = 'relative';
      span.className = 'colHeader';
      this.updateCellHeader(span, col, this.instance.getColHeader);

      div.appendChild(span);
      TH.appendChild(div);
    }

    this.instance.runHooks('afterGetColHeader', col, TH);
  }

  /**
   * Updates header cell content.
   *
   * @since 0.15.0-beta4
   * @private
   * @param {HTMLElement} element Element to update
   * @param {Number} index Row index or column index
   * @param {Function} content Function which should be returns content for this cell
   */
  updateCellHeader(element, index, content) {
    let renderedIndex = index;
    const priv = privatePool.get(this);
    const parentOverlay = priv.wt.wtOverlays.getParentOverlay(element) || priv.wt;

    // prevent wrong calculations from SampleGenerator
    if (element.parentNode) {
      if (hasClass(element, 'colHeader')) {
        renderedIndex = parentOverlay.wtTable.columnFilter.sourceToRendered(index);
      } else if (hasClass(element, 'rowHeader')) {
        renderedIndex = parentOverlay.wtTable.rowFilter.sourceToRendered(index);
      }
    }

    if (renderedIndex > -1) {
      fastInnerHTML(element, content(index));

    } else {
      // workaround for https://github.com/handsontable/handsontable/issues/1946
      fastInnerText(element, String.fromCharCode(160));
      addClass(element, 'cornerHeader');
    }
  }

  /**
   * Given a element's left position relative to the viewport, returns maximum element width until the right
   * edge of the viewport (before scrollbar)
   *
   * @private
   * @param {Number} leftOffset
   * @return {Number}
   */
  maximumVisibleElementWidth(leftOffset) {
    const workspaceWidth = privatePool.get(this).wt.wtViewport.getWorkspaceWidth();
    const maxWidth = workspaceWidth - leftOffset;

    return maxWidth > 0 ? maxWidth : 0;
  }

  /**
   * Given a element's top position relative to the viewport, returns maximum element height until the bottom
   * edge of the viewport (before scrollbar)
   *
   * @private
   * @param {Number} topOffset
   * @return {Number}
   */
  maximumVisibleElementHeight(topOffset) {
    const workspaceHeight = privatePool.get(this).wt.wtViewport.getWorkspaceHeight();
    const maxHeight = workspaceHeight - topOffset;

    return maxHeight > 0 ? maxHeight : 0;
  }

  /**
   * Checks if master overlay is active.
   *
   * @private
   * @returns {Boolean}
   */
  mainViewIsActive() {
    const priv = privatePool.get(this);

    return priv.wt === priv.activeWt;
  }

  /**
   * Destroyes internal WalkOnTable's instance. Detaches all of the bonded listeners.
   *
   * @private
   */
  destroy() {
    privatePool.get(this).wt.destroy();
    this.eventManager.destroy();
  }
}

export default TableView;
