/* prettier-ignore-file */
//=================================================
// TreeView.js - Tree View Panel for Data Explorer
//=================================================
// Manages hierarchical display of blast data, drawings, surfaces, and images

// PERFORMANCE FIX 2025-12-28: Chunked loading constants for KAD drawings
const TREE_CHUNK_SIZE = 50;       // Points per chunk group
const TREE_CHUNK_THRESHOLD = 20;  // Only chunk if more than this many points

// TreeView-Convention: Braille Pattern U+28FF separator - use constant to prevent corruption
const TREE_NODE_SEPARATOR = "\u28FF";

import { formatEntityStatistics } from '../../helpers/GeometryStatistics.js';
import { flashHighlight, clearAllHighlights } from '../../helpers/SurfaceHighlightHelper.js';

/**
 * Compute signed volume of a closed triangulated mesh using the divergence theorem.
 * Each triangle forms a tetrahedron with the origin; sum of signed volumes = mesh volume.
 *
 * @returns {{ volume: number, normalsConsistent: boolean }}
 *   normalsConsistent is true when all triangle winding agrees (all In or all Out).
 *   Detected by comparing |signedSum| to absoluteSum — if ratio < 0.9, normals are mixed.
 */
function computeMeshVolume(surface) {
	var tris = surface.triangles;
	if (!tris || tris.length === 0) return { volume: 0, normalsConsistent: true };

	var pts = surface.points;

	// Step 1) First pass: extract vertices and compute centroid.
	// Centering avoids floating-point errors with large UTM coordinates.
	var verts = [];
	var cx = 0, cy = 0, cz = 0;

	for (var i = 0; i < tris.length; i++) {
		var tri = tris[i];
		var v0, v1, v2;
		if (tri.vertices && tri.vertices.length >= 3) {
			v0 = tri.vertices[0]; v1 = tri.vertices[1]; v2 = tri.vertices[2];
		} else if (tri.a !== undefined && pts) {
			v0 = pts[tri.a]; v1 = pts[tri.b]; v2 = pts[tri.c];
		} else {
			continue;
		}
		if (!v0 || !v1 || !v2) continue;
		verts.push(v0, v1, v2);
		cx += v0.x + v1.x + v2.x;
		cy += v0.y + v1.y + v2.y;
		cz += v0.z + v1.z + v2.z;
	}

	var n = verts.length / 3;
	if (n === 0) return { volume: 0, normalsConsistent: true };
	var inv = 1.0 / (n * 3);
	cx *= inv; cy *= inv; cz *= inv;

	// Step 2) Second pass: divergence theorem with centered coordinates.
	// Also accumulate absolute per-triangle volume for consistency check.
	var vol = 0;
	var absVol = 0;
	for (var j = 0; j < n; j++) {
		var a = verts[j * 3], b = verts[j * 3 + 1], c = verts[j * 3 + 2];
		var x0 = a.x - cx, y0 = a.y - cy, z0 = a.z - cz;
		var x1 = b.x - cx, y1 = b.y - cy, z1 = b.z - cz;
		var x2 = c.x - cx, y2 = c.y - cy, z2 = c.z - cz;

		var sv = (x0 * (y1 * z2 - y2 * z1)
			- x1 * (y0 * z2 - y2 * z0)
			+ x2 * (y0 * z1 - y1 * z0)) / 6.0;
		vol += sv;
		absVol += Math.abs(sv);
	}

	// Step 3) Consistency: if |signed| / absolute < 0.9, normals are mixed
	var consistent = true;
	if (absVol > 1e-6) {
		consistent = (Math.abs(vol) / absVol) > 0.9;
	}

	return { volume: vol, normalsConsistent: consistent };
}

/**
 * Compute the XY footprint area of an open surface (sum of projected triangle areas).
 */
function computeFootprintArea(surface) {
	var tris = surface.triangles;
	if (!tris || tris.length === 0) return 0;

	var area = 0;
	var pts = surface.points;

	for (var i = 0; i < tris.length; i++) {
		var tri = tris[i];
		var v0, v1, v2;
		if (tri.vertices && tri.vertices.length >= 3) {
			v0 = tri.vertices[0]; v1 = tri.vertices[1]; v2 = tri.vertices[2];
		} else if (tri.a !== undefined && pts) {
			v0 = pts[tri.a]; v1 = pts[tri.b]; v2 = pts[tri.c];
		} else {
			continue;
		}
		if (!v0 || !v1 || !v2) continue;
		// Shoelace formula for projected XY triangle area
		area += Math.abs(
			(v1.x - v0.x) * (v2.y - v0.y) -
			(v2.x - v0.x) * (v1.y - v0.y)
		) / 2.0;
	}

	return area;
}

/**
 * Format a number with appropriate units (K, M) for compact display.
 */
function formatNumber(val) {
	if (val >= 1e6) return (val / 1e6).toFixed(2) + "M";
	if (val >= 1e4) return (val / 1e3).toFixed(1) + "K";
	return val.toFixed(1);
}

/**
 * Format area/volume values in full units with commas and 2 decimal places.
 */
function formatArea(val) {
	return val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export class TreeView {
	constructor(containerId) {
		this.container = document.getElementById(containerId);
		this.selectedNodes = new Set();
		this.expandedNodes = new Set();
		this.loadedChunks = new Set();  // PERFORMANCE FIX: Track loaded lazy chunks
		this.dragData = {
			isDragging: false,
			startX: 0,
			startY: 0,
		};
		this.isCollapsed = false;
		this.isSyncing = false; // Flag to prevent infinite loops
		this.resizeData = {
			isResizing: false,
			startX: 0,
			startWidth: 0,
			startRight: 0
		};

		this.init();
	}

	init() {
		this.setupEventListeners();
		this.createLeftResizeHandle();
		this.updateTreeData();
	}

	setupEventListeners() {
		// Panel dragging
		const header = document.getElementById("treePanelHeader");
		header.addEventListener("mousedown", this.startDrag.bind(this));

		// Panel controls
		document.getElementById("treeCollapseBtn").addEventListener("click", this.toggleCollapse.bind(this));
		document.getElementById("treeCloseBtn").addEventListener("click", this.hide.bind(this));

		// Tree interactions
		const treeView = document.getElementById("treeView");
		treeView.addEventListener("click", this.handleTreeClick.bind(this));
		treeView.addEventListener("contextmenu", this.handleContextMenu.bind(this));

		// Context menu
		document.getElementById("treeContextMenu").style.display = "none";
		const contextMenu = document.getElementById("treeContextMenu");
		contextMenu.addEventListener("click", this.handleContextAction.bind(this));

		// Hide context menu on outside click
		document.addEventListener("click", this.hideContextMenu.bind(this));

		// Keyboard shortcuts
		document.addEventListener("keydown", this.handleKeyboard.bind(this));

		// Color swatch event delegation
		this.container.addEventListener("click", (e) => {
			if (e.target.classList.contains("color-swatch")) {
				e.stopPropagation();

				const entityName = e.target.dataset.entityName;
				const pointID = parseInt(e.target.dataset.pointId);

				if (entityName && !isNaN(pointID) && typeof window.openColorPickerForElement === "function") {
					window.openColorPickerForElement(e.target, entityName, pointID);
				}
			}
		});
	}

	selectRange(startNodeId, endNodeId) {
		const allTreeItems = Array.from(this.container.querySelectorAll(".tree-item"));
		const allNodeIds = allTreeItems.map((item) => item.dataset.nodeId);

		const startIndex = allNodeIds.indexOf(startNodeId);
		const endIndex = allNodeIds.indexOf(endNodeId);

		if (startIndex === -1 || endIndex === -1) return;

		const minIndex = Math.min(startIndex, endIndex);
		const maxIndex = Math.max(startIndex, endIndex);

		this.clearSelection();

		for (let i = minIndex; i <= maxIndex; i++) {
			const nodeId = allNodeIds[i];
			const treeItem = allTreeItems[i];

			this.selectedNodes.add(nodeId);
			treeItem.classList.add("multi-selected");
		}
	}

	clearSelection() {
		this.selectedNodes.clear();
		this.container.querySelectorAll(".tree-item").forEach((item) => {
			item.classList.remove("selected", "multi-selected");
		});
		clearAllHighlights();
	}

	startDrag(e) {
		this.dragData.isDragging = true;
		this.dragData.startX = e.clientX - this.container.offsetLeft;
		this.dragData.startY = e.clientY - this.container.offsetTop;

		document.addEventListener("mousemove", this.drag.bind(this));
		document.addEventListener("mouseup", this.stopDrag.bind(this));
		e.preventDefault();
	}

	drag(e) {
		if (!this.dragData.isDragging) return;

		const x = e.clientX - this.dragData.startX;
		const y = e.clientY - this.dragData.startY;

		this.container.style.left = x + "px";
		this.container.style.top = y + "px";
	}

	stopDrag() {
		this.dragData.isDragging = false;
		document.removeEventListener("mousemove", this.drag);
		document.removeEventListener("mouseup", this.stopDrag);
	}

	toggleCollapse() {
		this.isCollapsed = !this.isCollapsed;
		this.container.classList.toggle("collapsed", this.isCollapsed);

		const btn = document.getElementById("treeCollapseBtn");
		btn.textContent = this.isCollapsed ? "+" : "−";
	}

	// Left-edge resize handle
	createLeftResizeHandle() {
		var handle = document.createElement('div');
		handle.className = 'tree-panel-resize-left';
		handle.title = 'Drag to resize';
		this.container.insertBefore(handle, this.container.firstChild);
		handle.addEventListener('mousedown', this.startLeftResize.bind(this));
	}

	startLeftResize(e) {
		e.preventDefault();
		e.stopPropagation();

		this.resizeData.isResizing = true;
		this.resizeData.startX = e.clientX;
		this.resizeData.startWidth = this.container.offsetWidth;
		this.resizeData.startRight = window.innerWidth - this.container.getBoundingClientRect().right;

		document.body.style.cursor = 'ew-resize';
		document.body.style.userSelect = 'none';

		this.boundDoLeftResize = this.doLeftResize.bind(this);
		this.boundStopLeftResize = this.stopLeftResize.bind(this);

		document.addEventListener('mousemove', this.boundDoLeftResize);
		document.addEventListener('mouseup', this.boundStopLeftResize);
	}

	doLeftResize(e) {
		if (!this.resizeData.isResizing) return;

		var deltaX = this.resizeData.startX - e.clientX;
		var newWidth = this.resizeData.startWidth + deltaX;

		var minWidth = 180;
		var maxWidth = window.innerWidth - 100;
		newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));

		this.container.style.width = newWidth + 'px';
		this.container.style.right = this.resizeData.startRight + 'px';
	}

	stopLeftResize() {
		this.resizeData.isResizing = false;
		document.body.style.cursor = '';
		document.body.style.userSelect = '';

		document.removeEventListener('mousemove', this.boundDoLeftResize);
		document.removeEventListener('mouseup', this.boundStopLeftResize);
	}

	hide() {
		this.container.style.display = "none";
	}

	show() {
		this.container.style.display = "flex";

		// PERFORMANCE FIX 2025-12-28: Update tree if it was deferred while hidden
		if (window._treeNeedsUpdate) {
			window._treeNeedsUpdate = false;
			setTimeout(() => this.updateTreeData(), 50);
		}
	}

	// Step 1) BUG FIX 4: Fix individual hole highlighting with correct node ID format
	// Node ID format: "hole⣿entityName⣿holeID" (3 parts)
	highlightNodes(nodeIds) {
		this.isSyncing = true;
		this.clearSelection();

		nodeIds.forEach((nodeId) => {
			const element = this.container.querySelector("[data-node-id=\"" + nodeId + "\"]");
			if (element) {
				this.selectedNodes.add(nodeId);
				element.classList.add("selected");

				// Auto-expand parent if collapsed
				this.ensureNodeVisible(nodeId);
			}
		});

		this.isSyncing = false;
	}

	// Step 2) Ensure node is visible (expand parents if needed)
	ensureNodeVisible(nodeId) {
		const element = this.container.querySelector("[data-node-id=\"" + nodeId + "\"]");
		if (!element) return;

		// Find parent nodes and expand them
		let parent = element.parentElement;
		while (parent && parent !== this.container) {
			if (parent.classList.contains("tree-children")) {
				parent.classList.add("expanded");
				// Find the parent tree-item
				const parentItem = parent.previousElementSibling;
				if (parentItem && parentItem.classList.contains("tree-item")) {
					const parentNodeId = parentItem.dataset.nodeId;
					if (parentNodeId) {
						this.expandedNodes.add(parentNodeId);
						const expandBtn = parentItem.querySelector(".tree-expand");
						if (expandBtn) expandBtn.classList.add("expanded");
					}
				}
			}
			parent = parent.parentElement;
		}
	}

	handleTreeClick(e) {
		const treeItem = e.target.closest(".tree-item");
		if (!treeItem) return;

		const expandBtn = e.target.closest(".tree-expand");
		if (expandBtn && !expandBtn.classList.contains("leaf")) {
			this.toggleNode(treeItem);
			return;
		}

		const nodeId = treeItem.dataset.nodeId;

		if (e.shiftKey && this.lastClickedNode) {
			this.selectRange(this.lastClickedNode, nodeId);
		} else if (e.ctrlKey || e.metaKey) {
			if (this.selectedNodes.has(nodeId)) {
				this.selectedNodes.delete(nodeId);
				treeItem.classList.remove("selected", "multi-selected");
			} else {
				this.selectedNodes.add(nodeId);
				treeItem.classList.add("multi-selected");
			}
			this.lastClickedNode = nodeId;
		} else {
			// Step 1) If clicking the already-selected single node, deselect it
			if (this.selectedNodes.size === 1 && this.selectedNodes.has(nodeId)) {
				this.clearSelection();
				this.lastClickedNode = null;
			} else {
				this.clearSelection();
				this.selectedNodes.add(nodeId);
				treeItem.classList.add("selected");
				this.lastClickedNode = nodeId;
			}
		}

		this.onSelectionChange();
	}

	toggleNode(treeItem) {
		const nodeId = treeItem.dataset.nodeId;
		const children = treeItem.parentNode.querySelector(".tree-children");
		const expandBtn = treeItem.querySelector(".tree-expand");

		if (!children) return;

		// PERFORMANCE FIX 2025-12-28: Check if this is a lazy entity that needs loading
		// Entity nodes: "line⣿entityName", "poly⣿entityName", "points⣿entityName", etc.
		var isEntityNode = (nodeId.startsWith("line⣿") || nodeId.startsWith("poly⣿") ||
			nodeId.startsWith("points⣿") || nodeId.startsWith("circle⣿") || nodeId.startsWith("text⣿")) &&
			nodeId.split("⣿").length === 2;  // Only 2 parts = entity level

		if (isEntityNode && !this.loadedChunks.has(nodeId)) {
			this.loadEntityChildren(nodeId, treeItem, children);
		}

		// PERFORMANCE FIX 2025-12-28: Check if this is a lazy chunk that needs loading
		if (nodeId.includes("⣿chunk⣿") && !this.loadedChunks.has(nodeId)) {
			this.loadChunkChildren(nodeId, treeItem, children);
		}

		if (this.expandedNodes.has(nodeId)) {
			this.expandedNodes.delete(nodeId);
			children.classList.remove("expanded");
			expandBtn.classList.remove("expanded");
		} else {
			this.expandedNodes.add(nodeId);
			children.classList.add("expanded");
			expandBtn.classList.add("expanded");
		}
	}

	// PERFORMANCE FIX 2025-12-28: Lazy load entity children when expanded
	loadEntityChildren(nodeId, treeItem, childrenContainer) {
		// Parse entity node ID format: "entityType⣿entityName"
		var parts = nodeId.split("⣿");
		if (parts.length < 2) return;

		var entityTypePrefix = parts[0];  // "line", "poly", "points", "circle", "text"
		var entityName = parts[1];

		// Map prefix to actual entity type
		var entityType = entityTypePrefix;
		if (entityTypePrefix === "points") entityType = "point";

		var entity = window.allKADDrawingsMap ? window.allKADDrawingsMap.get(entityName) : null;
		if (!entity || !entity.data) return;

		var pointCount = entity.data.length;
		console.log("📁 Loading entity: " + entityName + " (" + pointCount + " points)");

		var elementChildren;
		if (pointCount > TREE_CHUNK_THRESHOLD) {
			// Large entity - create chunked placeholder nodes
			elementChildren = this.createChunkedChildren(entity, entityName);
		} else {
			// Small entity - create all children directly
			elementChildren = [];
			for (var i = 0; i < entity.data.length; i++) {
				var element = entity.data[i];
				var pointID = element.pointID || (i + 1);

				var label = "";
				var meta = "";
				if (entity.entityType === "text") {
					label = element.text || "Text " + pointID;
					meta = "(" + (Number(element.pointXLocation) || 0).toFixed(1) + "," + (Number(element.pointYLocation) || 0).toFixed(1) + ")";
				} else if (entity.entityType === "circle") {
					label = "Circle " + pointID;
					meta = "R:" + (Number(element.radius) || 0).toFixed(1);
				} else {
					label = String(pointID);
					meta = "(" + (Number(element.pointXLocation) || 0).toFixed(1) + "," + (Number(element.pointYLocation) || 0).toFixed(1) + "," + (Number(element.pointZLocation) || 0).toFixed(1) + ")";
				}

				elementChildren.push({
					id: entity.entityType + "⣿" + entityName + "⣿element⣿" + pointID,
					type: entity.entityType + "⣿element",
					label: label,
					meta: meta,
					elementData: {
						...element,
						entityName: entityName
					}
				});
			}
		}

		// Render entity children HTML
		var html = this.renderTree(elementChildren, 0);
		childrenContainer.innerHTML = html;

		// Mark as loaded
		this.loadedChunks.add(nodeId);
		console.log("✅ Loaded entity children: " + elementChildren.length + " items");
	}

	// PERFORMANCE FIX 2025-12-28: Create chunked placeholder nodes for large entities
	createChunkedChildren(entity, entityName) {
		var chunks = [];
		var totalPoints = entity.data ? entity.data.length : 0;
		var entityType = entity.entityType;

		for (var i = 0; i < totalPoints; i += TREE_CHUNK_SIZE) {
			var start = i + 1;  // 1-based for display
			var end = Math.min(i + TREE_CHUNK_SIZE, totalPoints);
			var chunkPointCount = end - start + 1;

			chunks.push({
				id: entityType + "⣿" + entityName + "⣿chunk⣿" + start + "-" + end,
				type: "point-chunk",
				label: "Points " + start + "-" + end,
				meta: "(" + chunkPointCount + " points)",
				isLazyChunk: true,
				children: []  // Empty - will be populated on expand
			});
		}

		console.log("📦 Created " + chunks.length + " chunks for " + entityName + " (" + totalPoints + " points)");
		return chunks;
	}

	// PERFORMANCE FIX 2025-12-28: Lazy load chunk children when expanded
	loadChunkChildren(nodeId, treeItem, childrenContainer) {
		// Parse chunk node ID format: "entityType⣿entityName⣿chunk⣿startIdx-endIdx"
		var parts = nodeId.split("⣿");
		if (parts.length < 4) return;

		var entityType = parts[0];
		var entityName = parts[1];
		var rangeStr = parts[3];
		var rangeParts = rangeStr.split("-");
		var startIdx = parseInt(rangeParts[0]) - 1;  // Convert to 0-based
		var endIdx = parseInt(rangeParts[1]) - 1;

		var entity = window.allKADDrawingsMap ? window.allKADDrawingsMap.get(entityName) : null;
		if (!entity || !entity.data) return;

		console.log("📦 Loading chunk: " + entityName + " points " + (startIdx + 1) + "-" + (endIdx + 1));

		// Generate children for this chunk only
		var chunkChildren = [];
		for (var i = startIdx; i <= endIdx && i < entity.data.length; i++) {
			var element = entity.data[i];
			var pointID = element.pointID || (i + 1);

			var label = "";
			var meta = "";
			if (entityType === "text") {
				label = element.text || "Text " + pointID;
				meta = "(" + (Number(element.pointXLocation) || 0).toFixed(1) + "," + (Number(element.pointYLocation) || 0).toFixed(1) + ")";
			} else if (entityType === "circle") {
				label = "Circle " + pointID;
				meta = "R:" + (Number(element.radius) || 0).toFixed(1);
			} else {
				label = String(pointID);
				meta = "(" + (Number(element.pointXLocation) || 0).toFixed(1) + "," + (Number(element.pointYLocation) || 0).toFixed(1) + "," + (Number(element.pointZLocation) || 0).toFixed(1) + ")";
			}

			chunkChildren.push({
				id: entityType + "⣿" + entityName + "⣿element⣿" + pointID,
				type: entityType + "⣿element",
				label: label,
				meta: meta,
				elementData: {
					...element,
					entityName: entityName
				}
			});
		}

		// Render chunk children HTML
		var html = this.renderTree(chunkChildren, 0);
		childrenContainer.innerHTML = html;

		// Mark as loaded
		this.loadedChunks.add(nodeId);
		console.log("✅ Loaded " + chunkChildren.length + " points for chunk");
	}

	handleContextMenu(e) {
		const treeItem = e.target.closest(".tree-item");
		if (!treeItem) return;

		e.preventDefault();

		const nodeId = treeItem.dataset.nodeId;
		if (!this.selectedNodes.has(nodeId)) {
			this.clearSelection();
			this.selectedNodes.add(nodeId);
			treeItem.classList.add("selected");
		}

		this.showContextMenu(e.clientX, e.clientY);
	}

	showContextMenu(x, y) {
		var menu = document.getElementById("treeContextMenu");
		var selectedNodeIds = Array.from(this.selectedNodes);
		var isTopLevelParent = selectedNodeIds.some(function (nodeId) {
			return nodeId === "blast" || nodeId === "drawings" || nodeId === "surfaces" || nodeId === "images";
		});
		var hasHoles = selectedNodeIds.some(function (nodeId) { return nodeId.startsWith("hole⣿"); });
		var isSubGroup = selectedNodeIds.some(function (nodeId) {
			return nodeId.startsWith("drawings⣿") && nodeId.split("⣿").length === 2;
		});

		// Step 8) Layer System 2026-01-16: Detect layer nodes and Drawings/Surfaces root
		var isDrawingsRoot = selectedNodeIds.some(function (nodeId) { return nodeId === "drawings"; });
		var isSurfacesRoot = selectedNodeIds.some(function (nodeId) { return nodeId === "surfaces"; });
		var isLayerNode = selectedNodeIds.some(function (nodeId) {
			return nodeId.startsWith("layer-drawing⣿") || nodeId.startsWith("layer-surface⣿");
		});
		var isDrawingLayer = selectedNodeIds.some(function (nodeId) {
			return nodeId.startsWith("layer-drawing⣿") && nodeId.split("⣿").length === 2;
		});
		var isSurfaceLayer = selectedNodeIds.some(function (nodeId) {
			return nodeId.startsWith("layer-surface⣿") && nodeId.split("⣿").length === 2;
		});

		// Step 276c) Check if any selected node is an entity node (line⣿name, poly⣿name, etc.) or chunk node
		var hasEntityOrChunk = selectedNodeIds.some(function (nodeId) {
			var parts = nodeId.split("⣿");
			var isEntityNode = (parts[0] === "line" || parts[0] === "poly" || parts[0] === "points" || parts[0] === "circle" || parts[0] === "text") && parts.length === 2;
			var isChunkNode = parts.length === 4 && parts[2] === "chunk";
			return isEntityNode || isChunkNode;
		});

		var addLayerItem = menu.querySelector("[data-action=\"add-layer\"]");
		var makeActiveItem = menu.querySelector("[data-action=\"make-active\"]");
		var renameItem = menu.querySelector("[data-action=\"rename\"]");
		var resetConnectionsItem = menu.querySelector("[data-action=\"reset-connections\"]");
		var propertiesItem = menu.querySelector("[data-action=\"properties\"]");
		var deleteItem = menu.querySelector("[data-action=\"delete\"]");
		var hideItem = menu.querySelector("[data-action=\"hide\"]");
		var showItem = menu.querySelector("[data-action=\"show\"]");

		// Step 8a) Show "Add Layer" only for Drawings or Surfaces root nodes
		if (addLayerItem) {
			addLayerItem.style.display = (isDrawingsRoot || isSurfacesRoot) ? "flex" : "none";
		}

		// Step 19) Show "Make Active" only for layer nodes
		if (makeActiveItem) {
			makeActiveItem.style.display = (isDrawingLayer || isSurfaceLayer) ? "flex" : "none";
		}

		if (resetConnectionsItem) {
			resetConnectionsItem.style.display = hasHoles ? "flex" : "none";
		}

		// Step 8b) Show delete for layers and regular items, but not top-level parents
		if (deleteItem) {
			var canDelete = !isTopLevelParent && !isSubGroup;
			// Allow deleting layers
			if (isDrawingLayer || isSurfaceLayer) canDelete = true;
			deleteItem.style.display = canDelete ? "flex" : "none";
		}

		// Step 4) Always show hide/show options (even for top-level nodes and subgroups)
		if (hideItem) {
			hideItem.style.display = "flex";
		}

		if (showItem) {
			showItem.style.display = "flex";
		}

		if (propertiesItem) {
			// Show properties for entity nodes, chunk nodes, and regular elements 
			// Hide for: top-level parents, subgroups, and surface layer nodes (but show for individual surfaces)
			var hideProperties = (isTopLevelParent || isSubGroup || isSurfaceLayer) && !hasEntityOrChunk;
			propertiesItem.style.display = hideProperties ? "none" : "flex";
		}

		var showRename = false;
		if (selectedNodeIds.length === 1) {
			var nodeId = selectedNodeIds[0];
			var parts = nodeId.split("⣿");
			if ((parts[0] === "points" || parts[0] === "line" || parts[0] === "poly" || parts[0] === "circle" || parts[0] === "text") && parts.length === 2) {
				showRename = true;
			}
			if (parts[0] === "entity" && parts.length === 2) {
				showRename = true;
			}
			if (parts[0] === "surface" && parts.length === 2) {
				showRename = true;
			}
			if (parts[0] === "image" && parts.length === 2) {
				showRename = true;
			}
			// Step 276a) Allow renaming individual holes (HoleID rename)
			// Node ID format: "hole⣿entityName⣿holeID"
			if (parts[0] === "hole" && parts.length === 3) {
				showRename = true;
			}
			// Step 8c) Allow renaming layer nodes
			if ((parts[0] === "layer-drawing" || parts[0] === "layer-surface") && parts.length === 2) {
				showRename = true;
			}
		}
		// Step 276b) Allow renaming when multiple holes are selected (BlastName reassignment)
		// Only show if ALL selected items are holes
		if (selectedNodeIds.length > 1) {
			var allAreHoles = selectedNodeIds.every(function (id) { return id.startsWith("hole⣿"); });
			if (allAreHoles) {
				showRename = true;
			}
		}

		if (renameItem) {
			renameItem.style.display = showRename ? "flex" : "none";
		}

		// Step 276d) Show "Assign Blast" for holes and entity nodes
		var assignBlastItem = menu.querySelector("[data-action=\"assign-blast\"]");
		if (assignBlastItem) {
			var hasHolesOrEntities = hasHoles || selectedNodeIds.some(function (id) {
				return id.startsWith("entity⣿");
			});
			assignBlastItem.style.display = hasHolesOrEntities ? "flex" : "none";
		}

		// "Move to Layer" — show for surface nodes and KAD entity nodes
		var moveToLayerItem = menu.querySelector("[data-action=\"move-to-layer\"]");
		if (moveToLayerItem) {
			var hasMoveableSurfaces = selectedNodeIds.some(function (nodeId) {
				return nodeId.startsWith("surface⣿") && nodeId.split("⣿").length === 2;
			});
			var hasMoveableEntities = selectedNodeIds.some(function (nodeId) {
				var parts = nodeId.split("⣿");
				return (parts[0] === "line" || parts[0] === "poly" || parts[0] === "points" || parts[0] === "circle" || parts[0] === "text") && parts.length === 2;
			});
			moveToLayerItem.style.display = (hasMoveableSurfaces || hasMoveableEntities) ? "flex" : "none";
		}

		// Surface normal/statistics tools — show only for surface nodes
		var hasSurfaces = selectedNodeIds.some(function (nodeId) {
			return nodeId.startsWith("surface⣿") && nodeId.split("⣿").length === 2;
		});
		// KAD poly/line/points statistics — show for line, poly, or points entity nodes
		var hasPolysOrLines = selectedNodeIds.some(function (nodeId) {
			var parts = nodeId.split("⣿");
			return (parts[0] === "line" || parts[0] === "poly" || parts[0] === "points") && parts.length === 2;
		});
		var flipNormalsItem = menu.querySelector("[data-action=\"flip-normals\"]");
		var alignNormalsItem = menu.querySelector("[data-action=\"align-normals\"]");
		var statisticsItem = menu.querySelector("[data-action=\"statistics\"]");
		var normalsOutItem = menu.querySelector("[data-action=\"normals-out\"]");
		var normalsInItem = menu.querySelector("[data-action=\"normals-in\"]");
		if (flipNormalsItem) flipNormalsItem.style.display = hasSurfaces ? "flex" : "none";
		if (alignNormalsItem) alignNormalsItem.style.display = hasSurfaces ? "flex" : "none";
		if (normalsOutItem) normalsOutItem.style.display = hasSurfaces ? "flex" : "none";
		if (normalsInItem) normalsInItem.style.display = hasSurfaces ? "flex" : "none";
		if (statisticsItem) statisticsItem.style.display = (hasSurfaces || hasPolysOrLines) ? "flex" : "none";

		menu.style.left = x + "px";
		menu.style.top = y + "px";
		menu.style.display = "block";
	}

	hideContextMenu() {
		document.getElementById("treeContextMenu").style.display = "none";
	}

	handleContextAction(e) {
		var actionElement = e.target.closest(".tree-context-item");
		var action = actionElement ? actionElement.dataset.action : null;
		if (!action) return;

		this.hideContextMenu();

		switch (action) {
			case "add-layer":
				// Step 9) Layer System - Add new layer
				this.addLayer();
				break;
			case "make-active":
				// Step 19a) Layer System - Make layer active
				this.makeLayerActive();
				break;
			case "rename":
				this.renameEntity();
				break;
			case "assign-blast":
				this.assignBlast();
				break;
			case "delete":
				this.deleteSelected();
				break;
			case "hide":
				this.hideSelected();
				break;
			case "show":
				this.showSelected();
				break;
			case "reset-connections":
				this.resetConnections();
				break;
			case "properties":
				this.showProperties();
				break;
			case "flip-normals":
				this.flipNormals();
				break;
			case "align-normals":
				this.alignNormals();
				break;
			case "normals-out":
				this.setNormalsDirection("out");
				break;
			case "normals-in":
				this.setNormalsDirection("in");
				break;
			case "statistics":
				this.showStatistics();
				break;
			case "move-to-layer":
				this.moveToLayer();
				break;
		}
		document.getElementById("treeContextMenu").style.display = "none";
	}

	// Methods that rely on global functions will be implemented
	// These need access to global state from kirra.js
	renumberSelected() {
		console.log("Renumber not yet implemented");
	}

	// Step 10) Layer System - Add a new layer
	addLayer() {
		if (this.selectedNodes.size === 0) return;

		var nodeIds = Array.from(this.selectedNodes);
		var selectedNodeId = nodeIds[0];

		// Step 10a) Determine if adding to Drawings or Surfaces
		var isDrawings = selectedNodeId === "drawings";
		var isSurfaces = selectedNodeId === "surfaces";

		if (!isDrawings && !isSurfaces) {
			console.log("Add Layer: Can only add to Drawings or Surfaces root");
			return;
		}

		// Step 10b) Delegate to global function in kirra.js
		if (typeof window.createLayerDialog === "function") {
			window.createLayerDialog(isDrawings ? "drawing" : "surface");
		} else {
			console.error("createLayerDialog function not found in window scope");
		}
	}

	// Step 19b) Layer System - Make layer active
	makeLayerActive() {
		if (this.selectedNodes.size === 0) return;

		var nodeIds = Array.from(this.selectedNodes);
		var selectedNodeId = nodeIds[0];
		var parts = selectedNodeId.split("⣿");

		if (parts.length !== 2) return;

		var layerType = null;
		var layerId = parts[1];

		if (parts[0] === "layer-drawing") {
			layerType = "drawing";
		} else if (parts[0] === "layer-surface") {
			layerType = "surface";
		}

		if (layerType && typeof window.setActiveLayer === "function") {
			window.setActiveLayer(layerType, layerId);
		}
	}

	resetConnections() {
		if (this.selectedNodes.size === 0) return;

		const nodeIds = Array.from(this.selectedNodes);
		const holeNodeIds = nodeIds.filter((nodeId) => nodeId.startsWith("hole⣿"));

		if (holeNodeIds.length === 0) return;

		// Delegate to global functions
		if (typeof window.handleTreeViewResetConnections === "function") {
			window.handleTreeViewResetConnections(holeNodeIds);
		}
	}

	/**
	 * Flip all normals on selected surface(s) — reverses triangle winding order.
	 */
	flipNormals() {
		if (this.selectedNodes.size === 0) return;

		var nodeIds = Array.from(this.selectedNodes);
		var surfaceIds = [];
		for (var i = 0; i < nodeIds.length; i++) {
			var parts = nodeIds[i].split(TREE_NODE_SEPARATOR);
			if (parts[0] === "surface" && parts.length === 2) {
				surfaceIds.push(parts[1]);
			}
		}
		if (surfaceIds.length === 0) return;

		import("../../helpers/SurfaceNormalHelper.js").then(function (mod) {
			for (var s = 0; s < surfaceIds.length; s++) {
				var surfaceId = surfaceIds[s];
				var surface = window.loadedSurfaces ? window.loadedSurfaces.get(surfaceId) : null;
				if (!surface) continue;

				surface.triangles = mod.flipSurfaceNormals(surface);
				console.log("Flip Normals: flipped all normals on " + surfaceId);

				if (typeof window.saveSurfaceToDB === "function") {
					window.saveSurfaceToDB(surfaceId);
				}
			}

			if (typeof window.invalidateSurfaceCache === "function") {
				for (var s2 = 0; s2 < surfaceIds.length; s2++) {
					window.invalidateSurfaceCache(surfaceIds[s2]);
				}
			}
			if (typeof window.drawData === "function") {
				window.drawData(window.allBlastHoles, window.selectedHole);
			}
			if (typeof window.debouncedUpdateTreeView === "function") {
				window.debouncedUpdateTreeView();
			}
		}).catch(function (err) {
			console.error("Flip Normals failed:", err);
		});
	}

	/**
	 * Align normals on selected surface(s) to Kirra's Z-up convention.
	 */
	alignNormals() {
		if (this.selectedNodes.size === 0) return;

		var nodeIds = Array.from(this.selectedNodes);
		var surfaceIds = [];
		for (var i = 0; i < nodeIds.length; i++) {
			var parts = nodeIds[i].split(TREE_NODE_SEPARATOR);
			if (parts[0] === "surface" && parts.length === 2) {
				surfaceIds.push(parts[1]);
			}
		}
		if (surfaceIds.length === 0) return;

		import("../../helpers/SurfaceNormalHelper.js").then(function (mod) {
			var results = [];

			for (var s = 0; s < surfaceIds.length; s++) {
				var surfaceId = surfaceIds[s];
				var surface = window.loadedSurfaces ? window.loadedSurfaces.get(surfaceId) : null;
				if (!surface) continue;

				var result = mod.alignSurfaceNormals(surface);
				surface.triangles = result.triangles;
				results.push({
					name: surface.name || surfaceId,
					flipped: result.flippedCount,
					total: result.totalCount
				});

				console.log("Align Normals: " + surfaceId + " — " + result.flippedCount + "/" + result.totalCount + " flipped to Z-up");

				if (typeof window.saveSurfaceToDB === "function") {
					window.saveSurfaceToDB(surfaceId);
				}
			}

			if (typeof window.invalidateSurfaceCache === "function") {
				for (var s2 = 0; s2 < surfaceIds.length; s2++) {
					window.invalidateSurfaceCache(surfaceIds[s2]);
				}
			}
			if (typeof window.drawData === "function") {
				window.drawData(window.allBlastHoles, window.selectedHole);
			}
			if (typeof window.debouncedUpdateTreeView === "function") {
				window.debouncedUpdateTreeView();
			}

			// Show results dialog
			import("../../dialog/FloatingDialog.js").then(function (dlgMod) {
				var content = document.createElement("div");
				content.style.padding = "15px";
				content.style.fontFamily = "monospace";
				content.style.fontSize = "13px";

				var lines = [];
				for (var r = 0; r < results.length; r++) {
					var res = results[r];
					if (res.flipped === 0) {
						lines.push(res.name + ": 0/" + res.total + " faces flipped (already aligned)");
					} else {
						lines.push(res.name + ": " + res.flipped + "/" + res.total + " faces flipped to Z-up");
					}
				}
				content.textContent = lines.join("\n");

				var dialog = new dlgMod.FloatingDialog({
					title: "Align Normals — Results",
					content: content,
					width: 450,
					height: 200,
					showConfirm: true,
					confirmText: "OK",
					showCancel: false
				});
				dialog.show();
			});
		}).catch(function (err) {
			console.error("Align Normals failed:", err);
		});
	}

	/**
	 * Set normals direction (out or in) on selected closed solid surface(s).
	 * Uses signed volume to determine current orientation and flips if needed.
	 */
	setNormalsDirection(direction) {
		if (this.selectedNodes.size === 0) return;

		var nodeIds = Array.from(this.selectedNodes);
		var surfaceIds = [];
		for (var i = 0; i < nodeIds.length; i++) {
			var parts = nodeIds[i].split(TREE_NODE_SEPARATOR);
			if (parts[0] === "surface" && parts.length === 2) {
				surfaceIds.push(parts[1]);
			}
		}
		if (surfaceIds.length === 0) return;

		import("../../helpers/SurfaceNormalHelper.js").then(function (mod) {
			var results = [];

			for (var s = 0; s < surfaceIds.length; s++) {
				var surfaceId = surfaceIds[s];
				var surface = window.loadedSurfaces ? window.loadedSurfaces.get(surfaceId) : null;
				if (!surface) continue;

				var result = mod.setSurfaceNormalsDirection(surface, direction);
				surface.triangles = result.triangles;
				results.push({ name: surface.name || surfaceId, message: result.message });

				console.log("Normals " + direction + ": " + surfaceId + " — " + result.message);

				if (typeof window.saveSurfaceToDB === "function") {
					window.saveSurfaceToDB(surfaceId);
				}
			}

			if (typeof window.invalidateSurfaceCache === "function") {
				for (var s2 = 0; s2 < surfaceIds.length; s2++) {
					window.invalidateSurfaceCache(surfaceIds[s2]);
				}
			}
			if (typeof window.drawData === "function") {
				window.drawData(window.allBlastHoles, window.selectedHole);
			}
			if (typeof window.debouncedUpdateTreeView === "function") {
				window.debouncedUpdateTreeView();
			}

			// Show results dialog
			import("../../dialog/FloatingDialog.js").then(function (dlgMod) {
				var content = document.createElement("div");
				content.style.padding = "15px";
				content.style.fontFamily = "monospace";
				content.style.fontSize = "13px";

				var lines = [];
				for (var r = 0; r < results.length; r++) {
					lines.push(results[r].name + ": " + results[r].message);
				}
				content.textContent = lines.join("\n");

				var label = direction === "out" ? "Normals Out" : "Normals In";
				var dialog = new dlgMod.FloatingDialog({
					title: label + " — Results",
					content: content,
					width: 400,
					height: 200,
					showConfirm: true,
					confirmText: "OK",
					showCancel: false
				});
				dialog.show();
			});
		}).catch(function (err) {
			console.error("Set Normals Direction failed:", err);
		});
	}

	/**
	 * Show statistics table for selected surface(s).
	 */
	showStatistics() {
		if (this.selectedNodes.size === 0) return;

		var nodeIds = Array.from(this.selectedNodes);
		var surfaceIds = [];
		var kadEntityNames = [];
		for (var i = 0; i < nodeIds.length; i++) {
			var parts = nodeIds[i].split(TREE_NODE_SEPARATOR);
			if (parts[0] === "surface" && parts.length === 2) {
				surfaceIds.push(parts[1]);
			}
			if ((parts[0] === "line" || parts[0] === "poly" || parts[0] === "points") && parts.length === 2) {
				kadEntityNames.push(parts[1]);
			}
		}

		// Dispatch to the appropriate statistics view
		if (kadEntityNames.length > 0) {
			this.showKADStatistics(kadEntityNames);
			return;
		}

		if (surfaceIds.length === 0) return;

		import("../../helpers/SurfaceNormalHelper.js").then(function (mod) {
			var rows = [];
			for (var s = 0; s < surfaceIds.length; s++) {
				var surface = window.loadedSurfaces ? window.loadedSurfaces.get(surfaceIds[s]) : null;
				if (!surface) continue;
				rows.push(mod.computeSurfaceStatistics(surface));
			}

			if (rows.length === 0) return;

			import("../../dialog/FloatingDialog.js").then(function (dlgMod) {
				var content = document.createElement("div");
				content.style.padding = "10px";
				content.style.overflow = "auto";

				var table = document.createElement("table");
				table.style.borderCollapse = "collapse";
				table.style.width = "100%";
				table.style.fontSize = "12px";
				table.style.fontFamily = "monospace";

				// Header
				var headers = ["Name", "Points", "Edges", "Faces", "Normal Dir.", "XY Area (m\u00B2)", "YZ Area (m\u00B2)", "XZ Area (m\u00B2)", "3D Area (m\u00B2)", "Volume (m\u00B3)", "Closed"];
				var thead = document.createElement("thead");
				var headerRow = document.createElement("tr");
				for (var h = 0; h < headers.length; h++) {
					var th = document.createElement("th");
					th.textContent = headers[h];
					th.style.borderBottom = "2px solid #666";
					th.style.padding = "4px 8px";
					th.style.textAlign = h === 0 || h === 4 || h === 10 ? "left" : "right";
					th.style.whiteSpace = "nowrap";
					headerRow.appendChild(th);
				}
				thead.appendChild(headerRow);
				table.appendChild(thead);

				// Rows
				var tbody = document.createElement("tbody");
				for (var r = 0; r < rows.length; r++) {
					var row = rows[r];
					var tr = document.createElement("tr");
					tr.style.borderBottom = "1px solid #444";

					var cells = [
						row.name,
						row.points.toLocaleString(),
						row.edges.toLocaleString(),
						row.faces.toLocaleString(),
						row.normalDirection,
						formatArea(row.xyArea),
						formatArea(row.yzArea),
						formatArea(row.xzArea),
						formatArea(row.surfaceArea),
						formatArea(row.volume),
						row.closed
					];

					for (var c = 0; c < cells.length; c++) {
						var td = document.createElement("td");
						td.textContent = cells[c];
						td.style.padding = "4px 8px";
						td.style.textAlign = c === 0 || c === 4 || c === 10 ? "left" : "right";
						td.style.whiteSpace = "nowrap";
						tr.appendChild(td);
					}
					tbody.appendChild(tr);
				}
				table.appendChild(tbody);
				content.appendChild(table);

				// Build tab-separated text for clipboard copy
				var clipText = headers.join("\t") + "\n";
				for (var cr = 0; cr < rows.length; cr++) {
					var cRow = rows[cr];
					clipText += [
						cRow.name,
						cRow.points,
						cRow.edges,
						cRow.faces,
						cRow.normalDirection,
						cRow.xyArea.toFixed(2),
						cRow.yzArea.toFixed(2),
						cRow.xzArea.toFixed(2),
						cRow.surfaceArea.toFixed(2),
						cRow.volume.toFixed(2),
						cRow.closed
					].join("\t") + "\n";
				}

				var dialog = new dlgMod.FloatingDialog({
					title: "Surface Statistics",
					content: content,
					width: Math.min(900, window.innerWidth - 100),
					height: Math.min(300 + rows.length * 30, window.innerHeight - 100),
					showConfirm: true,
					confirmText: "Copy",
					onConfirm: function () {
						navigator.clipboard.writeText(clipText).then(function () {
							console.log("Statistics copied to clipboard");
						}).catch(function (err) {
							console.error("Clipboard copy failed:", err);
						});
						return false; // Keep dialog open after copy
					},
					showCancel: true,
					cancelText: "Close"
				});
				dialog.show();
			});
		}).catch(function (err) {
			console.error("Statistics failed:", err);
		});
	}

	showKADStatistics(entityNames) {
		import("../../helpers/KADStatisticsHelper.js").then(function (mod) {
			var rows = [];
			for (var i = 0; i < entityNames.length; i++) {
				var entity = window.allKADDrawingsMap ? window.allKADDrawingsMap.get(entityNames[i]) : null;
				if (!entity) continue;
				rows.push(mod.computeKADEntityStatistics(entity));
			}

			if (rows.length === 0) return;

			import("../../dialog/FloatingDialog.js").then(function (dlgMod) {
				var content = document.createElement("div");
				content.style.padding = "10px";
				content.style.overflow = "auto";

				var table = document.createElement("table");
				table.style.borderCollapse = "collapse";
				table.style.width = "100%";
				table.style.fontSize = "12px";
				table.style.fontFamily = "monospace";

				// Header
				var headers = ["Name", "#Vertices", "#Segments", "Length (m)", "Area XY (m\u00B2)", "Area YZ (m\u00B2)", "Area XZ (m\u00B2)", "Winding Dir.", "Closed"];
				var thead = document.createElement("thead");
				var headerRow = document.createElement("tr");
				for (var h = 0; h < headers.length; h++) {
					var th = document.createElement("th");
					th.textContent = headers[h];
					th.style.borderBottom = "2px solid #666";
					th.style.padding = "4px 8px";
					th.style.textAlign = h === 0 || h === 7 || h === 8 ? "left" : "right";
					th.style.whiteSpace = "nowrap";
					headerRow.appendChild(th);
				}
				thead.appendChild(headerRow);
				table.appendChild(thead);

				// Rows
				var tbody = document.createElement("tbody");
				for (var r = 0; r < rows.length; r++) {
					var row = rows[r];
					var tr = document.createElement("tr");
					tr.style.borderBottom = "1px solid #444";

					var cells = [
						row.name,
						row.vertices.toLocaleString(),
						row.segments.toLocaleString(),
						row.length.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
						row.areaXY.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
						row.areaYZ.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
						row.areaXZ.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
						row.windingDirection,
						row.closed
					];

					for (var c = 0; c < cells.length; c++) {
						var td = document.createElement("td");
						td.textContent = cells[c];
						td.style.padding = "4px 8px";
						td.style.textAlign = c === 0 || c === 7 || c === 8 ? "left" : "right";
						td.style.whiteSpace = "nowrap";
						tr.appendChild(td);
					}
					tbody.appendChild(tr);
				}
				table.appendChild(tbody);
				content.appendChild(table);

				// Build tab-separated text for clipboard copy
				var clipText = headers.join("\t") + "\n";
				for (var cr = 0; cr < rows.length; cr++) {
					var cRow = rows[cr];
					clipText += [
						cRow.name,
						cRow.vertices,
						cRow.segments,
						cRow.length.toFixed(2),
						cRow.areaXY.toFixed(2),
						cRow.areaYZ.toFixed(2),
						cRow.areaXZ.toFixed(2),
						cRow.windingDirection,
						cRow.closed
					].join("\t") + "\n";
				}

				var dialog = new dlgMod.FloatingDialog({
					title: "Line / Polygon Statistics",
					content: content,
					width: Math.min(900, window.innerWidth - 100),
					height: Math.min(300 + rows.length * 30, window.innerHeight - 100),
					showConfirm: true,
					confirmText: "Copy",
					onConfirm: function () {
						navigator.clipboard.writeText(clipText).then(function () {
							console.log("KAD statistics copied to clipboard");
						}).catch(function (err) {
							console.error("Clipboard copy failed:", err);
						});
						return false; // Keep dialog open after copy
					},
					showCancel: true,
					cancelText: "Close"
				});
				dialog.show();
			});
		}).catch(function (err) {
			console.error("KAD Statistics failed:", err);
		});
	}

	deleteSelected() {
		if (this.selectedNodes.size === 0) return;

		const nodeIds = Array.from(this.selectedNodes);

		// Delegate to global function
		if (typeof window.handleTreeViewDelete === "function") {
			window.handleTreeViewDelete(nodeIds, this);
		}
	}

	hideSelected() {
		var self = this;
		this.selectedNodes.forEach(function (nodeId) {
			var element = self.container.querySelector("[data-node-id=\"" + nodeId + "\"]");
			if (element) {
				element.style.opacity = "0.5";
				element.classList.add("hidden-node");

				// Step 0) Cascade hidden visual state to all child tree-items in the DOM
				var parentLi = element.closest(".tree-node");
				if (parentLi) {
					var childItems = parentLi.querySelectorAll(".tree-item");
					childItems.forEach(function (child) {
						if (child !== element) {
							child.style.opacity = "0.5";
							child.classList.add("hidden-node");
						}
					});
				}

				var parts = nodeId.split("⣿");
				var type = parts[0];
				var itemId = parts.slice(1).join("⣿");

				// Step 1) Handle top-level nodes (hide all children)
				if (nodeId === "blast" || nodeId === "drawings" || nodeId === "surfaces" || nodeId === "images") {
					self.hideAllChildren(nodeId);
				}
				// Step 2) Handle drawing layer nodes (hide all entities in layer)
				else if (type === "layer-drawing" && parts.length === 2) {
					var layerId = parts[1];
					if (typeof window.setLayerVisibility === "function") {
						window.setLayerVisibility(layerId, "drawing", false);
					}
					self.hideAllChildren(nodeId);
				}
				// Step 2a) Handle drawing layer entity-type folders (e.g., layer-drawing⣿layerId⣿points)
				else if (type === "layer-drawing" && parts.length === 3) {
					// Hide all entities of this type within the layer
					self.hideAllChildren(nodeId);
					// Also set visibility on each entity
					var layerId = parts[1];
					var entityTypeFolder = parts[2]; // "points", "lines", "polygons", "circles", "texts"
					if (typeof window.setLayerEntityTypeVisibility === "function") {
						window.setLayerEntityTypeVisibility(layerId, entityTypeFolder, false);
					}
				}
				// Step 3) Handle surface layer nodes (hide all surfaces in layer)
				else if (type === "layer-surface" && parts.length === 2) {
					var layerId = parts[1];
					if (typeof window.setLayerVisibility === "function") {
						window.setLayerVisibility(layerId, "surface", false);
					}
					self.hideAllChildren(nodeId);
				}
				// Step 4) Handle individual KAD entities (points⣿name, line⣿name, etc.)
				else if (type === "points" || type === "line" || type === "poly" || type === "circle" || type === "text") {
					if (typeof window.setKADEntityVisibility === "function") {
						window.setKADEntityVisibility(itemId, false);
					}
				}
				// Step 5) Handle individual surfaces (surface⣿surfaceId)
				else if (type === "surface") {
					if (typeof window.setSurfaceVisibility === "function") {
						window.setSurfaceVisibility(itemId, false);
					}
				}
				// Step 6) Handle other items via generic handler
				else if (typeof window.handleTreeViewVisibility === "function") {
					window.handleTreeViewVisibility(nodeId, type, itemId, false);
				}
			}
		});

		this.clearSelection();
		if (typeof window.updateTreeViewVisibilityStates === "function") {
			window.updateTreeViewVisibilityStates();
		}
		// Redraw to reflect visibility changes
		if (typeof window.drawData === "function") {
			if (typeof window.redraw3D === "function") { window.redraw3D(); } else { window.drawData(window.allBlastHoles, window.selectedHole); }
		}
	}

	showSelected() {
		var self = this;
		this.selectedNodes.forEach(function (nodeId) {
			var element = self.container.querySelector("[data-node-id=\"" + nodeId + "\"]");
			if (element) {
				element.style.opacity = "1";
				element.classList.remove("hidden-node");

				// Step 0) Cascade show visual state to all child tree-items in the DOM
				var parentLi = element.closest(".tree-node");
				if (parentLi) {
					var childItems = parentLi.querySelectorAll(".tree-item");
					childItems.forEach(function (child) {
						if (child !== element) {
							child.style.opacity = "1";
							child.classList.remove("hidden-node");
						}
					});
				}

				var parts = nodeId.split("⣿");
				var type = parts[0];
				var itemId = parts.slice(1).join("⣿");

				// Step 1) Handle top-level nodes (show all children)
				if (nodeId === "blast" || nodeId === "drawings" || nodeId === "surfaces" || nodeId === "images") {
					self.showAllChildren(nodeId);
				}
				// Step 2) Handle drawing layer nodes (show all entities in layer)
				else if (type === "layer-drawing" && parts.length === 2) {
					var layerId = parts[1];
					if (typeof window.setLayerVisibility === "function") {
						window.setLayerVisibility(layerId, "drawing", true);
					}
					self.showAllChildren(nodeId);
				}
				// Step 2a) Handle drawing layer entity-type folders (e.g., layer-drawing⣿layerId⣿points)
				else if (type === "layer-drawing" && parts.length === 3) {
					// Show all entities of this type within the layer
					self.showAllChildren(nodeId);
					// Also set visibility on each entity
					var layerId = parts[1];
					var entityTypeFolder = parts[2]; // "points", "lines", "polygons", "circles", "texts"
					if (typeof window.setLayerEntityTypeVisibility === "function") {
						window.setLayerEntityTypeVisibility(layerId, entityTypeFolder, true);
					}
				}
				// Step 3) Handle surface layer nodes (show all surfaces in layer)
				else if (type === "layer-surface" && parts.length === 2) {
					var layerId = parts[1];
					if (typeof window.setLayerVisibility === "function") {
						window.setLayerVisibility(layerId, "surface", true);
					}
					self.showAllChildren(nodeId);
				}
				// Step 4) Handle individual KAD entities (points⣿name, line⣿name, etc.)
				else if (type === "points" || type === "line" || type === "poly" || type === "circle" || type === "text") {
					if (typeof window.setKADEntityVisibility === "function") {
						window.setKADEntityVisibility(itemId, true);
					}
				}
				// Step 5) Handle individual surfaces (surface⣿surfaceId)
				else if (type === "surface") {
					if (typeof window.setSurfaceVisibility === "function") {
						window.setSurfaceVisibility(itemId, true);
					}
				}
				// Step 6) Handle other items via generic handler
				else if (typeof window.handleTreeViewVisibility === "function") {
					window.handleTreeViewVisibility(nodeId, type, itemId, true);
				}
			}
		});

		this.clearSelection();
		if (typeof window.updateTreeViewVisibilityStates === "function") {
			window.updateTreeViewVisibilityStates();
		}
		// Redraw to reflect visibility changes
		if (typeof window.drawData === "function") {
			if (typeof window.redraw3D === "function") { window.redraw3D(); } else { window.drawData(window.allBlastHoles, window.selectedHole); }
		}
	}

	// Step 4) Add helper methods to hide/show all children recursively
	hideAllChildren(parentNodeId) {
		if (parentNodeId === "blast") {
			// Hide all blast entities and holes
			if (window.allBlastHoles) {
				window.allBlastHoles.forEach((hole) => {
					hole.visible = false;
				});
				if (typeof window.debouncedSaveHoles === "function") {
					window.debouncedSaveHoles();
				}
			}
			if (typeof window.setBlastGroupVisibility === "function") {
				window.setBlastGroupVisibility(false);
			}
		} else if (parentNodeId === "drawings") {
			// Hide all KAD entities
			if (window.allKADDrawingsMap) {
				for (const [entityName, entity] of window.allKADDrawingsMap.entries()) {
					entity.visible = false;
				}
				if (typeof window.debouncedSaveKAD === "function") {
					window.debouncedSaveKAD();
				}
			}
			if (typeof window.setDrawingsGroupVisibility === "function") {
				window.setDrawingsGroupVisibility(false);
			}
		} else if (parentNodeId === "surfaces") {
			// Hide all surfaces
			if (window.loadedSurfaces) {
				for (const [surfaceId, surface] of window.loadedSurfaces.entries()) {
					surface.visible = false;
				}
				if (typeof window.debouncedSaveSurfaces === "function") {
					window.debouncedSaveSurfaces();
				}
			}
			if (typeof window.setSurfacesGroupVisibility === "function") {
				window.setSurfacesGroupVisibility(false);
			}
		} else if (parentNodeId === "images") {
			// Hide all images
			if (window.loadedImages) {
				for (const [imageId, image] of window.loadedImages.entries()) {
					image.visible = false;
				}
				if (typeof window.debouncedSaveImages === "function") {
					window.debouncedSaveImages();
				}
			}
			if (typeof window.setImagesGroupVisibility === "function") {
				window.setImagesGroupVisibility(false);
			}
		} else if (parentNodeId === "drawings⣿points") {
			// Hide all point entities
			if (window.allKADDrawingsMap) {
				for (const [entityName, entity] of window.allKADDrawingsMap.entries()) {
					if (entity.entityType === "point") {
						entity.visible = false;
					}
				}
				if (typeof window.debouncedSaveKAD === "function") {
					window.debouncedSaveKAD();
				}
			}
			if (typeof window.setPointsGroupVisibility === "function") {
				window.setPointsGroupVisibility(false);
			}
		} else if (parentNodeId === "drawings⣿lines") {
			if (window.allKADDrawingsMap) {
				for (const [entityName, entity] of window.allKADDrawingsMap.entries()) {
					if (entity.entityType === "line") {
						entity.visible = false;
					}
				}
				if (typeof window.debouncedSaveKAD === "function") {
					window.debouncedSaveKAD();
				}
			}
			if (typeof window.setLinesGroupVisibility === "function") {
				window.setLinesGroupVisibility(false);
			}
		} else if (parentNodeId === "drawings⣿polygons") {
			if (window.allKADDrawingsMap) {
				for (const [entityName, entity] of window.allKADDrawingsMap.entries()) {
					if (entity.entityType === "poly") {
						entity.visible = false;
					}
				}
				if (typeof window.debouncedSaveKAD === "function") {
					window.debouncedSaveKAD();
				}
			}
			if (typeof window.setPolygonsGroupVisibility === "function") {
				window.setPolygonsGroupVisibility(false);
			}
		} else if (parentNodeId === "drawings⣿circles") {
			if (window.allKADDrawingsMap) {
				for (const [entityName, entity] of window.allKADDrawingsMap.entries()) {
					if (entity.entityType === "circle") {
						entity.visible = false;
					}
				}
				if (typeof window.debouncedSaveKAD === "function") {
					window.debouncedSaveKAD();
				}
			}
			if (typeof window.setCirclesGroupVisibility === "function") {
				window.setCirclesGroupVisibility(false);
			}
		} else if (parentNodeId === "drawings⣿texts") {
			if (window.allKADDrawingsMap) {
				for (const [entityName, entity] of window.allKADDrawingsMap.entries()) {
					if (entity.entityType === "text") {
						entity.visible = false;
					}
				}
				if (typeof window.debouncedSaveKAD === "function") {
					window.debouncedSaveKAD();
				}
			}
			if (typeof window.setTextsGroupVisibility === "function") {
				window.setTextsGroupVisibility(false);
			}
		}
		// Step 27a) Handle layer-based node IDs for hiding
		else if (parentNodeId.startsWith("layer-drawing⣿")) {
			var parts = parentNodeId.split("⣿");
			var layerId = parts[1];
			if (parts.length === 2) {
				// Hide entire drawing layer - handled by setLayerVisibility
				if (typeof window.setLayerVisibility === "function") {
					window.setLayerVisibility(layerId, "drawing", false);
				}
			} else if (parts.length === 3) {
				// Hide entity type folder within layer
				if (typeof window.setLayerEntityTypeVisibility === "function") {
					window.setLayerEntityTypeVisibility(layerId, parts[2], false);
				}
			}
		}
		else if (parentNodeId.startsWith("layer-surface⣿")) {
			var parts = parentNodeId.split("⣿");
			var layerId = parts[1];
			// Hide entire surface layer
			if (typeof window.setLayerVisibility === "function") {
				window.setLayerVisibility(layerId, "surface", false);
			}
		}
	}

	showAllChildren(parentNodeId) {
		if (parentNodeId === "blast") {
			// Show all blast entities and holes
			if (window.allBlastHoles) {
				window.allBlastHoles.forEach((hole) => {
					hole.visible = true;
				});
				if (typeof window.debouncedSaveHoles === "function") {
					window.debouncedSaveHoles();
				}
			}
			if (typeof window.setBlastGroupVisibility === "function") {
				window.setBlastGroupVisibility(true);
			}
		} else if (parentNodeId === "drawings") {
			// Show all KAD entities
			if (window.allKADDrawingsMap) {
				for (const [entityName, entity] of window.allKADDrawingsMap.entries()) {
					entity.visible = true;
				}
				if (typeof window.debouncedSaveKAD === "function") {
					window.debouncedSaveKAD();
				}
			}
			if (typeof window.setDrawingsGroupVisibility === "function") {
				window.setDrawingsGroupVisibility(true);
			}
		} else if (parentNodeId === "surfaces") {
			// Show all surfaces
			if (window.loadedSurfaces) {
				for (const [surfaceId, surface] of window.loadedSurfaces.entries()) {
					surface.visible = true;
				}
				if (typeof window.debouncedSaveSurfaces === "function") {
					window.debouncedSaveSurfaces();
				}
			}
			if (typeof window.setSurfacesGroupVisibility === "function") {
				window.setSurfacesGroupVisibility(true);
			}
		} else if (parentNodeId === "images") {
			// Show all images
			if (window.loadedImages) {
				for (const [imageId, image] of window.loadedImages.entries()) {
					image.visible = true;
				}
				if (typeof window.debouncedSaveImages === "function") {
					window.debouncedSaveImages();
				}
			}
			if (typeof window.setImagesGroupVisibility === "function") {
				window.setImagesGroupVisibility(true);
			}
		} else if (parentNodeId === "drawings⣿points") {
			// Show all point entities
			if (window.allKADDrawingsMap) {
				for (const [entityName, entity] of window.allKADDrawingsMap.entries()) {
					if (entity.entityType === "point") {
						entity.visible = true;
					}
				}
				if (typeof window.debouncedSaveKAD === "function") {
					window.debouncedSaveKAD();
				}
			}
			if (typeof window.setPointsGroupVisibility === "function") {
				window.setPointsGroupVisibility(true);
			}
		} else if (parentNodeId === "drawings⣿lines") {
			if (window.allKADDrawingsMap) {
				for (const [entityName, entity] of window.allKADDrawingsMap.entries()) {
					if (entity.entityType === "line") {
						entity.visible = true;
					}
				}
				if (typeof window.debouncedSaveKAD === "function") {
					window.debouncedSaveKAD();
				}
			}
			if (typeof window.setLinesGroupVisibility === "function") {
				window.setLinesGroupVisibility(true);
			}
		} else if (parentNodeId === "drawings⣿polygons") {
			if (window.allKADDrawingsMap) {
				for (const [entityName, entity] of window.allKADDrawingsMap.entries()) {
					if (entity.entityType === "poly") {
						entity.visible = true;
					}
				}
				if (typeof window.debouncedSaveKAD === "function") {
					window.debouncedSaveKAD();
				}
			}
			if (typeof window.setPolygonsGroupVisibility === "function") {
				window.setPolygonsGroupVisibility(true);
			}
		} else if (parentNodeId === "drawings⣿circles") {
			if (window.allKADDrawingsMap) {
				for (const [entityName, entity] of window.allKADDrawingsMap.entries()) {
					if (entity.entityType === "circle") {
						entity.visible = true;
					}
				}
				if (typeof window.debouncedSaveKAD === "function") {
					window.debouncedSaveKAD();
				}
			}
			if (typeof window.setCirclesGroupVisibility === "function") {
				window.setCirclesGroupVisibility(true);
			}
		} else if (parentNodeId === "drawings⣿texts") {
			if (window.allKADDrawingsMap) {
				for (const [entityName, entity] of window.allKADDrawingsMap.entries()) {
					if (entity.entityType === "text") {
						entity.visible = true;
					}
				}
				if (typeof window.debouncedSaveKAD === "function") {
					window.debouncedSaveKAD();
				}
			}
			if (typeof window.setTextsGroupVisibility === "function") {
				window.setTextsGroupVisibility(true);
			}
		}
		// Step 27b) Handle layer-based node IDs for showing
		else if (parentNodeId.startsWith("layer-drawing⣿")) {
			var parts = parentNodeId.split("⣿");
			var layerId = parts[1];
			if (parts.length === 2) {
				// Show entire drawing layer - handled by setLayerVisibility
				if (typeof window.setLayerVisibility === "function") {
					window.setLayerVisibility(layerId, "drawing", true);
				}
			} else if (parts.length === 3) {
				// Show entity type folder within layer
				if (typeof window.setLayerEntityTypeVisibility === "function") {
					window.setLayerEntityTypeVisibility(layerId, parts[2], true);
				}
			}
		}
		else if (parentNodeId.startsWith("layer-surface⣿")) {
			var parts = parentNodeId.split("⣿");
			var layerId = parts[1];
			// Show entire surface layer
			if (typeof window.setLayerVisibility === "function") {
				window.setLayerVisibility(layerId, "surface", true);
			}
		}
	}

	showProperties() {
		if (this.selectedNodes.size === 1) {
			// Single selection - use existing handler
			const nodeId = Array.from(this.selectedNodes)[0];
			const type = nodeId.split("⣿")[0];

			if (typeof window.handleTreeViewShowProperties === "function") {
				window.handleTreeViewShowProperties(nodeId, type);
			}
		} else if (this.selectedNodes.size > 1) {
			// Multiple selection - check if all are KAD entities/chunks/elements
			const selectedNodeIds = Array.from(this.selectedNodes);

			// Check if all selected nodes are KAD-related (entities, chunks, or elements)
			const allKAD = selectedNodeIds.every((nodeId) => {
				const parts = nodeId.split("⣿");
				return (parts[0] === "line" || parts[0] === "poly" || parts[0] === "points" ||
					parts[0] === "circle" || parts[0] === "text");
			});

			if (allKAD && window.selectedMultipleKADObjects && window.selectedMultipleKADObjects.length > 1) {
				// Show multiple KAD property editor
				if (typeof window.showMultipleKADPropertyEditor === "function") {
					window.showMultipleKADPropertyEditor(window.selectedMultipleKADObjects);
				}
			}
		}
	}

	handleKeyboard(e) {
		// Guard: skip if tree panel is hidden
		if (this.container.style.display === "none") return;

		// Guard: skip if a dialog is open (e.g. rename dialog — pressing Delete
		// in the input field must NOT trigger surface deletion)
		if (typeof window.isAnyDialogOpen === "function" && window.isAnyDialogOpen()) return;

		// Guard: skip if focus is inside an input/textarea (e.g. search box)
		var tag = document.activeElement ? document.activeElement.tagName : "";
		if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

		switch (e.key) {
			case "Delete":
				this.deleteSelected();
				break;
			case "Escape":
				this.clearSelection();
				break;
		}
	}

	updateTreeData() {
		var treePanel = document.getElementById("treePanel");
		var isPanelVisible = treePanel && treePanel.style.display !== "none";

		// Prevent concurrent updates
		if (this._isUpdating) {
			this._pendingUpdate = true;
			return;
		}

		// PERFORMANCE FIX 2025-12-28: Clear loaded chunks on tree rebuild
		this.loadedChunks.clear();

		// FIX: Always build tree data in background (even when panel hidden)
		// This ensures tree is cached and ready when user opens panel
		this.buildTreeDataAsync(isPanelVisible);
	}

	// PERFORMANCE FIX 2025-12-28: Async tree building with batching
	// FIX: Accept isPanelVisible parameter to control rendering
	async buildTreeDataAsync(isPanelVisible = true) {
		this._isUpdating = true;
		var startTime = Date.now();

		try {
			// Build in stages with yields
			var blastData = this.buildBlastData();
			await this.yieldToUI();

			var drawingData = this.buildDrawingData();

			await this.yieldToUI();

			var surfaceData = this.buildSurfaceData();
			var imageData = this.buildImageData();

			// Store tree data in cache even if panel is hidden
			this._cachedTreeData = {
				blastData: blastData,
				drawingData: drawingData,
				surfaceData: surfaceData,
				imageData: imageData
			};

			var tree = [
				{ id: "blast", type: "blast", label: "Blast", expanded: true, children: blastData },
				{ id: "drawings", type: "drawing", label: "Drawings", expanded: true, children: drawingData },
				{ id: "surfaces", type: "surface", label: "Surfaces", expanded: true, children: surfaceData },
				{ id: "images", type: "image", label: "Images", expanded: true, children: imageData }
			];

			await this.yieldToUI();

			// Only render HTML if panel is visible (or was just opened)
			if (isPanelVisible) {
				var html = this.renderTree(tree);
				var treeViewElement = document.getElementById("treeView");
				if (treeViewElement) {
					treeViewElement.innerHTML = html;
				}
			}

			var elapsed = Date.now() - startTime;
			if (elapsed > 100) {
				console.log("🌲 TreeView built in " + elapsed + "ms");
			}
		} finally {
			this._isUpdating = false;

			// Handle pending update if any
			if (this._pendingUpdate) {
				this._pendingUpdate = false;
				setTimeout(() => this.updateTreeData(), 100);
			}
		}
	}

	// Helper to yield to UI thread
	yieldToUI() {
		return new Promise(function (resolve) { setTimeout(resolve, 0); });
	}

	buildTreeData() {
		const tree = [
			{
				id: "blast",
				type: "blast",
				label: "Blast",
				expanded: true,
				children: this.buildBlastData(),
			},
			{
				id: "drawings",
				type: "drawing",
				label: "Drawings",
				expanded: true,
				children: this.buildDrawingData(),
			},
			{
				id: "surfaces",
				type: "surface",
				label: "Surfaces",
				expanded: true,
				children: this.buildSurfaceData(),
			},
			{
				id: "images",
				type: "image",
				label: "Images",
				expanded: true,
				children: this.buildImageData(),
			},
		];

		return tree;
	}

	buildBlastData() {
		if (!window.allBlastHoles || window.allBlastHoles.length === 0) return [];

		const entities = {};
		window.allBlastHoles.forEach((hole) => {
			const entityName = hole.entityName || "Unknown";
			if (!entities[entityName]) {
				entities[entityName] = [];
			}
			entities[entityName].push(hole);
		});

		return Object.keys(entities).map((entityName) => {
			const holes = entities[entityName];

			holes.sort((a, b) => {
				const aRow = a.rowID && a.rowID > 0 ? a.rowID : 999999;
				const bRow = b.rowID && b.rowID > 0 ? b.rowID : 999999;

				if (aRow !== bRow) {
					return aRow - bRow;
				}

				const aPos = a.posID && a.posID > 0 ? a.posID : 999999;
				const bPos = b.posID && b.posID > 0 ? b.posID : 999999;

				return aPos - bPos;
			});

			const totalLength = holes.reduce((sum, hole) => sum + (hole.holeLengthCalculated || 0), 0);
			// Step 1305) Use new donut-aware volume calculation with caching
			var volume = 0;
			if (typeof window.getBlastEntityVolume === "function") {
				volume = window.getBlastEntityVolume(holes, entityName);
			} else {
				console.warn("📊 [TreeView] getBlastEntityVolume not available yet for entity: " + entityName);
			}

			return {
				id: "entity⣿" + entityName,
				type: "entity",
				label: entityName,
				meta: "(" + holes.length + ", " + parseFloat(totalLength).toFixed(1) + "m, " + parseFloat(volume).toFixed(1) + "m³)",
				// BUG FIX 2025-12-28: Wrap all numeric properties with parseFloat() to handle string values
				children: holes.map((hole, index) => ({
					id: "hole⣿" + entityName + "⣿" + (hole.holeID || index),
					type: "hole",
					label: hole.holeID || "Hole " + (index + 1),
					meta: "L:" + parseFloat(hole.holeLengthCalculated || 0).toFixed(2) + "m, S:" + parseFloat(hole.subdrillAmount || 0).toFixed(2) + "m, R:" + (hole.rowID || 0) + ", P:" + (hole.posID || 0),
					children: [
						{
							id: (hole.holeID || index) + "⣿startx",
							type: "property",
							label: "Start X",
							meta: parseFloat(hole.startXLocation || 0).toFixed(3),
						},
						{
							id: (hole.holeID || index) + "⣿starty",
							type: "property",
							label: "Start Y",
							meta: parseFloat(hole.startYLocation || 0).toFixed(3),
						},
						{
							id: (hole.holeID || index) + "⣿startz",
							type: "property",
							label: "Start Z",
							meta: parseFloat(hole.startZLocation || 0).toFixed(3),
						},
						{
							id: (hole.holeID || index) + "⣿gradez",
							type: "property",
							label: "Grade Z",
							meta: parseFloat(hole.gradeZLocation || 0).toFixed(3),
						},
						{
							id: (hole.holeID || index) + "⣿diameter",
							type: "property",
							label: "Diameter",
							meta: parseFloat(hole.holeDiameter || 115) + "mm",
						},
						{
							id: (hole.holeID || index) + "⣿angle",
							type: "property",
							label: "Angle",
							meta: parseFloat(hole.holeAngle || 0).toFixed(0) + "°",
						},
						{
							id: (hole.holeID || index) + "⣿bearing",
							type: "property",
							label: "Bearing",
							meta: parseFloat(hole.holeBearing || 0).toFixed(2) + "°",
						},
						{
							id: (hole.holeID || index) + "⣿length",
							type: "property",
							label: "Length",
							meta: parseFloat(hole.holeLengthCalculated || 0).toFixed(2) + "m",
						},
						{
							id: (hole.holeID || index) + "⣿subdrill",
							type: "property",
							label: "Subdrill",
							meta: parseFloat(hole.subdrillAmount || 0).toFixed(2) + "m",
						},
						{
							id: (hole.holeID || index) + "⣿type",
							type: "property",
							label: "Hole Type",
							meta: hole.holeType || "Undefined",
						},
						{
							id: (hole.holeID || index) + "⣿burden",
							type: "property",
							label: "Burden",
							meta: hole.burden || 0,
						},
						{
							id: (hole.holeID || index) + "⣿spacing",
							type: "property",
							label: "Spacing",
							meta: hole.spacing || 0,
						},
						{
							id: (hole.holeID || index) + "⣿rowid",
							type: "property",
							label: "Row ID",
							meta: hole.rowID || 0,
						},
						{
							id: (hole.holeID || index) + "⣿posid",
							type: "property",
							label: "Position ID",
							meta: hole.posID || 0,
						},
					],
				})),
			};
		});
	}

	buildDrawingData() {
		var drawingChildren = [];

		// Step 1) Layer System 2026-01-16: Organize by layers, then by entity type within each layer
		// Structure: Drawings -> Layer -> EntityType -> Entities

		if (typeof window.allKADDrawingsMap === "undefined" || !window.allKADDrawingsMap || window.allKADDrawingsMap.size === 0) {
			return drawingChildren;
		}

		// Step 2) Build a map of layerId -> entities grouped by type
		var layerEntityMap = new Map(); // layerId -> { points: [], lines: [], polys: [], circles: [], texts: [] }
		var defaultLayerId = window.DEFAULT_DRAWING_LAYER_ID || "layer_default_drawings";

		for (var entry of window.allKADDrawingsMap.entries()) {
			var entityName = entry[0];
			var entity = entry[1];
			var layerId = entity.layerId || defaultLayerId;
			var entityType = entity.entityType;
			var pointCount = entity.data ? entity.data.length : 0;

			// Step 2a) Initialize layer bucket if not exists
			if (!layerEntityMap.has(layerId)) {
				layerEntityMap.set(layerId, {
					points: [],
					lines: [],
					polys: [],
					circles: [],
					texts: []
				});
			}

			var layerBucket = layerEntityMap.get(layerId);
			// Get entity visibility
			var entityVisible = entity.visible !== false;

			// Step 2b) Create entity node and add to appropriate type bucket
			var nodeId, nodeType;
			switch (entityType) {
				case "point":
					nodeId = "points⣿" + entityName;
					nodeType = "points-leaf";
					layerBucket.points.push({ id: nodeId, type: nodeType, label: entityName, meta: formatEntityStatistics("point", entity.data), visible: entityVisible, children: [] });
					break;
				case "line":
					nodeId = "line⣿" + entityName;
					nodeType = "line-leaf";
					layerBucket.lines.push({ id: nodeId, type: nodeType, label: entityName, meta: formatEntityStatistics("line", entity.data), visible: entityVisible, children: [] });
					break;
				case "poly":
					nodeId = "poly⣿" + entityName;
					nodeType = "polygon-leaf";
					layerBucket.polys.push({ id: nodeId, type: nodeType, label: entityName, meta: formatEntityStatistics("poly", entity.data), visible: entityVisible, children: [] });
					break;
				case "circle":
					nodeId = "circle⣿" + entityName;
					nodeType = "circle-leaf";
					layerBucket.circles.push({ id: nodeId, type: nodeType, label: entityName, meta: formatEntityStatistics("circle", entity.data), visible: entityVisible, children: [] });
					break;
				case "text":
					nodeId = "text⣿" + entityName;
					nodeType = "text-leaf";
					layerBucket.texts.push({ id: nodeId, type: nodeType, label: entityName, meta: formatEntityStatistics("text", entity.data), visible: entityVisible, children: [] });
					break;
			}
		}

		// Step 3) Build layer nodes from allDrawingLayers or from layerEntityMap keys
		var layerIds = new Set(layerEntityMap.keys());

		// Also include layers from allDrawingLayers that may be empty
		if (window.allDrawingLayers) {
			for (var lid of window.allDrawingLayers.keys()) {
				layerIds.add(lid);
			}
		}

		// Step 4) Create layer nodes
		for (var layerId of layerIds) {
			var layer = window.allDrawingLayers ? window.allDrawingLayers.get(layerId) : null;
			var layerName = layer ? layer.layerName : (layerId === defaultLayerId ? "Default Layer" : layerId);
			var layerVisible = layer ? layer.visible !== false : true;
			var layerBucket = layerEntityMap.get(layerId) || { points: [], lines: [], polys: [], circles: [], texts: [] };

			// Step 4a) Build entity type folders within this layer
			var layerChildren = [];
			var totalEntities = 0;

			if (layerBucket.points.length > 0) {
				totalEntities += layerBucket.points.length;
				layerChildren.push({
					id: "layer-drawing⣿" + layerId + "⣿points",
					type: "points-folder",
					label: "Points",
					meta: "(" + layerBucket.points.length + ")",
					children: layerBucket.points
				});
			}

			if (layerBucket.lines.length > 0) {
				totalEntities += layerBucket.lines.length;
				layerChildren.push({
					id: "layer-drawing⣿" + layerId + "⣿lines",
					type: "lines-folder",
					label: "Lines",
					meta: "(" + layerBucket.lines.length + ")",
					children: layerBucket.lines
				});
			}

			if (layerBucket.polys.length > 0) {
				totalEntities += layerBucket.polys.length;
				layerChildren.push({
					id: "layer-drawing⣿" + layerId + "⣿polygons",
					type: "polygons-folder",
					label: "Polygons",
					meta: "(" + layerBucket.polys.length + ")",
					children: layerBucket.polys
				});
			}

			if (layerBucket.circles.length > 0) {
				totalEntities += layerBucket.circles.length;
				layerChildren.push({
					id: "layer-drawing⣿" + layerId + "⣿circles",
					type: "circle-folder",
					label: "Circles",
					meta: "(" + layerBucket.circles.length + ")",
					children: layerBucket.circles
				});
			}

			if (layerBucket.texts.length > 0) {
				totalEntities += layerBucket.texts.length;
				layerChildren.push({
					id: "layer-drawing⣿" + layerId + "⣿texts",
					type: "text-folder",
					label: "Texts",
					meta: "(" + layerBucket.texts.length + ")",
					children: layerBucket.texts
				});
			}

			// Step 4b) Create layer node
			drawingChildren.push({
				id: "layer-drawing⣿" + layerId,
				type: "layer-drawing",
				label: layerName,
				meta: "(" + totalEntities + " entities)",
				visible: layerVisible,
				children: layerChildren
			});
		}

		return drawingChildren;
	}

	buildSurfaceData() {
		var surfaceChildren = [];
		var defaultLayerId = window.DEFAULT_SURFACE_LAYER_ID || "layer_default_surfaces";

		// Step 1) Layer System 2026-01-16: Organize surfaces by layers
		if (!window.loadedSurfaces || window.loadedSurfaces.size === 0) {
			return surfaceChildren;
		}

		// Step 2) Build a map of layerId -> surfaces
		var layerSurfaceMap = new Map(); // layerId -> [surfaces]

		window.loadedSurfaces.forEach(function (surface, surfaceId) {
			var layerId = surface.layerId || defaultLayerId;
			var surfaceVisible = surface.visible !== false;

			// Step 28b) Determine surface icon type based on open/closed state
			var isClosed = typeof window.isSurfaceClosed === "function" && window.isSurfaceClosed(surface);
			var surfaceType = isClosed ? "surface-closed" : "surface-open";

			if (!layerSurfaceMap.has(layerId)) {
				layerSurfaceMap.set(layerId, []);
			}

			// Build stats string: [SOLID/OPEN] (#pts, #tris, volume or footprint area)
			var ptCount = surface.points ? surface.points.length : 0;
			var triCount = surface.triangles ? surface.triangles.length : 0;
			var typeLabel = isClosed ? "SOLID" : "OPEN";
			var statExtra = "";
			var normalsOk = true;
			if (isClosed) {
				var volResult = computeMeshVolume(surface);
				statExtra = ", " + formatNumber(Math.abs(volResult.volume)) + " m\u00B3";
				normalsOk = volResult.normalsConsistent;
			} else {
				var area = computeFootprintArea(surface);
				if (area > 0) {
					statExtra = ", " + formatNumber(area) + " m\u00B2";
				}
			}
			var meta = "[" + typeLabel + "] (" + ptCount + " pts, " + triCount + " tris" + statExtra + ")";

			// Step 28c) Append warning badge for closed solids with inconsistent normals
			var warnHtml = "";
			if (isClosed && !normalsOk) {
				warnHtml = "<span class=\"tree-normal-warn\" title=\"Mixed normals - volume may be inaccurate\">&#9888;</span>";
			}

			layerSurfaceMap.get(layerId).push({
				id: "surface" + TREE_NODE_SEPARATOR + surfaceId,
				type: surfaceType,
				label: surface.name,
				meta: meta,
				warnHtml: warnHtml,
				visible: surfaceVisible,
				surfaceId: surfaceId
			});
		});

		// Step 3) Build layer nodes from allSurfaceLayers or from layerSurfaceMap keys
		var layerIds = new Set(layerSurfaceMap.keys());

		// Also include layers from allSurfaceLayers that may be empty
		if (window.allSurfaceLayers) {
			for (var lid of window.allSurfaceLayers.keys()) {
				layerIds.add(lid);
			}
		}

		// Step 4) Create layer nodes
		for (var layerId of layerIds) {
			var layer = window.allSurfaceLayers ? window.allSurfaceLayers.get(layerId) : null;
			var layerName = layer ? layer.layerName : (layerId === defaultLayerId ? "Default Layer" : layerId);
			var layerVisible = layer ? layer.visible !== false : true;
			var layerSurfaces = layerSurfaceMap.get(layerId) || [];

			// Step 4b) Propagate warning to layer if any child solid has inconsistent normals
			var layerWarnHtml = "";
			for (var si = 0; si < layerSurfaces.length; si++) {
				if (layerSurfaces[si].warnHtml) {
					layerWarnHtml = "<span class=\"tree-normal-warn\" title=\"One or more solids have mixed normals\">&#9888;</span>";
					break;
				}
			}

			surfaceChildren.push({
				id: "layer-surface" + TREE_NODE_SEPARATOR + layerId,
				type: "layer-surface",
				label: layerName,
				meta: "(" + layerSurfaces.length + " surfaces)",
				warnHtml: layerWarnHtml,
				visible: layerVisible,
				children: layerSurfaces
			});
		}

		return surfaceChildren;
	}

	buildImageData() {
		const imageChildren = [];

		if (window.loadedImages) {
			window.loadedImages.forEach((image, imageId) => {
				imageChildren.push({
					id: "image⣿" + imageId,
					type: "image",
					label: image.name,
					meta: image.size ? (image.size / (1024 * 1024)).toFixed(2) + " MB" : "Unknown size",
				});
			});
		}

		return imageChildren;
	}

	renderTree(nodes, level = 0) {
		return nodes
			.map((node) => {
				// Step 1) Check if node has children OR is an entity node that can be lazy-loaded
				var hasChildren = node.children && node.children.length > 0;
				// Entity nodes with empty children arrays should still show expand button for lazy loading
				var isEntityNode = (node.id && (node.id.startsWith("line⣿") || node.id.startsWith("poly⣿") ||
					node.id.startsWith("points⣿") || node.id.startsWith("circle⣿") || node.id.startsWith("text⣿")) &&
					node.id.split("⣿").length === 2);
				var isChunkNode = node.type === "point-chunk" || (node.id && node.id.includes("⣿chunk⣿"));
				var shouldShowExpand = hasChildren || isEntityNode || isChunkNode;

				const isExpanded = this.expandedNodes.has(node.id) || node.expanded;
				const isSelected = this.selectedNodes.has(node.id);

				// Step 20) Check if this is the active layer
				var isActiveLayer = false;
				if (node.id && node.id.startsWith("layer-drawing⣿")) {
					var layerId = node.id.split("⣿")[1];
					isActiveLayer = (layerId === window.activeDrawingLayerId);
				} else if (node.id && node.id.startsWith("layer-surface⣿")) {
					var layerId = node.id.split("⣿")[1];
					isActiveLayer = (layerId === window.activeSurfaceLayerId);
				}

				// Step 20a) Check visibility state for hidden-node class
				var isHidden = node.visible === false;

				let colorSwatchHtml = "";
				if (node.elementData && node.type.includes("⣿element")) {
					const color = node.elementData.color || "#777777";
					colorSwatchHtml = "<span class=\"color-swatch\" style=\"background-color: " + color + ";\" data-element-id=\"" + node.id + "\" data-entity-name=\"" + node.elementData.entityName + "\" data-point-id=\"" + node.elementData.pointID + "\"></span>";
				}

				// Step 20b) Build class list
				var itemClasses = "tree-item";
				if (isSelected) itemClasses += " selected";
				if (isActiveLayer) itemClasses += " active-layer";
				if (isHidden) itemClasses += " hidden-node";

				let html = "<li class=\"tree-node\"><div class=\"" + itemClasses + "\" data-node-id=\"" + node.id + "\"" + (isHidden ? " style=\"opacity: 0.5;\"" : "") + "><span class=\"tree-expand " + (shouldShowExpand ? (isExpanded ? "expanded" : "") : "leaf") + "\"></span><span class=\"tree-icon " + node.type + "\"></span>" + colorSwatchHtml + "<span class=\"tree-label\">" + node.label + "</span>" + (node.warnHtml || "") + (node.meta ? "<span class=\"tree-meta\">" + node.meta + "</span>" : "") + "</div>";

				// Step 2) Always create children container for entity nodes (even if empty) for lazy loading
				if (shouldShowExpand) {
					html += "<ul class=\"tree-children " + (isExpanded ? "expanded" : "") + "\">";
					if (hasChildren) {
						html += this.renderTree(node.children, level + 1);
					}
					html += "</ul>";
				}

				html += "</li>";
				return html;
			})
			.join("");
	}

	// Step 3) BUG FIX 4 & 5: Fix onSelectionChange to handle individual holes and KAD vertices
	onSelectionChange() {
		if (this.isSyncing) return;

		// Clear canvas selections
		if (window.selectedMultipleHoles) window.selectedMultipleHoles.length = 0;
		if (window.selectedMultipleKADObjects) window.selectedMultipleKADObjects.length = 0;
		if (window.selectedMultiplePoints) window.selectedMultiplePoints = [];
		if (window.selectedHole) window.selectedHole = null;
		if (window.selectedKADObject) window.selectedKADObject = null;
		if (window.selectedPoint) window.selectedPoint = null;

		this.selectedNodes.forEach((nodeId) => {
			const parts = nodeId.split("⣿");

			// BUG FIX 4: Correct hole node ID parsing
			// Node ID format: "hole⣿entityName⣿holeID" (3 parts)
			if (parts[0] === "hole" && parts.length === 3) {
				const entityName = parts[1]; // Extract entityName
				const holeID = parts[2]; // Extract holeID
				const hole = window.allBlastHoles.find((h) => h.entityName === entityName && h.holeID === holeID);
				if (hole && window.selectedMultipleHoles) window.selectedMultipleHoles.push(hole);
			} else if (parts[0] === "entity") {
				// Blast entities
				const entityName = parts.slice(1).join("⣿");
				window.allBlastHoles.forEach((hole) => {
					if (hole.entityName === entityName && window.selectedMultipleHoles) {
						window.selectedMultipleHoles.push(hole);
					}
				});
			} else if (parts.length >= 4 && parts[2] === "element") {
				// BUG FIX 5: KAD vertex selection - Individual element selection
				// Node ID format: "entityType⣿entityName⣿element⣿pointID" (4 parts)
				const entityType = parts[0];
				const entityName = parts[1];
				const elementId = parts[3];

				const entity = window.allKADDrawingsMap.get(entityName);
				if (entity) {
					const element = entity.data.find((el) => el.pointID == elementId);
					if (element && window.selectedMultipleKADObjects) {
						const elementIndex = entity.data.indexOf(element);
						window.selectedMultipleKADObjects.push({
							entityName: entityName,
							entityType: entityType,
							elementIndex: elementIndex,
							selectionType: "vertex",
							pointID: elementId // Add pointID for easier reference
						});
					}
				}
			} else if (parts.length === 4 && parts[2] === "chunk") {
				// Chunk selection - Select all points in the chunk range
				// Node ID format: "entityType⣿entityName⣿chunk⣿1-50" (4 parts)
				const entityType = parts[0];
				const entityName = parts[1];
				const rangeStr = parts[3]; // e.g., "1-50"
				const rangeParts = rangeStr.split("-");
				const startIndex = parseInt(rangeParts[0]) - 1; // Convert to 0-based index
				const endIndex = parseInt(rangeParts[1]) - 1; // Convert to 0-based index

				const entity = window.allKADDrawingsMap.get(entityName);
				if (entity && entity.data && window.selectedMultipleKADObjects) {
					// Add all points in the chunk range as vertex selections
					for (let i = startIndex; i <= endIndex && i < entity.data.length; i++) {
						const element = entity.data[i];
						if (element) {
							window.selectedMultipleKADObjects.push({
								entityName: entityName,
								entityType: entityType,
								elementIndex: i,
								selectionType: "vertex",
								pointID: element.pointID
							});
						}
					}
				}
			} else if (["points", "line", "poly", "circle", "text"].includes(parts[0])) {
				// KAD entity-level selection
				const entityType = parts[0];
				const entityName = parts.slice(1).join("⣿");
				const entity = window.allKADDrawingsMap.get(entityName);
				if (entity && window.selectedMultipleKADObjects) {
					window.selectedMultipleKADObjects.push({
						entityName: entityName,
						entityType: entityType,
						elementIndex: 0,
						selectionType: "entity",
					});
				}
			} else if (parts[0] === "surface" && parts.length === 2) {
				// Surface node selection — flash highlight in 3D view
				flashHighlight(parts[1]);
			}
		});

		// If single selection, set singular variables
		if (this.selectedNodes.size === 1) {
			if (window.selectedMultipleHoles && window.selectedMultipleHoles.length === 1) {
				window.selectedHole = window.selectedMultipleHoles[0];
			} else if (window.selectedMultipleKADObjects && window.selectedMultipleKADObjects.length === 1) {
				const kadObject = window.selectedMultipleKADObjects[0];
				let pointToSet = null;

				// CRITICAL: Set selectedPoint for vertex-level selections
				if (kadObject.selectionType === "vertex") {
					const entity = window.allKADDrawingsMap.get(kadObject.entityName);
					if (entity && entity.data && entity.data[kadObject.elementIndex]) {
						pointToSet = entity.data[kadObject.elementIndex];
						console.log("✅ [TreeView] Set selectedPoint for vertex selection:", pointToSet.pointID);
					}
				}

				// Use setter function to update kirra.js local variables
				if (typeof window.setSelectionFromTreeView === "function") {
					window.setSelectionFromTreeView({
						selectedKADObject: kadObject,
						selectedPoint: pointToSet
					});
				} else {
					// Fallback to direct window assignment (if setter not available)
					window.selectedKADObject = kadObject;
					window.selectedPoint = pointToSet;
				}
			}
		} else if (this.selectedNodes.size > 1) {
			// Multiple selection - check if all are vertices
			const allVertices = window.selectedMultipleKADObjects &&
				window.selectedMultipleKADObjects.every((obj) => obj.selectionType === "vertex");

			if (allVertices) {
				// Set selectedMultiplePoints for pink highlighting
				const multiplePoints = [];
				window.selectedMultipleKADObjects.forEach((kadObj) => {
					const entity = window.allKADDrawingsMap.get(kadObj.entityName);
					if (entity && entity.data && entity.data[kadObj.elementIndex]) {
						multiplePoints.push(entity.data[kadObj.elementIndex]);
					}
				});
				console.log("✅ [TreeView] Set selectedMultiplePoints:", multiplePoints.length, "vertices");

				// Use setter function
				if (typeof window.setSelectionFromTreeView === "function") {
					window.setSelectionFromTreeView({
						selectedMultiplePoints: multiplePoints
					});
				} else {
					window.selectedMultiplePoints = multiplePoints;
				}
			} else {
				if (typeof window.setSelectionFromTreeView === "function") {
					window.setSelectionFromTreeView({
						selectedMultiplePoints: []
					});
				} else {
					window.selectedMultiplePoints = [];
				}
			}
		}

		// VERIFICATION: Check if drawing conditions are met for vertex selection
		if (window.selectedKADObject && window.selectedKADObject.selectionType === "vertex") {
			console.log("🔍 [TreeView] Verification before drawData:");
			console.log("  selectedKADObject:", window.selectedKADObject);
			console.log("  selectedPoint:", window.selectedPoint);

			if (window.selectedPoint && window.selectedKADObject) {
				console.log("✅ [TreeView] BOTH CONDITIONS MET - Pink highlight should appear!");
			} else {
				console.error("❌ [TreeView] MISSING CONDITIONS - Pink highlight will NOT appear!");
				console.error("  selectedPoint:", window.selectedPoint ? "SET" : "NULL");
				console.error("  selectedKADObject:", window.selectedKADObject ? "SET" : "NULL");
			}
		}

		// PERFORMANCE FIX 2025-12-28: Warn about large selections from TreeView
		var LARGE_SELECTION_WARNING_THRESHOLD = 500;
		var totalKADSelected = window.selectedMultipleKADObjects ? window.selectedMultipleKADObjects.length : 0;
		var totalHolesSelected = window.selectedMultipleHoles ? window.selectedMultipleHoles.length : 0;
		var totalSelected = totalKADSelected + totalHolesSelected;

		if (totalSelected > LARGE_SELECTION_WARNING_THRESHOLD) {
			console.log("⚠️ [TreeView] Large selection: " + totalSelected + " items");
			if (typeof window.updateStatusMessage === "function") {
				window.updateStatusMessage("Large selection: " + totalSelected + " items (rendering may be limited)");
				setTimeout(function () { window.updateStatusMessage(""); }, 3000);
			}
		}

		// Redraw canvas
		if (typeof window.drawData === "function") {
			if (typeof window.redraw3D === "function") { window.redraw3D(); } else { window.drawData(window.allBlastHoles, window.selectedHole); }
		}
	}

	deleteNode(nodeId) {
		console.log("Delete node:", nodeId);
	}

	renameEntity() {
		// Step 947a) Support single selection rename
		if (this.selectedNodes.size === 1) {
			const nodeId = Array.from(this.selectedNodes)[0];
			if (typeof window.handleTreeViewRename === "function") {
				window.handleTreeViewRename(nodeId, this);
			}
			return;
		}

		// Step 947b) Support multiple hole selection rename (BlastName reassignment)
		if (this.selectedNodes.size > 1) {
			const nodeIds = Array.from(this.selectedNodes);
			const allAreHoles = nodeIds.every((id) => id.startsWith("hole⣿"));
			if (allAreHoles && typeof window.handleTreeViewRenameMultipleHoles === "function") {
				window.handleTreeViewRenameMultipleHoles(nodeIds, this);
			}
		}
	}

	// Step 947c) Assign Blast - collect selected holes and open the assign blast dialog
	assignBlast() {
		if (this.selectedNodes.size === 0) return;

		var nodeIds = Array.from(this.selectedNodes);
		var selectedHolesList = [];

		nodeIds.forEach(function (nodeId) {
			var parts = nodeId.split("⣿");

			// Handle individual hole nodes: "hole⣿entityName⣿holeID"
			if (parts[0] === "hole" && parts.length === 3) {
				var entityName = parts[1];
				var holeID = parts[2];
				var hole = window.allBlastHoles.find(function (h) {
					return h.entityName === entityName && h.holeID === holeID;
				});
				if (hole) selectedHolesList.push(hole);
			}
			// Handle entity nodes: "entity⣿entityName" (select all holes in entity)
			else if (parts[0] === "entity" && parts.length === 2) {
				var entityName = parts[1];
				window.allBlastHoles.forEach(function (h) {
					if (h.entityName === entityName) {
						selectedHolesList.push(h);
					}
				});
			}
		});

		if (selectedHolesList.length === 0) {
			if (typeof window.showModalMessage === "function") {
				window.showModalMessage("No Holes", "No blast holes found in the selection.", "warning");
			}
			return;
		}

		// Delegate to global assignBlastDialog
		if (typeof window.assignBlastDialog === "function") {
			window.assignBlastDialog(selectedHolesList);
		} else {
			console.error("assignBlastDialog function not found in window scope");
		}
	}

	moveToLayer() {
		if (this.selectedNodes.size === 0) return;

		var nodeIds = Array.from(this.selectedNodes);
		var surfaceIds = [];
		var drawingEntityNames = [];

		nodeIds.forEach(function (nodeId) {
			var parts = nodeId.split("⣿");

			// Surface nodes: "surface⣿surfaceId"
			if (parts[0] === "surface" && parts.length === 2) {
				surfaceIds.push(parts[1]);
			}
			// KAD entity nodes: "line⣿name", "poly⣿name", "points⣿name", "circle⣿name", "text⣿name"
			else if ((parts[0] === "line" || parts[0] === "poly" || parts[0] === "points" || parts[0] === "circle" || parts[0] === "text") && parts.length === 2) {
				drawingEntityNames.push(parts[1]);
			}
		});

		// Reject mixed selection
		if (surfaceIds.length > 0 && drawingEntityNames.length > 0) {
			if (typeof window.showModalMessage === "function") {
				window.showModalMessage("Mixed Selection", "Cannot move surfaces and drawings at the same time. Please select only one type.", "warning");
			}
			return;
		}

		if (surfaceIds.length > 0) {
			if (typeof window.moveToLayerDialog === "function") {
				window.moveToLayerDialog("surface", surfaceIds);
			} else {
				console.error("moveToLayerDialog function not found in window scope");
			}
		} else if (drawingEntityNames.length > 0) {
			if (typeof window.moveToLayerDialog === "function") {
				window.moveToLayerDialog("drawing", drawingEntityNames);
			} else {
				console.error("moveToLayerDialog function not found in window scope");
			}
		} else {
			if (typeof window.showModalMessage === "function") {
				window.showModalMessage("No Items", "No surfaces or drawing entities found in the selection.", "warning");
			}
		}
	}

	showNodeProperties(nodeId) {
		// Delegate to global function
		if (typeof window.handleTreeViewShowProperties === "function") {
			window.handleTreeViewShowProperties(nodeId);
		}
	}
}

// Export singleton instance
export function initializeTreeView(containerId) {
	const treeView = new TreeView(containerId);
	window.treeView = treeView;
	return treeView;
}

