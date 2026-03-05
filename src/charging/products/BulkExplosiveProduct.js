/**
 * @fileoverview BulkExplosiveProduct - ANFO, Emulsion, Blends (Gassed/NonGassed), Molecular
 * Used in COUPLED decks (fills hole diameter)
 */

import { Product } from "./Product.js";

export class BulkExplosiveProduct extends Product {
	constructor(options) {
		super(Object.assign({}, options, { productCategory: "BulkExplosive" }));
		this.isCompressible = options.isCompressible || false;
		this.minDensity = options.minDensity || null;
		this.maxDensity = options.maxDensity || null;
		this.limitingDensity = options.limitingDensity || null;   // Matrix density without gas (g/cc)
		this.criticalDensity = options.criticalDensity || null;   // Dead-pressing threshold (g/cc)
		this.vodMs = options.vodMs || null;           // Velocity of detonation m/s
		this.reKjKg = options.reKjKg || null;         // Relative energy kJ/kg
		this.rws = options.rws || null;               // Relative weight strength %
		this.waterResistant = options.waterResistant || false;
	}

	toJSON() {
		return Object.assign(Product.prototype.toJSON.call(this), {
			isCompressible: this.isCompressible,
			minDensity: this.minDensity,
			maxDensity: this.maxDensity,
			limitingDensity: this.limitingDensity,
			criticalDensity: this.criticalDensity,
			vodMs: this.vodMs,
			reKjKg: this.reKjKg,
			rws: this.rws,
			waterResistant: this.waterResistant,
		});
	}

	static fromJSON(obj) {
		return new BulkExplosiveProduct(obj);
	}
}
