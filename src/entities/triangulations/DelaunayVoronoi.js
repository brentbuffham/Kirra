/*
 * Delaunay triangulation algorithm
 * Based on the paper "Delaunay Triangulation and Voronoi Diagram on the GPU" by J. D. Boissonnat, F. Cazals, and J. Giesen
 * https://hal.inria.fr/inria-00072164/document
 * https://www.cs.cmu.edu/~quake/robust.html
 * https://cp-algorithms.com/geometry/delaunay.html
 *
 * The algorithm is based on the quad-edge data structure
 * https://en.wikipedia.org/wiki/Quad-edge
 *
 * The algorithm is implemented in BigInt arithmetic to avoid floating point errors
 *
 * The algorithm is implemented in JavaScript BigInt arithmetic to avoid floating point errors
 * - BigInt is used to represent the coordinates of the points
 * - BigInt is used to represent the determinants of the points
 * - BigInt is used to represent the cross products of the points
 * - BigInt is used to represent the dot products of the points
 *
 * How to use the algorithm:
 * - Create an array of points
 * - Each point is an object with x and y properties
 * - Each property is a BigInt
 * - Call the delaunay function with the array of points
 * - The function returns an array of triangles
 * - Each triangle is an array of three points
 * - Each point is an object with x and y properties
 *
 */

class Point {
    constructor(x, y) {
        this.x = BigInt(x);
        this.y = BigInt(y);
    }

    subtract(p) {
        return new Point(this.x - p.x, this.y - p.y);
    }

    cross(p) {
        return this.x * p.y - this.y * p.x;
    }

    crossWith(a, b) {
        return a.subtract(this).cross(b.subtract(this));
    }

    dot(p) {
        return this.x * p.x + this.y * p.y;
    }

    dotWith(a, b) {
        return a.subtract(this).dot(b.subtract(this));
    }

    sqrLength() {
        return this.dot(this);
    }

    equals(p) {
        return this.x === p.x && this.y === p.y;
    }
}

const infPoint = new Point(1e18, 1e18);

class QuadEdge {
    constructor(origin) {
        this.origin = origin;
        this.rot = null;
        this.onext = null;
        this.used = false;
    }

    rev() {
        return this.rot.rot;
    }

    lnext() {
        return this.rot.rev().onext.rot;
    }

    oprev() {
        return this.rot.onext.rot;
    }

    dest() {
        return this.rev().origin;
    }
}

function makeEdge(from, to) {
    const e1 = new QuadEdge(from);
    const e2 = new QuadEdge(to);
    const e3 = new QuadEdge(infPoint);
    const e4 = new QuadEdge(infPoint);

    e1.rot = e3;
    e2.rot = e4;
    e3.rot = e2;
    e4.rot = e1;

    e1.onext = e1;
    e2.onext = e2;
    e3.onext = e4;
    e4.onext = e3;

    return e1;
}

function splice(a, b) {
    [a.onext.rot.onext, b.onext.rot.onext] = [b.onext.rot.onext, a.onext.rot.onext];
    [a.onext, b.onext] = [b.onext, a.onext];
}

function deleteEdge(e) {
    splice(e, e.oprev());
    splice(e.rev(), e.rev().oprev());
}

function connect(a, b) {
    const e = makeEdge(a.dest(), b.origin);
    splice(e, a.lnext());
    splice(e.rev(), b);
    return e;
}

function leftOf(p, e) {
    return p.crossWith(e.origin, e.dest()) > 0n;
}

function rightOf(p, e) {
    return p.crossWith(e.origin, e.dest()) < 0n;
}

function det3(a1, a2, a3, b1, b2, b3, c1, c2, c3) {
    return a1 * (b2 * c3 - c2 * b3) - a2 * (b1 * c3 - c1 * b3) + a3 * (b1 * c2 - c1 * b2);
}

function inCircle(a, b, c, d) {
    const det = -det3(b.x, b.y, b.sqrLength(), c.x, c.y, c.sqrLength(), d.x, d.y, d.sqrLength()) + det3(a.x, a.y, a.sqrLength(), c.x, c.y, c.sqrLength(), d.x, d.y, d.sqrLength()) - det3(a.x, a.y, a.sqrLength(), b.x, b.y, b.sqrLength(), d.x, d.y, d.sqrLength()) + det3(a.x, a.y, a.sqrLength(), b.x, b.y, b.sqrLength(), c.x, c.y, c.sqrLength());
    return det > 0n;
}

function buildTr(l, r, points) {
    if (r - l + 1 === 2) {
        const edge = makeEdge(points[l], points[r]);
        return [edge, edge.rev()];
    }
    if (r - l + 1 === 3) {
        const a = makeEdge(points[l], points[l + 1]);
        const b = makeEdge(points[l + 1], points[r]);
        splice(a.rev(), b);

        const sgn = Math.sign(points[l].crossWith(points[l + 1], points[r]));
        if (sgn === 0) {
            return [a, b.rev()];
        }

        const c = connect(b, a);
        return sgn === 1 ? [a, b.rev()] : [c.rev(), c];
    }

    const mid = Math.floor((l + r) / 2);
    const [ldo, ldi] = buildTr(l, mid, points);
    const [rdi, rdo] = buildTr(mid + 1, r, points);

    while (true) {
        if (leftOf(rdi.origin, ldi)) {
            ldi = ldi.lnext();
        } else if (rightOf(ldi.origin, rdi)) {
            rdi = rdi.rev().onext;
        } else {
            break;
        }
    }

    let basel = connect(rdi.rev(), ldi);

    const valid = (e) => rightOf(e.dest(), basel);
    if (ldi.origin.equals(ldo.origin)) ldo = basel.rev();
    if (rdi.origin.equals(rdo.origin)) rdo = basel;

    while (true) {
        let lcand = basel.rev().onext;
        if (valid(lcand)) {
            while (inCircle(basel.dest(), basel.origin, lcand.dest(), lcand.onext.dest())) {
                const temp = lcand.onext;
                deleteEdge(lcand);
                lcand = temp;
            }
        }

        let rcand = basel.oprev();
        if (valid(rcand)) {
            while (inCircle(basel.dest(), basel.origin, rcand.dest(), rcand.oprev().dest())) {
                const temp = rcand.oprev();
                deleteEdge(rcand);
                rcand = temp;
            }
        }

        if (!valid(lcand) && !valid(rcand)) break;

        if (!valid(lcand) || (valid(rcand) && inCircle(lcand.dest(), lcand.origin, rcand.origin, rcand.dest()))) {
            basel = connect(rcand, basel.rev());
        } else {
            basel = connect(basel.rev(), lcand.rev());
        }
    }

    return [ldo, rdo];
}

// search for a pair of intersecting segments
function findIntersectingEdge(edges) {
    const n = edges.length;
    for (let i = 0; i < n; i++) {
        const a = edges[i];
        for (let j = i + 1; j < n; j++) {
            const b = edges[j];
            if (inCircle(a.origin, a.dest(), b.origin, b.dest()) && inCircle(a.origin, a.dest(), b.dest(), b.origin)) {
                return [a, b];
            }
        }
    }
    return null;
}

export function delaunay(points) {
    // add intersections to the list of points using the findIntersectingEdge function
    let intersectingEdge;
    while ((intersectingEdge = findIntersectingEdge(points))) {
        const [a, b] = intersectingEdge;
        const a1 = a.origin;
        const a2 = a.dest();
        const b1 = b.origin;
        const b2 = b.dest();
        const p = new Point((a1.x + a2.x + b1.x + b2.x) / 4n, (a1.y + a2.y + b1.y + b2.y) / 4n);
        points.push(p);
        const e1 = connect(a, makeEdge(a.dest(), p));
        const e2 = connect(b, makeEdge(b.dest(), p));
        splice(e1.rev(), e2);
    }

    points.sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
    const [start] = buildTr(0, points.length - 1, points);

    const edges = [];
    const result = [];
    let edge = start;

    do {
        if (!edge.used) {
            const tri = [edge.origin, edge.dest(), edge.lnext().dest()];
            result.push(tri);
            edge.used = true;
        }
        edge = edge.onext;
    } while (edge !== start);

    return result;
}

export function voronoi(points) {
    const tr = delaunay(points);
    const edges = new Map();
    const result = [];

    for (const tri of tr) {
        for (let i = 0; i < 3; i++) {
            const a = tri[i];
            const b = tri[(i + 1) % 3];
            const edge = a.x < b.x ? `${a.x},${a.y},${b.x},${b.y}` : `${b.x},${b.y},${a.x},${a.y}`;
            if (edges.has(edge)) {
                result.push([a, b, edges.get(edge)]);
                edges.delete(edge);
            } else {
                edges.set(edge, b);
            }
        }
    }

    return result;
}
