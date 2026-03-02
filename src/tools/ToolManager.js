/**
 * ToolManager.js
 * Manages tool state, activation, and transitions in Kirra2D
 * Author: Brent Buffham
 * Last Modified: 20251220-1500AWST
 */

// Step 1) Define Tool Manager Class
class ToolManager {
    constructor() {
        // Step 2) Initialize tool state variables
        this.tools = {
            // Selection Tools
            selectPointer: {
                id: "selectPointerTool",
                active: false,
                stateVar: "isSelectionPointerActive",
                elementId: "selectPointer",
                type: "selection"
            },
            selectByPolygon: {
                id: "selectByPolygonTool",
                active: false,
                stateVar: "isPolygonSelectionActive",
                elementId: "selectByPolygon",
                type: "selection"
            },
            selectHoles: {
                id: "selectHoles",
                active: true,
                elementId: "selectHoles",
                type: "radio",
                group: "selectType"
            },
            selectKAD: {
                id: "selectKAD",
                active: false,
                elementId: "selectKAD",
                type: "radio",
                group: "selectType"
            },

            // KAD Drawing Tools
            addKADPoints: {
                id: "addKADPointsTool",
                active: false,
                stateVar: "isAddKADPointsToolActive",
                elementId: "addKADPointsTool",
                type: "kad",
                linkedSwitch: "addPointDraw"
            },
            addKADLine: {
                id: "addKADLineTool",
                active: false,
                stateVar: "isAddKADLineToolActive",
                elementId: "addKADLineTool",
                type: "kad",
                linkedSwitch: "addLineDraw"
            },
            addKADPolygon: {
                id: "addKADPolygonTool",
                active: false,
                stateVar: "isAddKADPolygonToolActive",
                elementId: "addKADPolygonTool",
                type: "kad",
                linkedSwitch: "addPolyDraw"
            },
            addKADCircle: {
                id: "addKADCircleTool",
                active: false,
                stateVar: "isAddKADCircleToolActive",
                elementId: "addKADCircleTool",
                type: "kad",
                linkedSwitch: "addCircleDraw"
            },
            addKADText: {
                id: "addKADTextTool",
                active: false,
                stateVar: "isAddKADTextToolActive",
                elementId: "addKADTextTool",
                type: "kad",
                linkedSwitch: "addTextDraw"
            },

            // Pattern and Hole Tools
            patternInPolygon: {
                id: "patternInPolygonTool",
                active: false,
                stateVar: "isPatternInPolygonActive",
                elementId: "patternInPolygonTool",
                type: "pattern"
            },
            holesAlongLine: {
                id: "holesAlongLineTool",
                active: false,
                stateVar: "isHolesAlongLineActive",
                elementId: "holesAlongLineTool",
                type: "pattern"
            },
            holesAlongPolyLine: {
                id: "holesAlongPolyLineTool",
                active: false,
                stateVar: "isHolesAlongPolyLineActive",
                elementId: "holesAlongPolyLineTool",
                type: "pattern"
            },
            holesAdding: {
                id: "holesAddingTool",
                active: false,
                stateVar: "isAddingHole",
                elementId: "holesAddingTool",
                type: "pattern",
                linkedSwitch: "addHoleSwitch"
            },

            // Transform and Manipulation Tools
            moveTo: {
                id: "moveToTool",
                active: false,
                stateVar: "isMoveToolActive",
                elementId: "moveToTool",
                type: "transform"
            },
            bearing: {
                id: "bearingTool",
                active: false,
                stateVar: "isBearingToolActive",
                elementId: "bearingTool",
                type: "transform"
            },
            assignSurface: {
                id: "assignSurfaceTool",
                active: false,
                stateVar: "isAssignSurfaceActive",
                elementId: "assignSurfaceTool",
                type: "transform"
            },
            assignGrade: {
                id: "assignGradeTool",
                active: false,
                stateVar: "isAssignGradeActive",
                elementId: "assignGradeTool",
                type: "transform"
            },
            offsetKAD: {
                id: "offsetKADTool",
                active: false,
                stateVar: "isOffsetKADActive",
                elementId: "offsetKADTool",
                type: "transform"
            },
            radiiHolesOrKADs: {
                id: "radiiHolesOrKADsTool",
                active: false,
                stateVar: "isRadiiHolesOrKADActive",
                elementId: "radiiHolesOrKADsTool",
                type: "transform"
            },

            // Connector Tools
            tieConnect: {
                id: "tieConnectTool",
                active: false,
                stateVar: "isAddingConnector",
                elementId: "tieConnectTool",
                type: "connector",
                linkedButton: "addConnectorButton"
            },
            tieConnectMulti: {
                id: "tieConnectMultiTool",
                active: false,
                stateVar: "isAddingMultiConnector",
                elementId: "tieConnectMultiTool",
                type: "connector",
                linkedButton: "addMultiConnectorButton"
            },

            // Analysis Tools
            triangulate: {
                id: "triangulateTool",
                active: false,
                stateVar: "isTriangulateToolActive",
                elementId: "triangulateTool",
                type: "analysis"
            },

            // Measurement Tools
            ruler: {
                id: "rulerTool",
                active: false,
                stateVar: "isRulerActive",
                elementId: "rulerTool",
                type: "measurement"
            },
            rulerProtractor: {
                id: "rulerProtractorTool",
                active: false,
                stateVar: "isRulerProtractorActive",
                elementId: "rulerProtractorTool",
                type: "measurement"
            },

            // Mesh Editing Tools
            meshEdit: {
                id: "meshEditTool",
                active: false,
                stateVar: "isMeshEditActive",
                elementId: "meshEditTool",
                type: "mesh"
            },

            // View Tools
            resetView: {
                id: "resetViewTool",
                active: false,
                elementId: "resetViewTool",
                type: "view"
            }
        };

        // Step 3) Track current active tool
        this.currentTool = null;
        this.previousTool = null;
    }

    // Step 4) Get tool by ID
    getTool(toolId) {
        return this.tools[toolId] || null;
    }

    // Step 5) Get tool by element ID
    getToolByElementId(elementId) {
        for (let key in this.tools) {
            if (this.tools[key].elementId === elementId) {
                return this.tools[key];
            }
        }
        return null;
    }

    // Step 6) Get current active tool
    getCurrentTool() {
        return this.currentTool;
    }

    // Step 7) Get previous tool
    getPreviousTool() {
        return this.previousTool;
    }

    // Step 8) Check if a tool is active
    isToolActive(toolId) {
        const tool = this.getTool(toolId);
        return tool ? tool.active : false;
    }

    // Step 9) Activate a tool
    activateTool(toolId) {
        const tool = this.getTool(toolId);
        if (!tool) {
            console.warn("ToolManager: Tool not found - " + toolId);
            return false;
        }

        // Step 10) Store previous tool
        if (this.currentTool) {
            this.previousTool = this.currentTool;
        }

        // Step 11) Deactivate all tools except the one being activated
        this.deactivateAllTools(toolId);

        // Step 12) Activate the tool
        tool.active = true;
        this.currentTool = toolId;

        // Step 13) Update the DOM element if it exists
        const element = document.getElementById(tool.elementId);
        if (element) {
            if (tool.type === "radio") {
                element.checked = true;
            } else {
                element.checked = true;
            }
        }

        console.log("ToolManager: Activated tool - " + toolId);
        return true;
    }

    // Step 14) Deactivate a tool
    deactivateTool(toolId) {
        const tool = this.getTool(toolId);
        if (!tool) {
            console.warn("ToolManager: Tool not found - " + toolId);
            return false;
        }

        // Step 15) Deactivate the tool
        tool.active = false;

        // Step 16) Update the DOM element if it exists
        const element = document.getElementById(tool.elementId);
        if (element && tool.type !== "radio") {
            element.checked = false;
        }

        // Step 17) Clear current tool if this was the active one
        if (this.currentTool === toolId) {
            this.currentTool = null;
        }

        console.log("ToolManager: Deactivated tool - " + toolId);
        return true;
    }

    // Step 18) Deactivate all tools except one
    deactivateAllTools(exceptToolId = null) {
        for (let key in this.tools) {
            const tool = this.tools[key];

            // Step 19) Skip the exception tool
            if (exceptToolId && key === exceptToolId) {
                continue;
            }

            // Step 20) Skip radio buttons that are not in the same group
            if (exceptToolId && tool.type === "radio") {
                const exceptTool = this.getTool(exceptToolId);
                if (exceptTool && exceptTool.type === "radio" && exceptTool.group !== tool.group) {
                    continue;
                }
            }

            // Step 21) Deactivate the tool
            tool.active = false;

            // Step 22) Update DOM element
            const element = document.getElementById(tool.elementId);
            if (element && tool.type !== "radio") {
                element.checked = false;
            }
        }
    }

    // Step 23) Toggle a tool on/off
    toggleTool(toolId) {
        const tool = this.getTool(toolId);
        if (!tool) {
            console.warn("ToolManager: Tool not found - " + toolId);
            return false;
        }

        if (tool.active) {
            this.deactivateTool(toolId);
        } else {
            this.activateTool(toolId);
        }

        return tool.active;
    }

    // Step 24) Get all active tools
    getActiveTools() {
        const activeTools = [];
        for (let key in this.tools) {
            if (this.tools[key].active) {
                activeTools.push(key);
            }
        }
        return activeTools;
    }

    // Step 25) Get all tools by type
    getToolsByType(type) {
        const toolsByType = [];
        for (let key in this.tools) {
            if (this.tools[key].type === type) {
                toolsByType.push(key);
            }
        }
        return toolsByType;
    }

    // Step 26) Get tool state variable name
    getToolStateVar(toolId) {
        const tool = this.getTool(toolId);
        return tool ? tool.stateVar : null;
    }

    // Step 27) Sync tool state with global state variables
    syncToolState(toolId, globalState) {
        const tool = this.getTool(toolId);
        if (!tool || !tool.stateVar) {
            return false;
        }

        tool.active = globalState[tool.stateVar] || false;
        return true;
    }

    // Step 28) Get tool info for debugging
    getToolInfo(toolId) {
        const tool = this.getTool(toolId);
        if (!tool) {
            return null;
        }

        return {
            id: tool.id,
            active: tool.active,
            type: tool.type,
            elementId: tool.elementId,
            stateVar: tool.stateVar,
            linkedSwitch: tool.linkedSwitch,
            linkedButton: tool.linkedButton
        };
    }

    // Step 29) Reset all tools to default state
    resetAllTools() {
        this.deactivateAllTools();
        this.currentTool = null;
        this.previousTool = null;

        // Step 30) Set selectHoles as default active
        this.activateTool("selectHoles");

        console.log("ToolManager: Reset all tools to default state");
    }

    // Step 31) Get linked switch for KAD tools
    getLinkedSwitch(toolId) {
        const tool = this.getTool(toolId);
        return tool ? tool.linkedSwitch : null;
    }

    // Step 32) Get linked button for connector tools
    getLinkedButton(toolId) {
        const tool = this.getTool(toolId);
        return tool ? tool.linkedButton : null;
    }

    // Step 33) Check if tool type is KAD
    isKADTool(toolId) {
        const tool = this.getTool(toolId);
        return tool ? tool.type === "kad" : false;
    }

    // Step 34) Check if tool type is selection
    isSelectionTool(toolId) {
        const tool = this.getTool(toolId);
        return tool ? tool.type === "selection" : false;
    }

    // Step 35) Check if tool type is transform
    isTransformTool(toolId) {
        const tool = this.getTool(toolId);
        return tool ? tool.type === "transform" : false;
    }

    // Step 36) Get all KAD tools
    getKADTools() {
        return this.getToolsByType("kad");
    }

    // Step 37) Get all selection tools
    getSelectionTools() {
        return this.getToolsByType("selection");
    }

    // Step 38) Get all transform tools
    getTransformTools() {
        return this.getToolsByType("transform");
    }

    // Step 39) Get status message for tool
    getToolStatusMessage(toolId) {
        const tool = this.getTool(toolId);
        if (!tool) {
            return "Unknown tool";
        }

        const statusMessages = {
            selectPointer: "Selection pointer active - Click to select objects",
            selectByPolygon: "Polygon selection active - Draw a polygon to select objects",
            selectHoles: "Selection mode: Holes only",
            selectKAD: "Selection mode: KAD only",
            addKADPoints: "KAD Point tool active - Click to add points",
            addKADLine: "KAD Line tool active - Click to add line segments",
            addKADPolygon: "KAD Polygon tool active - Click to add polygon vertices",
            addKADCircle: "KAD Circle tool active - Click to add circles",
            addKADText: "KAD Text tool active - Click to add text",
            moveTo: "Move tool active - Click and drag to move objects",
            bearing: "Bearing tool active - Click hole and drag to set bearing",
            ruler: "Ruler tool active - Click two points to measure distance",
            rulerProtractor: "Protractor tool active - Click three points to measure angle",
            triangulate: "Triangulation tool active - Select holes to triangulate",
            tieConnect: "Tie connector tool active - Click two holes to connect",
            tieConnectMulti: "Multi-tie connector tool active - Click multiple holes",
            patternInPolygon: "Pattern in polygon tool active - Draw polygon for pattern",
            holesAlongLine: "Holes along line tool active - Draw line for holes",
            holesAlongPolyLine: "Holes along polyline tool active - Draw polyline for holes",
            holesAdding: "Adding hole tool active - Click to add new hole",
            offsetKAD: "Offset KAD tool active - Select KAD object to offset",
            radiiHolesOrKADs: "Radii tool active - Adjust radii of holes or KAD objects",
            assignSurface: "Assign surface tool active - Click to assign surface elevation",
            assignGrade: "Assign grade tool active - Click to assign grade",
            meshEdit: "Mesh edit tool active - Click triangles to select/delete",
            resetView: "Resetting view to fit all data"
        };

        return statusMessages[toolId] || "Tool active: " + toolId;
    }
}

// Step 40) Create singleton instance
const toolManager = new ToolManager();

// Step 41) Export for use in other modules
export default toolManager;

