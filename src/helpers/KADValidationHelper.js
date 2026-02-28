/**
 * KADValidationHelper.js
 * Validates KAD entities for correct point count vs entityType.
 * Used at save/load chokepoints and interactively when finishing entities.
 */

/**
 * Validation rules for minimum point counts per entity type.
 * Types not listed here (point, circle, text) have no minimum.
 */
const MIN_POINTS = {
	line: 2,
	poly: 3,
};

/**
 * Validates a single KAD entity's point count against its type.
 * @param {Object} entityData - The entity object with entityType and data[]
 * @returns {Object} Result: { status: "ok" } or { status: "invalid", pointCount, entityType, convertTo, message }
 */
export function validateKADEntity(entityData) {
	if (!entityData || !entityData.entityType) {
		return { status: "ok" };
	}

	var entityType = entityData.entityType;
	var pointCount = entityData.data ? entityData.data.length : 0;
	var minRequired = MIN_POINTS[entityType];

	// Types without minimum point rules are always valid
	if (minRequired === undefined) {
		return { status: "ok" };
	}

	// Zero points — always invalid, remove
	if (pointCount === 0) {
		return {
			status: "invalid",
			pointCount: pointCount,
			entityType: entityType,
			convertTo: null,
			message: capitalize(entityType) + " has 0 points and will be removed.",
		};
	}

	// Enough points — valid
	if (pointCount >= minRequired) {
		return { status: "ok" };
	}

	// Not enough points — determine conversion target
	var convertTo;
	if (pointCount === 1) {
		convertTo = "point";
	} else if (pointCount === 2 && entityType === "poly") {
		convertTo = "line";
	} else {
		convertTo = "point";
	}

	var typeLabel = entityType === "poly" ? "Polygons" : "Lines";
	var pointWord = pointCount === 1 ? "point" : "points";
	var message;

	if (entityType === "poly" && pointCount === 1) {
		message = typeLabel + " require at least " + minRequired + " points. Do you want to discard this single point or convert to a point object?";
	} else if (entityType === "poly" && pointCount === 2) {
		message = typeLabel + " require at least " + minRequired + " points. Do you want to discard these 2 points or convert to a line object?";
	} else if (entityType === "line" && pointCount === 1) {
		message = typeLabel + " require at least " + minRequired + " points. Do you want to discard this single point or convert to a point object?";
	} else {
		message = typeLabel + " require at least " + minRequired + " points. This " + entityType + " has " + pointCount + " " + pointWord + ".";
	}

	return {
		status: "invalid",
		pointCount: pointCount,
		entityType: entityType,
		convertTo: convertTo,
		message: message,
	};
}

/**
 * Fixes an invalid KAD entity by converting it to a valid type.
 * Mutates the entity in-place.
 * @param {Object} entityData - The entity to fix
 * @param {string} convertTo - Target type ("point", "line", etc.)
 */
export function fixKADEntity(entityData, convertTo) {
	if (!entityData || !convertTo) return;

	entityData.entityType = convertTo;

	if (entityData.data) {
		for (var i = 0; i < entityData.data.length; i++) {
			entityData.data[i].entityType = convertTo;
			if (convertTo === "point" || convertTo === "line") {
				entityData.data[i].closed = false;
			}
		}
	}
}

/**
 * Batch-validates all entities in a KAD map. Auto-fixes or removes invalid entities silently.
 * @param {Map} kadMap - The allKADDrawingsMap
 * @returns {Object} { fixed: number, removed: number }
 */
export function validateAllKADEntities(kadMap, skipEntityName) {
	var fixed = 0;
	var removed = 0;
	var toRemove = [];

	kadMap.forEach(function (entity, entityName) {
		if (skipEntityName && entityName === skipEntityName) return;
		var result = validateKADEntity(entity);
		if (result.status === "invalid") {
			if (result.convertTo === null) {
				// 0 points — mark for removal
				toRemove.push(entityName);
				removed++;
			} else {
				// Convert to valid type
				fixKADEntity(entity, result.convertTo);
				fixed++;
			}
		}
	});

	// Remove after iteration to avoid modifying map during forEach
	for (var i = 0; i < toRemove.length; i++) {
		kadMap.delete(toRemove[i]);
	}

	return { fixed: fixed, removed: removed };
}

function capitalize(str) {
	return str.charAt(0).toUpperCase() + str.slice(1);
}
