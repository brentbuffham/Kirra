/**
 * UndoActions.js
 * Action classes for undo/redo operations on Holes and KAD entities
 * Author: AI Assistant
 * Created: 2026-01-22
 */

import { UndoableAction, ActionTypes } from "./UndoManager.js";

// ============================================================
// HOLE ACTIONS
// ============================================================

// Step 1) AddHoleAction - Undo: remove hole, Redo: add hole back
class AddHoleAction extends UndoableAction {
    constructor(holeData) {
        super(ActionTypes.ADD_HOLE, true, false);
        // Step 1a) Store a deep copy of the hole data
        this.holeData = JSON.parse(JSON.stringify(holeData));
        this.holeId = holeData.holeID;
        this.entityName = holeData.entityName;
        this.description = "Add hole " + (this.holeId || "");
    }
    
    execute() {
        // Step 1b) Add hole to allBlastHoles array
        if (window.allBlastHoles) {
            window.allBlastHoles.push(JSON.parse(JSON.stringify(this.holeData)));
        }
    }
    
    undo() {
        // Step 1c) Remove hole from allBlastHoles array
        if (window.allBlastHoles) {
            var index = window.allBlastHoles.findIndex(function(h) {
                return h.holeID === this.holeId && h.entityName === this.entityName;
            }.bind(this));
            if (index !== -1) {
                window.allBlastHoles.splice(index, 1);
            }
        }
    }
    
    redo() {
        this.execute();
    }
}

// Step 2) AddMultipleHolesAction - For adding multiple holes at once
class AddMultipleHolesAction extends UndoableAction {
    constructor(holesData) {
        super(ActionTypes.ADD_HOLE, true, false);
        // Step 2a) Store deep copies of all hole data
        this.holesData = holesData.map(function(h) {
            return JSON.parse(JSON.stringify(h));
        });
        this.description = "Add " + this.holesData.length + " holes";
    }
    
    execute() {
        // Step 2b) Add all holes to allBlastHoles array
        if (window.allBlastHoles) {
            for (var i = 0; i < this.holesData.length; i++) {
                window.allBlastHoles.push(JSON.parse(JSON.stringify(this.holesData[i])));
            }
        }
    }
    
    undo() {
        // Step 2c) Remove all holes from allBlastHoles array
        if (window.allBlastHoles) {
            for (var i = 0; i < this.holesData.length; i++) {
                var holeData = this.holesData[i];
                var index = window.allBlastHoles.findIndex(function(h) {
                    return h.holeID === holeData.holeID && h.entityName === holeData.entityName;
                });
                if (index !== -1) {
                    window.allBlastHoles.splice(index, 1);
                }
            }
        }
    }
    
    redo() {
        this.execute();
    }
}

// Step 3) DeleteHoleAction - Undo: restore hole, Redo: delete again
class DeleteHoleAction extends UndoableAction {
    constructor(holeData, originalIndex) {
        super(ActionTypes.DELETE_HOLE, true, false);
        // Step 3a) Store a deep copy of the hole data
        this.holeData = JSON.parse(JSON.stringify(holeData));
        this.originalIndex = originalIndex !== undefined ? originalIndex : -1;
        this.holeId = holeData.holeID;
        this.entityName = holeData.entityName;
        this.description = "Delete hole " + (this.holeId || "");
    }
    
    execute() {
        // Step 3b) Remove hole from allBlastHoles array
        if (window.allBlastHoles) {
            var index = window.allBlastHoles.findIndex(function(h) {
                return h.holeID === this.holeId && h.entityName === this.entityName;
            }.bind(this));
            if (index !== -1) {
                window.allBlastHoles.splice(index, 1);
            }
        }
    }
    
    undo() {
        // Step 3c) Restore hole to allBlastHoles array
        if (window.allBlastHoles) {
            var holeToRestore = JSON.parse(JSON.stringify(this.holeData));
            if (this.originalIndex !== -1 && this.originalIndex < window.allBlastHoles.length) {
                window.allBlastHoles.splice(this.originalIndex, 0, holeToRestore);
            } else {
                window.allBlastHoles.push(holeToRestore);
            }
        }
    }
    
    redo() {
        this.execute();
    }
}

// Step 4) DeleteMultipleHolesAction - For deleting multiple holes at once
class DeleteMultipleHolesAction extends UndoableAction {
    constructor(holesData) {
        super(ActionTypes.DELETE_HOLE, true, false);
        // Step 4a) Store deep copies with original indices
        this.holesData = holesData.map(function(item) {
            return {
                holeData: JSON.parse(JSON.stringify(item.holeData || item)),
                originalIndex: item.originalIndex !== undefined ? item.originalIndex : -1
            };
        });
        this.description = "Delete " + this.holesData.length + " holes";
    }
    
    execute() {
        // Step 4b) Remove all holes (in reverse order to preserve indices)
        if (window.allBlastHoles) {
            // Sort by index descending to remove from end first
            var sortedData = this.holesData.slice().sort(function(a, b) {
                return b.originalIndex - a.originalIndex;
            });
            
            for (var i = 0; i < sortedData.length; i++) {
                var holeData = sortedData[i].holeData;
                var index = window.allBlastHoles.findIndex(function(h) {
                    return h.holeID === holeData.holeID && h.entityName === holeData.entityName;
                });
                if (index !== -1) {
                    window.allBlastHoles.splice(index, 1);
                }
            }
        }
    }
    
    undo() {
        // Step 4c) Restore all holes (in original order by index)
        if (window.allBlastHoles) {
            // Sort by index ascending to restore in order
            var sortedData = this.holesData.slice().sort(function(a, b) {
                return a.originalIndex - b.originalIndex;
            });
            
            for (var i = 0; i < sortedData.length; i++) {
                var item = sortedData[i];
                var holeToRestore = JSON.parse(JSON.stringify(item.holeData));
                if (item.originalIndex !== -1 && item.originalIndex <= window.allBlastHoles.length) {
                    window.allBlastHoles.splice(item.originalIndex, 0, holeToRestore);
                } else {
                    window.allBlastHoles.push(holeToRestore);
                }
            }
        }
    }
    
    redo() {
        this.execute();
    }
}

// Step 5) MoveHoleAction - Undo: restore original position, Redo: apply new position
class MoveHoleAction extends UndoableAction {
    constructor(holeId, entityName, originalPosition, newPosition) {
        super(ActionTypes.MOVE_HOLE, true, false);
        this.holeId = holeId;
        this.entityName = entityName;
        // Step 5a) Store original and new positions
        this.originalPosition = JSON.parse(JSON.stringify(originalPosition));
        this.newPosition = JSON.parse(JSON.stringify(newPosition));
        this.description = "Move hole " + (holeId || "");
    }
    
    execute() {
        this._applyPosition(this.newPosition);
    }
    
    undo() {
        this._applyPosition(this.originalPosition);
    }
    
    redo() {
        this._applyPosition(this.newPosition);
    }
    
    // Step 5b) Helper to apply position to hole
    _applyPosition(position) {
        if (window.allBlastHoles) {
            var hole = window.allBlastHoles.find(function(h) {
                return h.holeID === this.holeId && h.entityName === this.entityName;
            }.bind(this));
            
            if (hole) {
                // Step 5b.1) Apply collar position using calculateHoleGeometry if available
                // This ensures toe/grade positions are recalculated correctly
                // Mode 4 = X position, Mode 5 = Y position, Mode 6 = Z position
                if (typeof window.calculateHoleGeometry === "function") {
                    if (position.startXLocation !== undefined) {
                        window.calculateHoleGeometry(hole, position.startXLocation, 4); // 4 = X position
                    }
                    if (position.startYLocation !== undefined) {
                        window.calculateHoleGeometry(hole, position.startYLocation, 5); // 5 = Y position
                    }
                    if (position.startZLocation !== undefined) {
                        window.calculateHoleGeometry(hole, position.startZLocation, 6); // 6 = Z position
                    }
                } else {
                    // Step 5b.2) Fallback: Apply positions directly if calculateHoleGeometry not available
                    if (position.startXLocation !== undefined) hole.startXLocation = position.startXLocation;
                    if (position.startYLocation !== undefined) hole.startYLocation = position.startYLocation;
                    if (position.startZLocation !== undefined) hole.startZLocation = position.startZLocation;
                    
                    // Apply toe position
                    if (position.endXLocation !== undefined) hole.endXLocation = position.endXLocation;
                    if (position.endYLocation !== undefined) hole.endYLocation = position.endYLocation;
                    if (position.endZLocation !== undefined) hole.endZLocation = position.endZLocation;
                    
                    // Apply grade position
                    if (position.gradeXLocation !== undefined) hole.gradeXLocation = position.gradeXLocation;
                    if (position.gradeYLocation !== undefined) hole.gradeYLocation = position.gradeYLocation;
                    if (position.gradeZLocation !== undefined) hole.gradeZLocation = position.gradeZLocation;
                }
                
                // Step 5b.3) Trigger 3D rebuild and redraw
                window.threeDataNeedsRebuild = true;
                if (typeof window.drawData === "function") {
                    window.drawData(window.allBlastHoles, null);
                }
                if (typeof window.debouncedSaveHoles === "function") {
                    window.debouncedSaveHoles();
                }
            }
        }
    }
}

// Step 6) MoveMultipleHolesAction - For moving multiple holes at once
class MoveMultipleHolesAction extends UndoableAction {
    constructor(moveData) {
        super(ActionTypes.MOVE_HOLE, true, false);
        // Step 6a) Store move data for each hole
        // moveData is array of { holeId, entityName, originalPosition, newPosition }
        this.moveData = moveData.map(function(m) {
            return {
                holeId: m.holeId,
                entityName: m.entityName,
                originalPosition: JSON.parse(JSON.stringify(m.originalPosition)),
                newPosition: JSON.parse(JSON.stringify(m.newPosition))
            };
        });
        this.description = "Move " + this.moveData.length + " holes";
    }
    
    execute() {
        for (var i = 0; i < this.moveData.length; i++) {
            this._applyPosition(this.moveData[i], this.moveData[i].newPosition);
        }
        // Trigger redraw after all holes moved
        window.threeDataNeedsRebuild = true;
        if (typeof window.drawData === "function") {
            window.drawData(window.allBlastHoles, null);
        }
        if (typeof window.debouncedSaveHoles === "function") {
            window.debouncedSaveHoles();
        }
    }
    
    undo() {
        for (var i = 0; i < this.moveData.length; i++) {
            this._applyPosition(this.moveData[i], this.moveData[i].originalPosition);
        }
        // Trigger redraw after all holes moved
        window.threeDataNeedsRebuild = true;
        if (typeof window.drawData === "function") {
            window.drawData(window.allBlastHoles, null);
        }
        if (typeof window.debouncedSaveHoles === "function") {
            window.debouncedSaveHoles();
        }
    }
    
    redo() {
        this.execute();
    }
    
    _applyPosition(moveItem, position) {
        if (window.allBlastHoles) {
            var hole = window.allBlastHoles.find(function(h) {
                return h.holeID === moveItem.holeId && h.entityName === moveItem.entityName;
            });
            
            if (hole) {
                // Step #) Apply collar position using calculateHoleGeometry if available
                // Mode 4 = X position, Mode 5 = Y position, Mode 6 = Z position
                if (typeof window.calculateHoleGeometry === "function") {
                    if (position.startXLocation !== undefined) {
                        window.calculateHoleGeometry(hole, position.startXLocation, 4); // 4 = X position
                    }
                    if (position.startYLocation !== undefined) {
                        window.calculateHoleGeometry(hole, position.startYLocation, 5); // 5 = Y position
                    }
                    if (position.startZLocation !== undefined) {
                        window.calculateHoleGeometry(hole, position.startZLocation, 6); // 6 = Z position
                    }
                } else {
                    // Fallback: Apply positions directly
                    if (position.startXLocation !== undefined) hole.startXLocation = position.startXLocation;
                    if (position.startYLocation !== undefined) hole.startYLocation = position.startYLocation;
                    if (position.startZLocation !== undefined) hole.startZLocation = position.startZLocation;
                    if (position.endXLocation !== undefined) hole.endXLocation = position.endXLocation;
                    if (position.endYLocation !== undefined) hole.endYLocation = position.endYLocation;
                    if (position.endZLocation !== undefined) hole.endZLocation = position.endZLocation;
                    if (position.gradeXLocation !== undefined) hole.gradeXLocation = position.gradeXLocation;
                    if (position.gradeYLocation !== undefined) hole.gradeYLocation = position.gradeYLocation;
                    if (position.gradeZLocation !== undefined) hole.gradeZLocation = position.gradeZLocation;
                }
            }
        }
    }
}

// Step 7) EditHolePropsAction - Undo: restore original props, Redo: apply new props
class EditHolePropsAction extends UndoableAction {
    constructor(holeId, entityName, originalProps, newProps) {
        super(ActionTypes.EDIT_HOLE_PROPS, true, false);
        this.holeId = holeId;
        this.entityName = entityName;
        this.originalProps = JSON.parse(JSON.stringify(originalProps));
        this.newProps = JSON.parse(JSON.stringify(newProps));
        this.description = "Edit hole " + (holeId || "") + " properties";
    }
    
    execute() {
        this._applyProps(this.newProps);
    }
    
    undo() {
        this._applyProps(this.originalProps);
    }
    
    redo() {
        this._applyProps(this.newProps);
    }
    
    _applyProps(props) {
        if (window.allBlastHoles) {
            var hole = window.allBlastHoles.find(function(h) {
                return h.holeID === this.holeId && h.entityName === this.entityName;
            }.bind(this));
            
            if (hole) {
                // Step 7a) Special handling for bearing - use calculateHoleGeometry
                if (props.holeBearing !== undefined && typeof window.calculateHoleGeometry === "function") {
                    window.calculateHoleGeometry(hole, props.holeBearing, 3); // 3 = bearing parameter
                }
                // Step 7b) Apply other properties directly
                for (var key in props) {
                    if (props.hasOwnProperty(key) && key !== "holeBearing") {
                        hole[key] = props[key];
                    }
                }
                // Step 7c) Trigger redraw
                window.threeDataNeedsRebuild = true;
                if (typeof window.drawData === "function") {
                    window.drawData(window.allBlastHoles, null);
                }
                if (typeof window.debouncedSaveHoles === "function") {
                    window.debouncedSaveHoles();
                }
            }
        }
    }
}

// Step 8) EditMultipleHolesPropsAction - For editing multiple holes at once
class EditMultipleHolesPropsAction extends UndoableAction {
    constructor(editData) {
        super(ActionTypes.EDIT_HOLE_PROPS, true, false);
        // editData is array of { holeId, entityName, originalProps, newProps }
        this.editData = editData.map(function(e) {
            return {
                holeId: e.holeId,
                entityName: e.entityName,
                originalProps: JSON.parse(JSON.stringify(e.originalProps)),
                newProps: JSON.parse(JSON.stringify(e.newProps))
            };
        });
        this.description = "Edit " + this.editData.length + " holes properties";
    }
    
    execute() {
        for (var i = 0; i < this.editData.length; i++) {
            this._applyProps(this.editData[i], this.editData[i].newProps);
        }
        this._triggerRedraw();
    }
    
    undo() {
        for (var i = 0; i < this.editData.length; i++) {
            this._applyProps(this.editData[i], this.editData[i].originalProps);
        }
        this._triggerRedraw();
    }
    
    redo() {
        this.execute();
    }
    
    _applyProps(editItem, props) {
        if (window.allBlastHoles) {
            var hole = window.allBlastHoles.find(function(h) {
                return h.holeID === editItem.holeId && h.entityName === editItem.entityName;
            });
            
            if (hole) {
                // Step 8a) Special handling for bearing - use calculateHoleGeometry
                if (props.holeBearing !== undefined && typeof window.calculateHoleGeometry === "function") {
                    window.calculateHoleGeometry(hole, props.holeBearing, 3); // 3 = bearing parameter
                }
                // Step 8b) Apply other properties directly
                for (var key in props) {
                    if (props.hasOwnProperty(key) && key !== "holeBearing") {
                        hole[key] = props[key];
                    }
                }
            }
        }
    }
    
    _triggerRedraw() {
        window.threeDataNeedsRebuild = true;
        if (typeof window.drawData === "function") {
            window.drawData(window.allBlastHoles, null);
        }
        if (typeof window.debouncedSaveHoles === "function") {
            window.debouncedSaveHoles();
        }
    }
}

// ============================================================
// KAD ACTIONS
// ============================================================

// Step 9) AddKADEntityAction - Undo: remove entity, Redo: add entity back
class AddKADEntityAction extends UndoableAction {
    constructor(entityName, entityData) {
        super(ActionTypes.ADD_KAD_ENTITY, false, true);
        this.entityName = entityName;
        // Step 9a) Store deep copy of entity data
        this.entityData = JSON.parse(JSON.stringify(entityData));
        this.description = "Add KAD entity '" + entityName + "'";
    }
    
    execute() {
        if (window.allKADDrawingsMap) {
            window.allKADDrawingsMap.set(this.entityName, JSON.parse(JSON.stringify(this.entityData)));
        }
    }
    
    undo() {
        if (window.allKADDrawingsMap) {
            window.allKADDrawingsMap.delete(this.entityName);
        }
    }
    
    redo() {
        this.execute();
    }
}

// Step 10) DeleteKADEntityAction - Undo: restore entity, Redo: delete again
class DeleteKADEntityAction extends UndoableAction {
    constructor(entityName, entityData) {
        super(ActionTypes.DELETE_KAD_ENTITY, false, true);
        this.entityName = entityName;
        this.entityData = JSON.parse(JSON.stringify(entityData));
        this.description = "Delete KAD entity '" + entityName + "'";
    }
    
    execute() {
        if (window.allKADDrawingsMap) {
            window.allKADDrawingsMap.delete(this.entityName);
        }
    }
    
    undo() {
        if (window.allKADDrawingsMap) {
            window.allKADDrawingsMap.set(this.entityName, JSON.parse(JSON.stringify(this.entityData)));
        }
    }
    
    redo() {
        this.execute();
    }
}

// Step 10a) AddMultipleKADEntitiesAction - For adding multiple entities at once (e.g., radii tool)
class AddMultipleKADEntitiesAction extends UndoableAction {
    constructor(entityNames) {
        super(ActionTypes.ADD_KAD_ENTITY, false, true);
        // Step #) Store entity names - we'll capture data on first undo
        this.entityNames = entityNames.slice();
        this.entitiesData = null; // Captured lazily
        this.description = "Add " + entityNames.length + " KAD entities";
    }
    
    execute() {
        // Step #) Re-add entities from stored data
        if (window.allKADDrawingsMap && this.entitiesData) {
            for (var i = 0; i < this.entitiesData.length; i++) {
                var item = this.entitiesData[i];
                window.allKADDrawingsMap.set(item.name, JSON.parse(JSON.stringify(item.data)));
            }
        }
    }
    
    undo() {
        // Step #) Capture entity data before removing (for redo)
        if (!this.entitiesData && window.allKADDrawingsMap) {
            this.entitiesData = [];
            for (var i = 0; i < this.entityNames.length; i++) {
                var name = this.entityNames[i];
                var data = window.allKADDrawingsMap.get(name);
                if (data) {
                    this.entitiesData.push({
                        name: name,
                        data: JSON.parse(JSON.stringify(data))
                    });
                }
            }
        }
        
        // Step #) Remove all entities
        if (window.allKADDrawingsMap) {
            for (var i = 0; i < this.entityNames.length; i++) {
                window.allKADDrawingsMap.delete(this.entityNames[i]);
            }
        }
    }
    
    redo() {
        this.execute();
    }
}

// Step 10b) DeleteMultipleKADEntitiesAction - For deleting multiple entities at once
class DeleteMultipleKADEntitiesAction extends UndoableAction {
    constructor(entitiesData) {
        super(ActionTypes.DELETE_KAD_ENTITY, false, true);
        // Step #) Store deep copies of all entity data
        // entitiesData is array of { name, data } or we capture from names
        this.entitiesData = entitiesData.map(function(item) {
            return {
                name: item.name || item.entityName,
                data: JSON.parse(JSON.stringify(item.data || item))
            };
        });
        this.description = "Delete " + this.entitiesData.length + " KAD entities";
    }
    
    execute() {
        if (window.allKADDrawingsMap) {
            for (var i = 0; i < this.entitiesData.length; i++) {
                window.allKADDrawingsMap.delete(this.entitiesData[i].name);
            }
        }
    }
    
    undo() {
        if (window.allKADDrawingsMap) {
            for (var i = 0; i < this.entitiesData.length; i++) {
                var item = this.entitiesData[i];
                window.allKADDrawingsMap.set(item.name, JSON.parse(JSON.stringify(item.data)));
            }
        }
    }
    
    redo() {
        this.execute();
    }
}

// Step 11) AddKADVertexAction - Undo: remove vertex, Redo: add vertex back
class AddKADVertexAction extends UndoableAction {
    constructor(entityName, vertexData, vertexIndex) {
        super(ActionTypes.ADD_KAD_VERTEX, false, true);
        this.entityName = entityName;
        this.vertexData = JSON.parse(JSON.stringify(vertexData));
        this.vertexIndex = vertexIndex;
        this.pointID = vertexData.pointID;
        this.description = "Add vertex to '" + entityName + "'";
    }
    
    execute() {
        if (window.allKADDrawingsMap) {
            var entity = window.allKADDrawingsMap.get(this.entityName);
            
            // Step #) If entity doesn't exist (was deleted), recreate it
            if (!entity) {
                entity = {
                    entityName: this.entityName,
                    entityType: this.vertexData.entityType || "line",
                    data: [],
                    visible: true
                };
                window.allKADDrawingsMap.set(this.entityName, entity);
            }
            
            if (entity && entity.data) {
                var vertex = JSON.parse(JSON.stringify(this.vertexData));
                if (this.vertexIndex !== undefined && this.vertexIndex < entity.data.length) {
                    entity.data.splice(this.vertexIndex, 0, vertex);
                } else {
                    entity.data.push(vertex);
                }
            }
        }
    }
    
    undo() {
        if (window.allKADDrawingsMap) {
            var entity = window.allKADDrawingsMap.get(this.entityName);
            if (entity && entity.data) {
                var index = entity.data.findIndex(function(v) {
                    return v.pointID === this.pointID;
                }.bind(this));
                if (index !== -1) {
                    entity.data.splice(index, 1);
                    
                    // Step #) If entity is now empty, delete it
                    if (entity.data.length === 0) {
                        window.allKADDrawingsMap.delete(this.entityName);
                    }
                }
            }
        }
    }
    
    redo() {
        this.execute();
    }
}

// Step 12) DeleteKADVertexAction - Undo: restore vertex, Redo: delete again
class DeleteKADVertexAction extends UndoableAction {
    constructor(entityName, vertexData, vertexIndex) {
        super(ActionTypes.DELETE_KAD_VERTEX, false, true);
        this.entityName = entityName;
        this.vertexData = JSON.parse(JSON.stringify(vertexData));
        this.vertexIndex = vertexIndex;
        this.pointID = vertexData.pointID;
        this.description = "Delete vertex from '" + entityName + "'";
    }
    
    execute() {
        if (window.allKADDrawingsMap) {
            var entity = window.allKADDrawingsMap.get(this.entityName);
            if (entity && entity.data) {
                var index = entity.data.findIndex(function(v) {
                    return v.pointID === this.pointID;
                }.bind(this));
                if (index !== -1) {
                    entity.data.splice(index, 1);
                }
            }
        }
    }
    
    undo() {
        if (window.allKADDrawingsMap) {
            var entity = window.allKADDrawingsMap.get(this.entityName);
            
            // Step #) If entity doesn't exist (was deleted when empty), recreate it
            if (!entity) {
                entity = {
                    entityName: this.entityName,
                    entityType: this.vertexData.entityType || "line",
                    data: [],
                    visible: true
                };
                window.allKADDrawingsMap.set(this.entityName, entity);
            }
            
            if (entity && entity.data) {
                var vertex = JSON.parse(JSON.stringify(this.vertexData));
                if (this.vertexIndex !== undefined && this.vertexIndex <= entity.data.length) {
                    entity.data.splice(this.vertexIndex, 0, vertex);
                } else {
                    entity.data.push(vertex);
                }
            }
        }
    }
    
    redo() {
        this.execute();
    }
}

// Step 12b) DeleteMultipleKADVerticesAction - Bulk vertex deletion (point cloud cleaning)
// Stores deleted vertices grouped by entity for efficient undo/redo
class DeleteMultipleKADVerticesAction extends UndoableAction {
    /**
     * @param {Map<string, {indices: number[], vertices: Array}>} deletionsByEntity
     *   Map of entityName -> { indices: sorted descending, vertices: vertex data at those indices }
     * @param {number} totalCount - Total vertices deleted
     */
    constructor(deletionsByEntity, totalCount) {
        super(ActionTypes.DELETE_KAD_VERTEX, false, true);
        this.deletionsByEntity = deletionsByEntity;
        this.totalCount = totalCount;
        this.description = "Delete " + totalCount + " vertices";
    }

    execute() {
        var allKADDrawingsMap = window.allKADDrawingsMap;
        if (!allKADDrawingsMap) return;

        for (var [entityName, info] of this.deletionsByEntity.entries()) {
            var entity = allKADDrawingsMap.get(entityName);
            if (!entity || !entity.data) continue;

            // Build Set of indices to remove, then filter in one pass — O(n) not O(n*m)
            var removeSet = new Set(info.indices);
            entity.data = entity.data.filter(function(_, i) { return !removeSet.has(i); });

            if (entity.data.length === 0) {
                allKADDrawingsMap.delete(entityName);
            } else if (window.renumberEntityPoints) {
                window.renumberEntityPoints(entity);
            }
        }
    }

    undo() {
        var allKADDrawingsMap = window.allKADDrawingsMap;
        if (!allKADDrawingsMap) return;

        for (var [entityName, info] of this.deletionsByEntity.entries()) {
            var entity = allKADDrawingsMap.get(entityName);

            // Recreate entity if it was removed
            if (!entity) {
                var sampleVertex = info.vertices[0];
                entity = {
                    entityName: entityName,
                    entityType: sampleVertex ? (sampleVertex.entityType || "point") : "point",
                    data: [],
                    visible: true
                };
                allKADDrawingsMap.set(entityName, entity);
            }

            // Re-insert vertices at their original indices (ascending order)
            // indices are stored descending, so reverse for insertion
            for (var i = info.indices.length - 1; i >= 0; i--) {
                var idx = info.indices[i];
                var vertex = info.vertices[i];
                if (idx <= entity.data.length) {
                    entity.data.splice(idx, 0, vertex);
                } else {
                    entity.data.push(vertex);
                }
            }

            if (window.renumberEntityPoints) {
                window.renumberEntityPoints(entity);
            }
        }
    }

    redo() {
        this.execute();
    }
}

// Step 13) MoveKADVertexAction - Undo: restore original position, Redo: apply new position
class MoveKADVertexAction extends UndoableAction {
    constructor(entityName, pointID, originalPosition, newPosition) {
        super(ActionTypes.MOVE_KAD_VERTEX, false, true);
        this.entityName = entityName;
        this.pointID = pointID;
        this.originalPosition = JSON.parse(JSON.stringify(originalPosition));
        this.newPosition = JSON.parse(JSON.stringify(newPosition));
        this.description = "Move vertex in '" + entityName + "'";
    }
    
    execute() {
        this._applyPosition(this.newPosition);
        this._triggerRedraw();
    }
    
    undo() {
        this._applyPosition(this.originalPosition);
        this._triggerRedraw();
    }
    
    redo() {
        this._applyPosition(this.newPosition);
        this._triggerRedraw();
    }
    
    _applyPosition(position) {
        if (window.allKADDrawingsMap) {
            var entity = window.allKADDrawingsMap.get(this.entityName);
            if (entity && entity.data) {
                var vertex = entity.data.find(function(v) {
                    return v.pointID === this.pointID;
                }.bind(this));
                
                if (vertex) {
                    if (position.pointXLocation !== undefined) vertex.pointXLocation = position.pointXLocation;
                    if (position.pointYLocation !== undefined) vertex.pointYLocation = position.pointYLocation;
                    if (position.pointZLocation !== undefined) vertex.pointZLocation = position.pointZLocation;
                }
            }
        }
    }
    
    _triggerRedraw() {
        window.threeDataNeedsRebuild = true;
        if (typeof window.drawData === "function") {
            window.drawData(window.allBlastHoles, null);
        }
        if (typeof window.debouncedSaveKAD === "function") {
            window.debouncedSaveKAD();
        }
    }
}

// Step 14) MoveMultipleKADVerticesAction - For moving multiple vertices at once
class MoveMultipleKADVerticesAction extends UndoableAction {
    constructor(moveData) {
        super(ActionTypes.MOVE_KAD_VERTEX, false, true);
        // moveData is array of { entityName, pointID, originalPosition, newPosition }
        this.moveData = moveData.map(function(m) {
            return {
                entityName: m.entityName,
                pointID: m.pointID,
                originalPosition: JSON.parse(JSON.stringify(m.originalPosition)),
                newPosition: JSON.parse(JSON.stringify(m.newPosition))
            };
        });
        this.description = "Move " + this.moveData.length + " vertices";
    }
    
    execute() {
        for (var i = 0; i < this.moveData.length; i++) {
            this._applyPosition(this.moveData[i], this.moveData[i].newPosition);
        }
        this._triggerRedraw();
    }
    
    undo() {
        for (var i = 0; i < this.moveData.length; i++) {
            this._applyPosition(this.moveData[i], this.moveData[i].originalPosition);
        }
        this._triggerRedraw();
    }
    
    redo() {
        this.execute();
    }
    
    _applyPosition(moveItem, position) {
        if (window.allKADDrawingsMap) {
            var entity = window.allKADDrawingsMap.get(moveItem.entityName);
            if (entity && entity.data) {
                var vertex = entity.data.find(function(v) {
                    return v.pointID === moveItem.pointID;
                });
                
                if (vertex) {
                    if (position.pointXLocation !== undefined) vertex.pointXLocation = position.pointXLocation;
                    if (position.pointYLocation !== undefined) vertex.pointYLocation = position.pointYLocation;
                    if (position.pointZLocation !== undefined) vertex.pointZLocation = position.pointZLocation;
                }
            }
        }
    }
    
    _triggerRedraw() {
        window.threeDataNeedsRebuild = true;
        if (typeof window.drawData === "function") {
            window.drawData(window.allBlastHoles, null);
        }
        if (typeof window.debouncedSaveKAD === "function") {
            window.debouncedSaveKAD();
        }
    }
}

// Step 15) EditKADPropsAction - For editing KAD entity or vertex properties
class EditKADPropsAction extends UndoableAction {
    constructor(entityName, pointID, originalProps, newProps) {
        super(ActionTypes.EDIT_KAD_PROPS, false, true);
        this.entityName = entityName;
        this.pointID = pointID; // null if editing entity-level props
        this.originalProps = JSON.parse(JSON.stringify(originalProps));
        this.newProps = JSON.parse(JSON.stringify(newProps));
        this.description = pointID 
            ? "Edit vertex properties in '" + entityName + "'"
            : "Edit entity '" + entityName + "' properties";
    }
    
    execute() {
        this._applyProps(this.newProps);
    }
    
    undo() {
        this._applyProps(this.originalProps);
    }
    
    redo() {
        this._applyProps(this.newProps);
    }
    
    _applyProps(props) {
        if (window.allKADDrawingsMap) {
            var entity = window.allKADDrawingsMap.get(this.entityName);
            if (entity) {
                if (this.pointID !== null && entity.data) {
                    // Apply to specific vertex
                    var vertex = entity.data.find(function(v) {
                        return v.pointID === this.pointID;
                    }.bind(this));
                    
                    if (vertex) {
                        for (var key in props) {
                            if (props.hasOwnProperty(key)) {
                                vertex[key] = props[key];
                            }
                        }
                    }
                } else {
                    // Apply to entity level
                    for (var key in props) {
                        if (props.hasOwnProperty(key)) {
                            entity[key] = props[key];
                        }
                    }
                }
            }
        }
    }
}

// Step 16) TransformKADAction - For transforming (translate/rotate) KAD entities
class TransformKADAction extends UndoableAction {
    constructor(beforePositions, afterPositions, description) {
        super("TRANSFORM_KAD", false, true);
        // beforePositions and afterPositions are Maps: key -> {x, y, z}
        // key format: "entityName:::pointID"
        this.beforePositions = new Map(beforePositions);
        this.afterPositions = new Map(afterPositions);
        this.description = description || "Transform " + this.beforePositions.size + " KAD points";
    }

    execute() {
        this._applyPositions(this.afterPositions);
    }

    undo() {
        this._applyPositions(this.beforePositions);
    }

    redo() {
        this._applyPositions(this.afterPositions);
    }

    _applyPositions(positions) {
        for (const [key, pos] of positions) {
            const parts = key.split(":::");
            const entityName = parts[0];
            const pointID = parts[1];

            if (window.allKADDrawingsMap) {
                const entity = window.allKADDrawingsMap.get(entityName);
                if (entity && entity.data) {
                    const vertex = entity.data.find(function(v) {
                        return String(v.pointID) === String(pointID);
                    });

                    if (vertex) {
                        vertex.pointXLocation = pos.x;
                        vertex.pointYLocation = pos.y;
                        vertex.pointZLocation = pos.z;
                    }
                }
            }
        }

        // Trigger redraw
        window.threeDataNeedsRebuild = true;
        if (typeof window.drawData === "function") {
            window.drawData(window.allBlastHoles, window.selectedHole);
        }
        if (typeof window.debouncedSaveKAD === "function") {
            window.debouncedSaveKAD();
        }
    }
}

// Step 17) Export all action classes
// ============================================================
// SURFACE ACTIONS
// ============================================================

// AddSurfaceAction - Undo: remove surface, Redo: add surface back
class AddSurfaceAction extends UndoableAction {
    constructor(surfaceData) {
        super(ActionTypes.ADD_SURFACE, false, false);
        this.affectsSurfaces = true;
        this.surfaceId = surfaceData.id;
        // Store a serialisable copy (exclude threeJSMesh, analysisTexture etc.)
        this.surfaceData = _cloneSurfaceData(surfaceData);
        this.description = "Add surface " + (surfaceData.name || surfaceData.id);
    }

    execute() {
        if (window.loadedSurfaces) {
            window.loadedSurfaces.set(this.surfaceId, _cloneSurfaceData(this.surfaceData));
        }
    }

    undo() {
        _removeSurfaceFromScene(this.surfaceId);
        if (window.loadedSurfaces) {
            window.loadedSurfaces.delete(this.surfaceId);
        }
        if (window.deleteSurfaceFromDB) {
            window.deleteSurfaceFromDB(this.surfaceId).catch(function() {});
        }
        if (window.invalidateSurfaceCache) {
            window.invalidateSurfaceCache(this.surfaceId);
        }
    }

    redo() {
        this.execute();
    }
}

// EditSurfacePropsAction - Undo: restore old props, Redo: apply new props
class EditSurfacePropsAction extends UndoableAction {
    constructor(surfaceId, oldProps, newProps) {
        super(ActionTypes.EDIT_SURFACE_PROPS, false, false);
        this.affectsSurfaces = true;
        this.surfaceId = surfaceId;
        this.oldProps = JSON.parse(JSON.stringify(oldProps));
        this.newProps = JSON.parse(JSON.stringify(newProps));
        this.description = "Edit surface " + surfaceId;
    }

    execute() {
        _applySurfaceProps(this.surfaceId, this.newProps);
    }

    undo() {
        _applySurfaceProps(this.surfaceId, this.oldProps);
        _removeSurfaceFromScene(this.surfaceId);
        if (window.invalidateSurfaceCache) {
            window.invalidateSurfaceCache(this.surfaceId);
        }
    }

    redo() {
        this.execute();
        _removeSurfaceFromScene(this.surfaceId);
        if (window.invalidateSurfaceCache) {
            window.invalidateSurfaceCache(this.surfaceId);
        }
    }
}

// DeleteSurfaceAction - Undo: restore surface, Redo: delete again
class DeleteSurfaceAction extends UndoableAction {
    constructor(surfaceData) {
        super(ActionTypes.DELETE_SURFACE, false, false);
        this.affectsSurfaces = true;
        this.surfaceId = surfaceData.id;
        this.surfaceData = _cloneSurfaceData(surfaceData);
        this.description = "Delete surface " + (surfaceData.name || surfaceData.id);
    }

    execute() {
        _removeSurfaceFromScene(this.surfaceId);
        if (window.loadedSurfaces) {
            window.loadedSurfaces.delete(this.surfaceId);
        }
        if (window.deleteSurfaceFromDB) {
            window.deleteSurfaceFromDB(this.surfaceId).catch(function() {});
        }
        if (window.invalidateSurfaceCache) {
            window.invalidateSurfaceCache(this.surfaceId);
        }
    }

    undo() {
        if (window.loadedSurfaces) {
            window.loadedSurfaces.set(this.surfaceId, _cloneSurfaceData(this.surfaceData));
        }
    }

    redo() {
        this.execute();
    }
}

/**
 * Clone surface data for undo storage (excludes non-serialisable Three.js objects).
 */
function _cloneSurfaceData(surface) {
    var clone = {};
    for (var key in surface) {
        if (!surface.hasOwnProperty(key)) continue;
        // Skip Three.js objects and canvas elements
        if (key === "threeJSMesh" || key === "analysisTexture" || key === "analysisCanvas") continue;
        try {
            clone[key] = JSON.parse(JSON.stringify(surface[key]));
        } catch (e) {
            // Skip non-serialisable values (Blobs, ArrayBuffers etc.)
        }
    }
    return clone;
}

/**
 * Remove a surface mesh from the Three.js scene.
 */
function _removeSurfaceFromScene(surfaceId) {
    if (window.threeRenderer && window.threeRenderer.surfaceMeshMap) {
        var mesh = window.threeRenderer.surfaceMeshMap.get(surfaceId);
        if (mesh) {
            if (mesh.parent) mesh.parent.remove(mesh);
            mesh.traverse(function(child) {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (child.material.map) child.material.map.dispose();
                    child.material.dispose();
                }
            });
            window.threeRenderer.surfaceMeshMap.delete(surfaceId);
        }
    }
}

/**
 * Apply property overrides to a surface.
 */
function _applySurfaceProps(surfaceId, props) {
    if (!window.loadedSurfaces) return;
    var surface = window.loadedSurfaces.get(surfaceId);
    if (!surface) return;
    for (var key in props) {
        if (props.hasOwnProperty(key)) {
            surface[key] = props[key];
        }
    }
}

export {
    // Hole actions
    AddHoleAction,
    AddMultipleHolesAction,
    DeleteHoleAction,
    DeleteMultipleHolesAction,
    MoveHoleAction,
    MoveMultipleHolesAction,
    EditHolePropsAction,
    EditMultipleHolesPropsAction,

    // KAD actions
    AddKADEntityAction,
    AddMultipleKADEntitiesAction,
    DeleteKADEntityAction,
    DeleteMultipleKADEntitiesAction,
    AddKADVertexAction,
    DeleteKADVertexAction,
    DeleteMultipleKADVerticesAction,
    MoveKADVertexAction,
    MoveMultipleKADVerticesAction,
    EditKADPropsAction,
    TransformKADAction,

    // Surface actions
    AddSurfaceAction,
    EditSurfacePropsAction,
    DeleteSurfaceAction
};
