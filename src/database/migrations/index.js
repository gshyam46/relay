import * as baselineSchema from "./0001_baseline_schema.js";

/**
 * Ordered migration list.
 *
 * Migrations are listed explicitly rather than discovered by reading the
 * directory: the order is the contract, and an explicit list makes an
 * accidentally-misnamed file a visible omission instead of a silent reordering.
 *
 * To add one: create `NNNN_short_name.js` exporting `id` and `up(db)`, import it
 * here, and append it to the array. Never edit or reorder an already-released
 * migration — deployed databases have recorded it as applied and will not run it
 * again.
 */
export const MIGRATIONS = [baselineSchema];
