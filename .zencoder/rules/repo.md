# Kirra3D Information

## Summary

Kirra3D is a 3D visualization application built with Three.js for rendering and manipulating 3D models, particularly focused on blast hole visualization and mining-related data. It supports importing various file formats including CSV, OBJ, and DXF, and provides tools for camera manipulation, object transformation, and data visualization.

## Structure

-   **src/**: Core application source code
    -   **buttons/**: UI button components and handlers
    -   **drawing/**: Scene creation and rendering logic
    -   **entities/**: 3D object entities and manipulation
    -   **file/**: File import/export and database operations
    -   **helpers/**: Utility functions
    -   **settings/**: Application settings
    -   **views/**: UI view components
-   **public/**: Static assets and resources
-   **csv-samples/**: Sample data files for testing
-   **assetStore/**: Fonts, icons, and other assets

## Language & Runtime

**Language**: JavaScript/TypeScript
**Version**: ES2020
**Build System**: Vite
**Package Manager**: npm

## Dependencies

**Main Dependencies**:

-   **three**: ^0.167.1 - Core 3D rendering library
-   **bootstrap**: ^5.3.3 - UI framework
-   **papaparse**: ^5.4.1 - CSV parsing
-   **earcut**: ^3.0.0 - Polygon triangulation
-   **dxf-parser**: ^1.1.2 - DXF file parsing
-   **lil-gui**: ^0.19.1 - GUI controls
-   **three-mesh-bvh**: ^0.7.6 - Mesh optimization
-   **three-orbitcontrols**: ^2.110.3 - Camera controls

**Development Dependencies**:

-   **typescript**: ^5.2.2
-   **vite**: ^5.0.8
-   **vite-plugin-css-modules**: ^0.0.1
-   **@wixc3/react-board**: ^2.3.0

## Build & Installation

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Main Files & Resources

**Entry Point**: src/main.js
**HTML Entry**: index.html
**Configuration**:

-   vite.config.js - Build and development server configuration
-   tsconfig.json - TypeScript configuration

## Key Features

-   3D visualization of blast holes and mining data
-   Import/export of various file formats (CSV, OBJ, DXF)
-   Camera controls and view manipulation
-   Object transformation and positioning
-   Data persistence using IndexedDB
-   Interactive UI with Bootstrap components
-   Real-time 3D rendering with Three.js
-   Support for various hole visualization styles
-   Scene object management and organization
