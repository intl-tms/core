/**
 * The entry a website imports: marker codec, catalog marking, configuration,
 * wire types, request handler, storage seam, usage helpers and message
 * classification. This entry carries the package's stability promise and
 * contains no DOM code.
 */
export { decode, detect, encode, strip } from "./codec.js";
export type { Decoded } from "./codec.js";
